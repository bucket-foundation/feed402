# feed402 — project brief

**Author:** Gianangelo Dichio
**License:** MIT code · CC0 spec
**Status:** Active — local repo, no public remote yet
**Sponsor (time):** Viatika engagement, hourly @ $60/hr against parent contract
**Origin:** 2026-04-15

---

## The problem

x402 ships complete middleware: payment challenge, wallet signing, settlement,
receipt. It works. But **there are almost no data providers selling over x402**,
so there is almost nothing for AI agents to buy. x402 is a payment rail with
very few merchants.

The one real-world research merchant running on x402 today is
`x402-research-gateway` — **also written by me**, currently hosted inside
Viatika's contract folder but effectively a pattern, not a product. It proves
the rail works; it does not prove the rail is reusable.

## The solution

Ship **one working proof** that an AI agent with a Base wallet can discover,
pay, and query a data endpoint over x402 — and then hand the pattern to real
data providers as a copy-paste template.

Not a framework. Not a monorepo. Not a CLI. **One repo, a few files, one demo.**

## What ships (v0.1)

| File | ~LOC | Purpose |
|---|---|---|
| `SPEC.md` | ~1 page | Protocol: discovery, handshake, response envelope, 3 query tiers, citation extension |
| `server.ts` | ~200 | Reference data seller. Hono + x402 lib + in-memory index |
| `agent.ts` | ~100 | Reference buyer. viem + Base wallet + `.well-known` discovery + pay + query |
| `demo.sh` | ~20 | One command: boots server, runs agent, prints receipt + result |
| `README.md` | ½ page | What it is, how to run, how to fork |

Runs on Cloudflare Workers or any Node host. MIT code, CC0 spec.

## What this buys the ecosystem

1. **A merchant playbook.** Any data co. forks this repo, points it at their
   dataset, ships in a day, sells over x402 the next.
2. **A discovery pattern** (`/.well-known/feed402.json`) that agents can scan.
3. **A citation envelope** so every paid response carries provenance — the
   one thing raw x402 middleware does not enforce.
4. **A demo** runnable in under 60 seconds.
5. **An extension hook** (`citation.type`) so the envelope can carry not just
   literature references but also verified real-world capture sessions.
   AGFarms DerbyFish's BHRV pipeline slots in as the first reference VDS
   (Verified Data Session) merchant without a spec rewrite. See
   `SPEC.md §3.1`. This turns feed402 from "a data rail for PubMed-shaped
   corpora" into "a data rail for any agent-consumable evidence."

## What it does NOT do (deferred past v0.1)

- No CLI scaffold, no adapters, no SDK packages
- No production dataset, no real content
- No governance, no versioning, no registry
- No marketing site, no docs portal
- No legal review of citation terms

All of that is v0.2+ work, gated on whether this proof resonates.

## Architecture (one screen)

```
 AI agent (Base wallet)                 Data provider (this repo)
 ─────────────────────        HTTP      ──────────────────────────
  1. GET /.well-known/feed402.json  →   discovery (free)
  2. POST /query  (no payment)      →   402 Payment Required
     ← x402 challenge (price, address)
  3. POST /query  + x402 header     →   200 + JSON envelope
                                        { data, citation, receipt }
```

Three query tiers, same endpoint shape:
- `raw` — bulk rows (highest price)
- `query` — structured SQL-ish (medium)
- `insight` — NL over embedding index (lowest, fastest)

Provider picks which tiers to enable; envelope shape is identical.

## Relationship to existing code

- `~/agfarms/x402-research-gateway/` (also mine) is a working Go implementation
  of a paid research gateway on Base Sepolia with 7 live endpoints (PubMed,
  Semantic Scholar, OpenAlex, ClinicalTrials, PubChem, Kruse corpus). It is
  **not yet feed402-compliant** — missing `/.well-known/feed402.json`, the
  mandatory `citation` envelope, and the `insight` tier. Upgrading it to
  compliance is a natural follow-on but **is not in scope for v0.1 of this
  repo**.
- `feed402` (this repo) is the canonical minimal reference implementation in
  TypeScript, designed to be copy-paste forkable, not the Go production path.

## Billing posture

- Hourly @ $60/hr under the existing Viatika engagement.
- Hours logged in `TIMELOG.md`, one line per session, append-only.
- No fixed cap. Scope controlled by "what's in §What ships above."
- Authorship, copyright, and license terms below override any boilerplate in
  the parent engagement.

## IP & license

- **Authored by Gianangelo Dichio.**
- Code: MIT. Spec: CC0.
- No exclusive rights granted to any party. Viatika is credited as the
  hourly sponsor of initial development time; this does not transfer
  authorship or ownership.
- Anyone — including me, Viatika, Bucket Foundation, AGFarms ventures, or
  third parties — may fork, extend, or commercialize under the license.
