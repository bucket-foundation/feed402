# feed402 — protocol v0.2

**Author:** Gianangelo Dichio · **License:** CC0 · **Status:** Draft

One page. Built on x402 unchanged. Everything below is the delta a data
provider needs to implement on top of a standard x402 server.

**v0.2 is fully backwards-compatible with v0.1.** Every field added in this
version is optional. A v0.1 client seeing a v0.2 manifest or envelope
**must** ignore unknown fields (see §2.3) and continue to function. A v0.2
client querying a v0.1 provider **must not** require the new fields.

---

## 1. Discovery

Every feed402 provider serves a static manifest at a fixed path:

```
GET https://<provider>/.well-known/feed402.json
```

```json
{
  "name": "example-pubmed-mirror",
  "version": "0.1.0",
  "spec": "feed402/0.2",
  "chain": "base",
  "wallet": "0xabc...",
  "tiers": {
    "raw":     { "path": "/raw",     "price_usd": 0.05,  "unit": "row" },
    "query":   { "path": "/query",   "price_usd": 0.01,  "unit": "call" },
    "insight": { "path": "/insight", "price_usd": 0.002, "unit": "call" }
  },
  "schema_url": "https://<provider>/schema.json",
  "citation_policy": "CC-BY-4.0",
  "citation_types": ["source", "vds"],
  "contact": "ops@example.com"
}
```

Agents crawl this once per provider, cache it, and pick the tier that fits
the budget they were given. `spec` identifies the protocol version;
`citation_types` advertises which envelope subtypes the provider emits.

Providers MAY include an optional top-level `index` block describing the
retrieval scheme backing their `query` / `insight` tiers. See §4.

## 2. Handshake (stock x402, no changes)

```
POST /query                 → 402 Payment Required
                              x402 challenge header
POST /query + x402 payload  → 200 OK + envelope
```

Settlement is whatever the x402 wallet signer does today. This spec does not
touch it.

### 2.3 Forward compatibility

Clients and agents **MUST** ignore any top-level, nested, or citation-block
field they do not recognize. This is the extension rule that lets v0.2 add
fields to the manifest and envelope without breaking v0.1 consumers. If a
future spec revision needs to make a field load-bearing, it will introduce
it as optional in version *N*, make it recommended in *N+1*, and required no
sooner than *N+2*.

## 3. Response envelope

Every paid response — raw, query, or insight — returns the same shape:

```json
{
  "data": <tier-specific payload>,
  "citation": [
    {
      "type": "source",
      "source_id": "pubmed:12345678",
      "provider": "example-pubmed-mirror",
      "retrieved_at": "2026-04-15T10:30:00Z",
      "license": "CC-BY-4.0",
      "canonical_url": "https://pubmed.ncbi.nlm.nih.gov/12345678"
    }
  ],
  "receipt": {
    "tier": "query",
    "price_usd": 0.01,
    "tx": "0x...",
    "paid_at": "2026-04-15T10:30:01Z"
  }
}
```

The `citation` block is **mandatory** and is **always an array** (length ≥ 1
on success). No citation, not feed402. This is the one thing raw x402
middleware does not enforce — it must live inside the response envelope.

**Single-row endpoints** (e.g. `GET /patents/{id}`) return a 1-element array.
**Multi-row endpoints** (e.g. `GET /patents/search`) return one entry per
distinct source row, deduplicated by `canonical_url`.

> **v0.3 BREAKING NOTE (bkt-7cs)**: prior drafts shipped `citation` as a
> singular object. v0.3 promotes it to an array to support multi-row tiers
> without smuggling citations into `data`. v0.1/v0.2 consumers reading
> `envelope.citation.type` MUST update to `envelope.citation[0].type`.

### 3.1 Citation types (extension point)

The citation block has a `type` field. The default type is `source` — a
standard literature or record reference, shape shown above. Providers MAY
emit other types; agents that do not recognize a type SHOULD treat it as
`source` and use whatever fields they can parse.

New `type` values are **additive, never breaking**. A v0.1 agent seeing a
v0.2 citation type is required to degrade gracefully, not error.

One non-default type is defined in v0.1:

**`vds` — Verified Data Session.** A wallet-signed bundle produced by running
a prescribed capture script on a mobile device (phone, tablet, wearable).
Each script defines a sequence of sensor-backed steps plus cross-step
consistency rules; a verifier adjudicates and attaches a confidence-scored
finding set. Output is structured JSON designed for agent consumption.
Reference implementation: DerbyFish `BHRV` (Bump, Hero, Release, Validate)
catch-verification pipeline, shipping as `derbyfish.bhrv.v2`.

