# feed402

**Paid data endpoints for AI agents, over x402.**

A minimal reference implementation of the feed402 protocol: any data provider
can serve discoverable, priced, cited data to an AI agent that pays over x402
with a Base wallet.

- Protocol: [`SPEC.md`](./SPEC.md)
- Project brief: [`BRIEF.md`](./BRIEF.md)
- Hours log: [`TIMELOG.md`](./TIMELOG.md)

**Status:** v0.2 draft. Local repo. No public git remote yet.
**Author:** Gianangelo Dichio · MIT code · CC0 spec.

## Live reference merchant

`x402-research.agfarms.dev` is the canonical live merchant speaking feed402/0.2
on Base Sepolia. Six endpoints × three tiers: `pubmed`, `semantic-scholar`,
`openalex`, `clinicaltrials`, `pubchem`, `kruse`. Source:
[`x402-research-gateway`](https://github.com/gianyrox/x402-research-gateway).

- Manifest: `https://x402-research.agfarms.dev/.well-known/feed402.json`
- Wallet (receiver, Base Sepolia): `0x4daF1378F862A58fe2C4C534d4d105A29D2B29Ff`
  *(funding pending — tx hash will land in
  [`bucket-foundation/PRODUCTION_LOG.md`](../bucket-foundation/PRODUCTION_LOG.md)
  once the faucet drip clears)*
- Hosting status: deploy runbook at
  [`x402-research-gateway/DEPLOY.md`](../x402-research-gateway/DEPLOY.md)

### Zero-key path for agent devs

If you're building an agent and don't want to hold a Base wallet yet, hit the
Bucket Foundation proxy instead:

```
POST https://www.bucket.foundation/api/research
```

The proxy holds the funded wallet, settles upstream over feed402, and returns
the cited envelope. Agents pay nothing; canon coverage is identical.

Easiest way to wire this into Claude Desktop / Claude Code:
[`bucket-mcp`](https://github.com/bucket-foundation/bucket-mcp) — stdio MCP
server, three tools (`bucket_research`, `bucket_cite`, `bucket_canon_list`),
Python stdlib only.

### What's new in v0.2

v0.2 is fully backwards-compatible with v0.1 — every added field is optional.
Two additions:

1. **Optional index manifest** at `Manifest.index` — merchants declare their
   retrieval scheme (dense / sparse / hybrid, embedding model, chunk strategy,
   corpus fingerprint) for citation reproducibility. See [`SPEC.md §4`](./SPEC.md#4-index-manifest-v02-optional).
2. **Optional retrieval provenance** on `source` citations — `chunk_id` plus
   `retrieval.{model, score, rank}` so downstream agents can re-verify a hit
   against the same corpus + model. See [`SPEC.md §3.2`](./SPEC.md#32-retrieval-provenance-v02-optional).

## The 60-second pitch

x402 gives you a payment rail. It doesn't give you a *merchant template*.
feed402 is that template:

1. A static manifest at `/.well-known/feed402.json` so agents can discover you.
2. Three query tiers — `raw`, `query`, `insight` — so agents pick the cheapest
   tier that answers their question.
3. A mandatory `citation` block in every paid response so answers are
   re-citable, not opaque.
4. An additive extension hook (`citation.type`) so the same rail can carry
   literature, verified capture sessions, attestations, measurements — without
   breaking existing agents.
5. *(v0.2)* Merchants declare their retrieval scheme in the manifest so
   citations are reproducible — not just referenceable — across providers.

## Run the demo

```bash
npm install
./demo.sh
```

That boots the reference provider, runs the reference agent, and prints the
full flow: discovery → 402 challenge → paid 200 + envelope.

## Patents service (bkt-zx6)

The reference server mounts a `/patents/*` route family. Spec: [`SPEC.md §6.1`](./SPEC.md#61-patents-service-reference-implementation-bkt-zx6).
v1 licensing: [`bucket-foundation/docs/PATENT_LICENSING.md`](../bucket-foundation/docs/PATENT_LICENSING.md).

```bash
# query tier ($0.005) — search USPTO grants
curl -H "x-payment: stub-demo" \
  "http://localhost:8787/patents/search?q=mitochondrial&from=2020-01-01&limit=10"

# raw tier ($0.010) — full grant + claims + citations bundle
curl -H "x-payment: stub-demo" "http://localhost:8787/patents/11000000"

# query tier — point-radius search
curl -H "x-payment: stub-demo" \
  "http://localhost:8787/patents/by-coord?lat=42.37&lng=-71.10&radius=25"

# query tier — INPADOC-style family across jurisdictions
curl -H "x-payment: stub-demo" "http://localhost:8787/patents/family/11000000"

# query tier — backward (cited) or forward (cited-by) citation graph
curl -H "x-payment: stub-demo" \
  "http://localhost:8787/patents/citations/11000000?direction=backward"

# insight tier ($0.002) — NL question, top-k summarized hits
curl -H "x-payment: stub-demo" \
  "http://localhost:8787/patents/insight?question=caloric%20restriction%20mimetics"
```

The DB layer is mocked by default (`MockPatentsRepo`) so the demo runs without
Postgres. Production swaps in a Postgres impl loading bkt-5qg's schema at
`bucket-foundation/data/patents/uspto/schema/uspto.sql`.

## What's in the repo

| File | Purpose |
|---|---|
| `SPEC.md` | The protocol. One page. |
| `types.ts` | Shared TypeScript types for manifest + envelope. |
| `server.ts` | Reference provider (Hono, in-memory corpus). |
| `agent.ts` | Reference buyer. |
| `demo.sh` | End-to-end one-command demo. |
| `BRIEF.md` | Why this exists, what it buys the ecosystem. |

## What this is not (yet)

- Not a CLI scaffold — v0.2.
- Not a production dataset — bring your own.
- Not a registry — v0.2+.
- Not a real x402 payment verifier — the `x-payment` header is stubbed in
  v0.1. Plug in an x402 facilitator check where `verifyPayment` is defined
  in `server.ts`.

## Forking as a real data provider

1. Replace the `CORPUS` constant in `server.ts` with your real data source.
2. Replace `verifyPayment` with a real x402 facilitator check against your
   wallet address.
3. Replace the stub `stubPaymentHeader` in `agent.ts` with `viem` signing
   against a real Base wallet.
4. Adjust the manifest in the `/.well-known/feed402.json` handler to reflect
   your prices, chain, wallet, and advertised citation types.
5. Ship.

That's it. ~200 LOC of protocol code separates you from being a live feed402
merchant on Base.

## Related

- [x402 protocol](https://www.x402.org/) — the payment rail this sits on.
- `~/agfarms/x402-research-gateway/` — production-ish Go implementation of
  a paid research gateway (PubMed, Semantic Scholar, OpenAlex, ClinicalTrials,
  PubChem, Kruse corpus) on Base Sepolia by the same author. **As of
  2026-04-21, this gateway is feed402/0.2 compliant** — it serves
  `/.well-known/feed402.json`, tags every route with a feed402 tier
  (raw/query), and wraps every successful paid response in the §3 envelope
  with a per-source citation (pubmed / s2 / openalex / nct / jackkruse /
  pubchem). That makes it the **second live feed402 merchant** after the
  TypeScript reference in this repo — and the first one wrapping real
  upstream data (36M+ PubMed citations, 200M+ Semantic Scholar papers,
  400K+ ClinicalTrials studies, 460 Kruse posts, etc.).
- `~/agfarms/bucket-foundation/` — Bucket Foundation, the nonprofit canon
  project that will consume feed402 merchants as citable research inputs.
- DerbyFish BHRV — the reference VDS (Verified Data Session) merchant; see
  `SPEC.md §3.1`.
