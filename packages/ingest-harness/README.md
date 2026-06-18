# @feed402/ingest-harness

Turn any geo+time-coded CSV into a feed402/0.2-compliant x402 endpoint with three tiers
(`/raw`, `/query`, `/insight`) plus the mandatory `/.well-known/feed402.json` manifest.

Used by every Bucket Foundation domain dataset (pharmaceuticals, banking, world-history,
constitutions, etc.) so each dataset bead does **not** reinvent the wire shape.

## Input contract

```
my-dataset/
├── manifest.yaml      # required — provider name, wallet, license, schema, tier prices
├── data.csv           # required — must contain lat, lon, timestamp, source_url, license
└── chunks.jsonl       # optional — for the insight tier (one chunk per line)
```

Required CSV columns:

| Column | Type | Notes |
|---|---|---|
| `id` | string | stable across rebuilds |
| `lat` | number | -90..90, `NaN` allowed for non-geocoded rows |
| `lon` | number | -180..180 |
| `timestamp` | ISO-8601 | event time, NOT ingest time |
| `source_url` | URL | canonical upstream |
| `license` | SPDX or string | per-row, may differ from manifest default |

Any other columns become queryable filters.

## Quick start

```bash
npm install
npx feed402-serve --dataset ./examples/world-history-seed --port 4402
curl http://localhost:4402/.well-known/feed402.json
curl 'http://localhost:4402/query?bbox=-10,30,40,60&from=1500&to=1900&limit=20'
```

Without an x402 wallet signature the server returns `402 Payment Required` per spec §2.
For local dev pass `--no-payment` to bypass settlement (citation envelope still emitted).

## What's implemented (v0)

- [x] Manifest auto-generation from `manifest.yaml`
- [x] `/raw` — paginated CSV passthrough
- [x] `/query` — bbox + time-range + column filters + structured ordering
- [x] `/insight` — top-K retrieval over `chunks.jsonl` (sparse BM25 default; dense if `index.model` set)
- [x] Citation envelope per spec §3 (mandatory)
- [x] `--no-payment` dev bypass; 402 challenge in prod
- [ ] Real x402 settlement verification (deferred — uses x402-research-gateway middleware)
- [ ] Dense embedding precompute (deferred to per-dataset bead)

## Layout

```
src/
├── cli.ts             # `feed402-serve` entrypoint
├── server.ts          # Hono app factory
├── manifest.ts        # YAML → feed402.json
├── csv.ts             # streaming CSV reader + filter
├── query.ts           # bbox/time/column filter compiler
├── insight.ts         # BM25 retrieval over chunks.jsonl
├── envelope.ts        # citation + receipt wrapping
└── x402.ts            # 402 challenge + settlement hook
```