```json
"citation": {
  "type": "vds",
  "script_id": "derbyfish.bhrv.v2",
  "session_id": "sess_01JBX...",
  "captured_by": "0xwallet...",
  "captured_at": "2026-04-15T14:22:11Z",
  "verifier": "derbyfish-gaia-fishdection@0.6.3",
  "verification": {
    "status": "PASS",
    "confidence": 0.94,
    "findings": [
      { "kind": "species",   "value": "Morone saxatilis", "confidence": 0.98 },
      { "kind": "length_cm", "value": 61.3,               "confidence": 0.95 }
    ]
  },
  "onchain": "flow-mainnet:FishCardV1#12891",
  "signature": "0xwallet..."
}
```

The full step array, sensor hashes, and consistency-rule results live at
`GET /vds/sessions/:session_id` on the provider (itself a feed402 endpoint).
The citation block carries only the summary an agent needs to trust and
re-cite the finding; fetching the full envelope is a separate, metered call.
This keeps `insight`-tier responses small while leaving the full evidence
chain one hop away.

### 3.2 Retrieval provenance (v0.2, optional)

Any `source`-typed citation MAY carry two optional fields that let a
downstream agent re-verify or re-rank the retrieval that produced it:

```json
"citation": {
  "type": "source",
  "source_id": "jackkruse:aquaphotomics-101",
  "provider": "kruse-feed402",
  "retrieved_at": "2026-04-18T10:30:00Z",
  "license": "citation-only",
  "canonical_url": "https://jackkruse.com/.../",
  "chunk_id": "jackkruse:aquaphotomics-101#c17",
  "retrieval": {
    "model": "voyage-3-large",
    "score": 0.8421,
    "rank": 2
  }
}
```

- **`chunk_id`** — string. Stable identifier for the indexable unit the
  retrieval hit, in the form `<source_id>#c<n>` where `n` is a zero-based
  chunk ordinal within `source_id`. Chunk boundaries are defined by the
  manifest's `index.chunk_strategy` (§4). Two calls against the same
  provider and corpus version **must** return the same `chunk_id` for the
  same underlying text.
- **`retrieval`** — object with `model` (same string emitted by
  `index.model` in §4), `score` (the raw similarity value the retriever
  produced; higher = more relevant), and `rank` (zero-based position in
  the result list for this request).

Providers that do not do retrieval (pure `raw` merchants) SHOULD omit both
fields. Providers that do retrieval but do not wish to expose the model
name MAY emit `chunk_id` alone.

Future citation types (deferred to v0.2+): `attestation` (third-party signed
claim), `measurement` (calibrated instrument reading), `observation`
(timestamped human-entered field note). All follow the same extension
rule — additive, never breaking.

## 4. Index manifest (v0.2, optional)

A provider that backs its `query` or `insight` tier with a retrieval index
(dense embeddings, sparse BM25, or hybrid) MAY declare that index in the
top-level `index` block of `/.well-known/feed402.json`:

```json
{
  "name": "kruse-feed402",
  "spec": "feed402/0.2",
  "...": "...",
  "index": {
    "type": "dense",
    "model": "voyage-3-large",
    "dim": 1024,
    "distance": "cosine",
    "chunks": 14237,
    "chunk_strategy": { "kind": "token-window", "size": 512, "overlap": 64 },
    "corpus_sha256": "c6a9...f31e",
    "built_at": "2026-04-18T09:12:04Z"
  }
}
```

### 4.1 Fields

| Field | Type | Required if `index` present | Notes |
|---|---|---|---|
| `type` | `"dense" \| "sparse" \| "hybrid"` | yes | Extension point. Unknown values degrade to "treat as opaque retrieval." |
| `model` | string | yes | Embedding model identifier, e.g. `"voyage-3-large"`, `"openai:text-embedding-3-small"`. Sparse-only merchants SHOULD emit `"none"`. The same string **must** match `citation.retrieval.model` in §3.2. |
| `dim` | number | when `type` is `dense` or `hybrid` | Embedding dimensionality. Omitted for pure sparse indexes. |
| `distance` | `"cosine" \| "dot" \| "l2"` | when `type` is `dense` or `hybrid` | Similarity metric used at query time. |
| `chunks` | number | yes | Total indexable units at `built_at`. Monotonic across rebuilds is a nice-to-have, not required. |
| `chunk_strategy` | object | yes | How the corpus was segmented. `kind` ∈ `"token-window" \| "paragraph" \| "post" \| "none"`. `size` and `overlap` are integer fields required only when `kind` is `"token-window"`. |
| `corpus_sha256` | string | yes | Stable fingerprint of the corpus at index time. SHOULD be a hex SHA-256 of the concatenated canonical source IDs (sorted) plus their body hashes. Lets two merchants prove they indexed the same corpus. |
| `built_at` | string | yes | ISO-8601 timestamp of the build that produced this index. |

v0.2 defines three `type` values; future revisions MAY add more. Consumers
**must** follow the §2.3 rule and treat unknown `type` values as opaque —
still usable (score + rank are meaningful) but not reproducible by a
different retriever.

### 4.2 Why this exists

The `citation` block makes feed402 answers *referenceable*. The `index`
block makes them *reproducible*.

