// x402 challenge + settlement.
//
// Three modes, selected by env:
//
//   off      dev mode — skip 402 entirely. Use --no-payment.
//   stub     legacy: accept any base64 JSON {tx} body in X-PAYMENT.
//   v2       real x402/v2 via @x402/hono → facilitator.x402.org by default.
//            Requires FEED402_PAY_TO=<0xEVMaddress> + FEED402_NETWORK
//            (eip155:84532 = Base Sepolia by default).
//
// Defaults:
//   FEED402_X402_MODE=v2            → use the real SDK
//   FEED402_X402_MODE unset + paid  → stub (back-compat)
//   --no-payment                    → off
//
// Env contract for v2:
//   FEED402_PAY_TO              0x… (the wallet that receives USDC)
//   FEED402_NETWORK             eip155:84532 | eip155:8453 | …  (default eip155:84532)
//   FEED402_FACILITATOR_URL     https://facilitator.x402.org    (default for testnet)
//
// The middleware itself replaces my custom challenge/checkPayment logic when
// active; this file still exposes the legacy stub helpers because tests + the
// existing /raw /query /insight envelope code use them.
import type { Context, MiddlewareHandler } from "hono";
import type { Manifest, Tier } from "./types.js";

export type PaymentVerifier = "off" | "stub" | "v2";

export interface PaymentMode {
  enforce: boolean;
  network: string;
  verifier: PaymentVerifier;
  facilitatorUrl?: string;
  payTo?: string;
  evmNetwork?: string;
}

export function paymentModeFromEnv(enforce: boolean, network: string): PaymentMode {
  if (!enforce) return { enforce: false, network, verifier: "off" };
  const mode = (process.env.FEED402_X402_MODE ?? "").toLowerCase();
  const payTo = process.env.FEED402_PAY_TO;
  // facilitator.x402.rs supports Base Sepolia + Solana devnet; facilitator.x402.org
  // is the Coinbase-hosted prod default. Pick whichever the env says.
  const facilitatorUrl = process.env.FEED402_FACILITATOR_URL ?? "https://facilitator.x402.rs";
  const evmNetwork = process.env.FEED402_NETWORK ?? "eip155:84532"; // Base Sepolia
  if (mode === "v2" && payTo) {
    return { enforce: true, network, verifier: "v2", facilitatorUrl, payTo, evmNetwork };
  }
  return { enforce: true, network, verifier: "stub", facilitatorUrl };
}

export function challenge(c: Context, manifest: Manifest, tier: Tier) {
  const t = manifest.tiers[tier];
  c.header("WWW-Authenticate",
    `x402 chain="${manifest.chain}", wallet="${manifest.wallet}", price_usd="${t.price_usd}", unit="${t.unit}", path="${t.path}"`);
  return c.json({
    error: "payment_required",
    chain: manifest.chain,
    wallet: manifest.wallet,
    tier,
    price_usd: t.price_usd,
    unit: t.unit,
    spec: manifest.spec,
    facilitator_hint: process.env.FEED402_FACILITATOR_URL ?? null,
  }, 402);
}

export interface VerifyResult { paid: boolean; tx?: string; payer?: string; error?: string; }

export async function checkPayment(c: Context, mode: PaymentMode): Promise<VerifyResult> {
  if (!mode.enforce) return { paid: true, tx: "0xdev-bypass" };
  const h = c.req.header("x-payment") || c.req.header("X-PAYMENT");
  if (!h) return { paid: false, error: "missing X-PAYMENT" };

  // v2 verification is handled by the @x402/hono middleware applied earlier
  // in the chain; if we got here in v2 mode, the middleware already accepted
  // the payment. The tx hash is on the X-PAYMENT-RESPONSE header.
  if (mode.verifier === "v2") {
    const resp = c.res.headers.get("x-payment-response");
    if (resp) {
      try {
        const obj = JSON.parse(Buffer.from(resp, "base64").toString());
        return { paid: true, tx: obj?.transaction ?? obj?.tx_hash, payer: obj?.payer };
      } catch {/* fallthrough */}
    }
    return { paid: true, tx: "0xv2-pending" };
  }

  // stub — accept any base64 JSON {tx}
  try {
    const obj = JSON.parse(Buffer.from(h, "base64").toString());
    if (obj && typeof obj.tx === "string") return { paid: true, tx: obj.tx, payer: obj.payer };
  } catch {/* fallthrough */}
  return { paid: false, error: "stub verifier requires base64 JSON {tx}" };
}

/**
 * Build the @x402/hono middleware for v2 mode, configured per-provider with
 * the right prices for /raw /query /insight tiers. Returns null when not
 * applicable (off / stub / missing payTo) so the caller can skip mounting.
 */
export async function buildV2Middleware(
  manifest: Manifest, mode: PaymentMode
): Promise<MiddlewareHandler | null> {
  if (mode.verifier !== "v2" || !mode.payTo) return null;
  // Lazy import so the SDK doesn't need to load when running in stub mode.
  const { paymentMiddleware, x402ResourceServer } = await import("@x402/hono");
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  const { ExactEvmScheme } = await import("@x402/evm/exact/server");

  const fc = new HTTPFacilitatorClient({ url: mode.facilitatorUrl! });
  const server = new x402ResourceServer(fc).register(mode.evmNetwork as any, new ExactEvmScheme() as any);

  const network = mode.evmNetwork as any;
  const payTo = mode.payTo as `0x${string}`;
  const priceForTier = (t: Tier) => `$${manifest.tiers[t].price_usd.toFixed(3)}`;
  const routes: any = {};
  for (const method of ["GET", "POST"]) {
    routes[`${method} /raw`]     = { accepts: { scheme: "exact", network, price: priceForTier("raw"),     payTo }, description: `${manifest.name} raw rows`     };
    routes[`${method} /query`]   = { accepts: { scheme: "exact", network, price: priceForTier("query"),   payTo }, description: `${manifest.name} structured query` };
    routes[`${method} /insight`] = { accepts: { scheme: "exact", network, price: priceForTier("insight"), payTo }, description: `${manifest.name} insight` };
  }
  return paymentMiddleware(routes, server);
}
