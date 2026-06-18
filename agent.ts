/**
 * feed402 v0.1 — reference AI agent / buyer
 *
 * Demonstrates the full flow from SPEC.md:
 *   1. GET /.well-known/feed402.json          (discovery, free)
 *   2. POST /query (no payment)               (expect 402)
 *   3. POST /query + x-payment                (expect 200 + envelope)
 *
 * In v0.1 the payment is a stub header — a real agent would construct the
 * x402 payload with viem (sign with a Base wallet, include amount + nonce).
 * The stub is intentional: this repo ships the PROTOCOL, not a new payer.
 *
 * Run: npm run agent
 */

import type { Envelope, Manifest, TierName } from "./types.js";
import {
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { randomBytes } from "node:crypto";

const BASE_URL = process.env.FEED402_BASE_URL ?? "http://localhost:8787";

// ---------- x402 EIP-712 signing (SPEC §2) ----------
//
// When FEED402_AGENT_PRIVATE_KEY is set the agent constructs a real
// "exact" scheme x402 payload: an EIP-712 signed USDC
// transferWithAuthorization. When unset we fall back to the stub
// payload so the demo still runs cold on a laptop without a wallet.
//
// The signed payload shape is the v2 x402 envelope the reference Go
// gateway at ~/freelance/x402-research-gateway expects:
//
//   {
//     x402Version: 2,
//     payload: { authorization: { from, to, value, validAfter,
//       validBefore, nonce }, signature },
//     accepted: { scheme: "exact", network, asset, amount, payTo,
//       maxTimeoutSeconds, extra: { name, version } },
//   }

// USDC addresses — canonical Coinbase-deployed contracts.
const USDC_BY_NETWORK: Record<string, Address> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

function chainForNetwork(network: string) {
  if (network === "base") return base;
  return baseSepolia;
}

async function realPaymentHeader(
  tier: TierName,
  priceUsd: number,
  manifest: Manifest,
): Promise<string> {
  const pk = process.env.FEED402_AGENT_PRIVATE_KEY as Hex | undefined;
  if (!pk) return stubPaymentHeader(tier, priceUsd);

  const account = privateKeyToAccount(pk);
  const network = manifest.chain;
  const chain = chainForNetwork(network);
  const asset = USDC_BY_NETWORK[network] ?? USDC_BY_NETWORK["base-sepolia"];
  const payTo = manifest.wallet;
  // USDC has 6 decimals; price is USD so amount = price * 1e6.
  const amount = parseUnits(priceUsd.toFixed(6), 6);

  // EIP-3009 transferWithAuthorization window. 60s plenty for a sync call.
  const now = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(now - 5);
  const validBefore = BigInt(now + 60);
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;

  const client: WalletClient = createWalletClient({ account, chain, transport: http() });

  const signature = await client.signTypedData({
    account,
    domain: {
      // Coinbase-deployed USDC uses name="USD Coin" and version="2" on both
      // base and base-sepolia. A production agent would hit the token's
      // DOMAIN_SEPARATOR() to avoid hardcoding.
      name: "USD Coin",
      version: "2",
      chainId: chain.id,
      verifyingContract: asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: payTo as Address,
      value: amount,
      validAfter,
      validBefore,
      nonce,
    },
  });

  const envelope = {
    x402Version: 2,
    payload: {
      authorization: {
        from: account.address,
        to: payTo,
        value: amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      signature,
    },
    accepted: {
      scheme: "exact",
      network,
      asset,
      amount: amount.toString(),
      payTo,
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" },
    },
  };
  return Buffer.from(JSON.stringify(envelope)).toString("base64");
}

async function discover(): Promise<Manifest> {
  const res = await fetch(`${BASE_URL}/.well-known/feed402.json`);
  if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
  return (await res.json()) as Manifest;
}

async function callWithout402(tier: TierName, path: string, body: unknown): Promise<number> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 402) {
    throw new Error(`expected 402 on unpaid ${tier}, got ${res.status}`);
  }
  const challenge = res.headers.get("x-payment-required");
  console.log(`   ← 402 Payment Required, challenge: ${challenge}`);
  return res.status;
}