Given the tuple `(provider, corpus_sha256, chunk_id, model)` from a
citation envelope, a second merchant holding the same model and corpus can
recompute the embedding for the chunk's canonical text and verify the score
it would have assigned. That turns the feed402 response from "trust me,
this is relevant" into "here is the chunk, here is the model, run your own
retrieval and confirm." The moat vs. "scrape the source yourself" is the
provenance — a scraper can reproduce the *text* but not the *retrieval*,
and retrieval is where agents actually spend their budget.

It also lets an agent delegating across multiple merchants de-duplicate
hits that came from the same upstream corpus but different rerankers,
merge score distributions, and route future queries by cost × hit-rate.

### 4.3 Backwards compatibility

The whole `index` block is optional. A v0.1 merchant (stub server with no
embeddings) continues to serve a manifest with no `index` field and remains
fully spec-compliant under v0.2. A v0.2 agent that requires an index SHOULD
surface a clear error — `citation_unavailable` with `message: "provider
declares no retrieval index"` — rather than fabricating one.

## 5. Query tiers

| Tier | Input | Output | Price signal |
|---|---|---|---|
| `raw` | `{"ids": [...]}` or `{"limit": N}` | bulk rows | highest (pay per row) |
| `query` | `{"sql": "..."}` or structured filter | matched rows | medium (pay per call) |
| `insight` | `{"question": "..."}` | NL summary + top-k citations | lowest (pay per call) |

Providers may implement 1, 2, or all 3. The `.well-known` manifest declares
which. Agents pick the cheapest tier that answers their question.

All three tiers MUST return the envelope shape from §3. The `data` payload
differs by tier; the `citation` and `receipt` blocks are identical in shape.

## 6. Errors

All non-2xx responses carry `{"error": {"code": "...", "message": "..."}, "trace_id": "..."}`.
A 402 is not an error — it is the handshake.

Reserved error codes in v0.1: `invalid_tier`, `invalid_input`,
`upstream_unavailable`, `rate_limited`, `citation_unavailable`.

## 6.1 Patents Service (reference implementation, bkt-zx6)

The reference server ships a `/patents/*` route family backed by a USPTO-shaped
Postgres schema (see `bucket-foundation/data/patents/uspto/schema/uspto.sql`).
v1 corpus per `bucket-foundation/docs/PATENT_LICENSING.md`: USPTO +
Google Patents BigQuery (both CC-BY-4.0) + EPO OPS bibliographic
(citation-only / fair-use). WIPO PATENTSCOPE content is admitted **only on the
insight tier** (derivative-license clause).

| Method | Path | Tier | Price | Inputs |
|---|---|---|---|---|
| GET | `/patents/search` | query | $0.005 | `q`, `class`, `from`, `to`, `jurisdiction`, `lat`, `lng`, `radius`, `limit` |
| GET | `/patents/{id}` | raw | $0.010 | path: `id` (full grant + claims + backward citations + inventors + assignees + locations bundled) |
| GET | `/patents/by-coord` | query | $0.005 | `lat`, `lng`, `radius` (km) — required; `from`, `to`, `class` |
| GET | `/patents/family/{id}` | query | $0.005 | path: `id` — INPADOC-style cross-jurisdiction equivalents |
| GET | `/patents/citations/{id}` | query | $0.005 | `direction=forward\|backward` (default backward) |
| GET | `/patents/insight` | insight | $0.002 | `question` — top-k summarized hits with §3.2 retrieval provenance |

All responses follow §3 envelope shape. The `citation.license` field is
**jurisdiction-aware**: `CC-BY-4.0` for US (PatentsView / Google Patents BQ),
`EPO-OPS-fair-use` for EP records served via EPO OPS, and `citation-only`
for any other jurisdiction reached by passthrough. `canonical_url` resolves
to USPTO/Google Patents for US, Espacenet for EP, PATENTSCOPE for WO.

The DB layer is abstracted behind a `PatentsRepo` interface in
`routes/patents.ts`; the reference server boots with `MockPatentsRepo` so
`demo.sh` works without a Postgres connection. Production deployments swap in
a Postgres-backed impl loading from the schema in bkt-5qg.

## 7. What's out of scope for v0.2

- Multi-provider federation / registry
- Streaming responses (WebSocket / SSE)
- Refunds, disputes, credit
- Caching / proxy layer semantics
- Rate limiting semantics
- Signature verification of the citation block itself (VDS uses wallet sig;
  `source` does not. A future revision may introduce a provider signature.)
- Required-field promotion of any §4 `index` subfield (stays optional in
  v0.2; revisited in v0.3+)

All deferred to v0.3+. Covered by future amendments to this spec.

---

**That's the whole protocol.** One manifest (optionally with an index
block), stock x402 handshake, one envelope shape (optionally with retrieval
provenance), three query tiers, additive citation-type extension. Anything
more is v0.3.