/**
 * Stub payment construction. A real agent would:
 *   - parse the x402 challenge from the 402 response headers
 *   - construct an x402 payload (amount, recipient, nonce, expiry)
 *   - sign with viem's wallet client
 *   - submit and include the resulting token in x-payment
 *
 * For v0.1 we just send any non-empty x-payment to exercise the server path.
 */
function stubPaymentHeader(tier: TierName, priceUsd: number): string {
  const payload = { tier, price_usd: priceUsd, nonce: Math.random().toString(36).slice(2), at: Date.now() };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function callWithPayment<D>(
  tier: TierName,
  path: string,
  body: unknown,
  priceUsd: number,
  manifest: Manifest,
): Promise<Envelope<D>> {
  const xPayment = await realPaymentHeader(tier, priceUsd, manifest);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payment": xPayment,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`paid ${tier} failed: ${res.status}`);
  return (await res.json()) as Envelope<D>;
}

async function main() {
  console.log("→ feed402 reference agent");
  console.log("");

  // 1. Discover
  console.log(`1. GET ${BASE_URL}/.well-known/feed402.json`);
  const manifest = await discover();
  console.log(
    `   ← provider="${manifest.name}" spec=${manifest.spec} tiers=[${Object.keys(manifest.tiers).join(", ")}]`,
  );
  if (manifest.index) {
    console.log(
      `   ← index=${manifest.index.type}/${manifest.index.model} chunks=${manifest.index.chunks} corpus_sha256=${manifest.index.corpus_sha256.slice(0, 12)}…`,
    );
  }
  console.log("");

  // 2. Unpaid call (expect 402)
  const queryTier = manifest.tiers.query!;
  console.log(`2. POST ${BASE_URL}${queryTier.path}  (no payment)`);
  await callWithout402("query", queryTier.path, { year_gte: 2020 });
  console.log("");

  // 3. Paid call (expect 200 + envelope)
  console.log(`3. POST ${BASE_URL}${queryTier.path}  + x-payment`);
  const env = await callWithPayment<{ rows: unknown[] }>(
    "query",
    queryTier.path,
    { year_gte: 2020 },
    queryTier.price_usd,
    manifest,
  );
  console.log(
    `   (payment: ${process.env.FEED402_AGENT_PRIVATE_KEY ? "real viem EIP-712 signed USDC authorization" : "stub — set FEED402_AGENT_PRIVATE_KEY for real signing"})`,
  );
  console.log("   ← 200 OK");
  console.log("   envelope.data.rows.length:", env.data.rows.length);
  console.log("   envelope.citation.count:  ", env.citation.length);
  console.log("   envelope.citation[0].type:", env.citation[0]?.type);
  console.log("   envelope.citation[0].src: ", (env.citation[0] as any)?.source_id ?? "—");
  console.log("   envelope.receipt:         ", env.receipt);
  console.log("");

  // 4. Insight tier (cheapest) — inspect v0.2 retrieval provenance
  const insightTier = manifest.tiers.insight;
  if (insightTier) {
    console.log(`4. POST ${BASE_URL}${insightTier.path}  + x-payment`);
    const ins = await callWithPayment<{ summary: string; top_source: string }>(
      "insight",
      insightTier.path,
      { question: "caloric restriction" },
      insightTier.price_usd,
      manifest,
    );
    console.log("   ← 200 OK");
    console.log("   summary:", ins.data.summary);
    const c = ins.citation as any;
    if (c.chunk_id || c.retrieval) {
      console.log(
        `   citation.chunk_id: ${c.chunk_id ?? "—"}  retrieval: model=${c.retrieval?.model} score=${c.retrieval?.score?.toFixed(3)} rank=${c.retrieval?.rank}`,
      );
    }
    console.log("   receipt:", ins.receipt);
  }

  console.log("");
  console.log("✓ feed402 reference flow complete");
}

main().catch((err) => {
  console.error("✗ agent failed:", err);
  process.exit(1);
});
