# feed402 — protocol v0.3

**Author:** Gianangelo Dichio · **License:** CC0 · **Status:** Draft

One page. Built on x402 unchanged. Everything below is the delta a data
provider needs to implement on top of a standard x402 server.

**v0.3 carries exactly one breaking change from v0.2:** `Envelope.citation`
is an array. Everything else added since v0.1 is optional. A client seeing a
newer manifest or envelope **must** ignore unknown fields (see §2.3) and
continue to function, and a v0.3 client querying a v0.1 or v0.2 provider
**must not** require fields added after that provider's version. The break,
its migration path, and its deprecation window are specified in §7.

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
  "spec": "feed402/0.3",
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

### 1.1 Capabilities (v0.3, optional)

`tiers` prices a merchant. It does not describe one. A merchant serving eight
heterogeneous paths across three tiers has no single `/raw`, and two
operations at the same tier are told apart by what they do rather than by
what they cost. An agent reading a tier-only manifest cannot answer whether
the merchant paginates, whether it can return the references of a record, or
which identifier schemes it accepts. It has to hardcode per-merchant
knowledge, which defeats discovery.

A provider MAY advertise a coarse capability summary:

```json
"capabilities": ["search", "fetch", "references", "cited_by", "pagination"]
```

The vocabulary defined by this revision:

| Capability | The operation … |
|---|---|
| `search` | finds records matching a query |
| `fetch` | returns records by identifier |
| `references` | returns the works a record cites (outbound) |
| `cited_by` | returns the works citing a record (inbound) |
| `authors` | resolves or returns author records |
| `institutions` | resolves or returns institution records |
| `datasets` | returns dataset records |
| `software` | returns software records |
| `patents` | returns patent records |
| `vocabulary` | returns terms from a controlled vocabulary |
| `full_text` | returns full text |
| `structured_full_text` | returns full text with structure preserved |
| `assets` | returns non-text representations of a record |
| `bulk` | returns whole partitions rather than result pages |
| `incremental_sync` | returns records changed since a watermark |
| `semantic_search` | finds records by embedding similarity |
| `filters` | constrains results by field predicates |
| `pagination` | pages through a result set larger than one response |

A capability names **what an operation does**. It never names an upstream and
never names a discipline. There is no `pubmed` capability and no `chemistry`
capability.

**The vocabulary is an open extension point** under the §2.3 unknown-field
rule. A merchant MAY advertise a name this revision does not define. A
conformant agent **MUST** degrade such a name to "an operation I do not know
how to drive" and **MUST NOT** reject the manifest.

### 1.2 Operations (v0.3, optional)

`capabilities` is a filter. `operations` is what an agent calls. Each entry
describes one concrete operation:

```json
"operations": [
  {
    "operation_id": "openalex.works.cited_by",
    "capability": "cited_by",
    "path": "/openalex/works/cited-by",
    "method": "POST",
    "tier": "query",
    "pagination_model": "page",
    "identifier_schemes": ["openalex", "doi"],
    "canonical_identifier": "openalex",
    "content_types": ["application/json"]
  }
]
```

| Field | Required | Meaning |
|---|---|---|
| `operation_id` | yes | Stable id, distinct from the path, unique within the manifest. A merchant may re-route or version a path; this is what an agent caches. |
| `capability` | yes | Which capability the operation fulfills. |
| `path` | yes | Absolute request path. |
| `method` | no | Defaults to `POST`. |
| `tier` | no | Which `tiers` entry prices this operation. MUST name a declared tier. |
| `input_schema` | no | URL to a JSON Schema, or an inline schema object, so an agent can construct the call. |
| `output_schema` | no | Same, for `Envelope.data`. |
| `pagination_model` | no | `none`, `offset`, `page`, `cursor`, or `token`. Defaults to `none`. |
| `identifier_schemes` | no | Identifier namespaces the operation accepts. Namespace strings are opaque to this spec. |
| `canonical_identifier` | no | Which of those is canonical for results, so agents can pick a join key. |
| `content_types` | no | Media types returned. |

The five pagination models are the ones reference merchants already use:
`offset` (PubMed `retstart`, Semantic Scholar `offset`), `page` (OpenAlex
`page`/`per_page`), `token` (ClinicalTrials.gov `pageToken`), `cursor`
(opaque resumable cursors), and `none`.

**`tiers` stays required and keeps its meaning.** It remains the pricing view
and the fallback path for tier-shaped agents written against 0.2. Operations
reference a tier for their price rather than restating it. Where
`capabilities` and `operations` disagree, `operations` is authoritative,
because it names concrete callable paths.

### 1.3 Migrating the gateway's `routes` (v0.3)

The reference gateway shipped two non-spec manifest fields before this
revision existed: `routes`, the full enumeration of concrete paths, and
`tier_routes`, the same entries grouped by tier. `tiers` carried the
cheapest route of each tier so a tier-shaped agent could still function.
`operations` is the spec-blessed replacement for both.

The migration is mechanical, and `types.ts` ships it as
`operationsFromLegacyRoutes()`:

| Legacy `routes[]` | `operations[]` |
|---|---|
| `id` | `operation_id` |
| `path` | `path` |
| `method` | `method` |
| `tier` | `tier`, when it names a declared tier |
| `description` | `description` |
| `price` | dropped; `tier` already points at the price |
| `citation` | dropped; citation metadata belongs in the envelope (§3) |

`tier_routes` is not migrated because it carries nothing new: it is
`operations` grouped by `tier`.

A legacy route carries no capability, so the migration infers one. The
inference distinguishes only `search` from `fetch`, because those are the
only intents recoverable from a path with any confidence. **A merchant that
wants to be discovered accurately MUST declare `operations` explicitly**
rather than rely on inference.

Consumers SHOULD read operations through `manifestOperations()`, which
prefers `operations` and falls back to migrating `routes`, so un-migrated
merchants keep working for the whole deprecation window (§7.2).

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
fields to the manifest and envelope without breaking older consumers. If a
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

The `citation` block is **mandatory** and is **always an array** (length >= 1
on success). No citation, not feed402. This is the one thing raw x402
middleware does not enforce — it must live inside the response envelope.

The citation array is the **single evidence channel** for the envelope. A
merchant MUST NOT put per-result evidence anywhere else and expect an agent
to find it. Evidence smuggled into `data` (a `hits` array, a `citations`
array, a `sources` list) is not protocol data; a conformant consumer reads
`citation` and nothing else. §7 lists the two such fields shipped by
reference merchants before 0.3 and their deprecation.

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
"citation": [{
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
}]
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
"citation": [{
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
  },
  "result_index": [2]
}]
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

### 3.3 Result-to-citation correspondence (v0.3, normative)

Define the envelope's **result list** as the ordered array of records in
`data`: `data.rows` when present, otherwise `data.top_k`, otherwise the
value of `data` itself when `data` is an array. A response whose `data` is
a scalar or a single object with no such array is **single-record**.

1. **Single-record responses return exactly one citation.** The array has
   length 1 and that citation grounds the whole response.
2. **Ordinal alignment is the default.** For a multi-record response,
   `citation[i]` grounds result `i`. This requires
   `citation.length === results.length`.
3. **Explicit binding overrides alignment.** A citation MAY carry
   `result_index`, an array of zero-based indices into the result list
   naming every result it grounds. If any citation in the array carries
   `result_index`, **every** citation in that array MUST carry it, and
   ordinal alignment does not apply.
4. **Deduplication requires explicit binding.** A merchant that emits fewer
   citations than results — because two results came from one source
   record — MUST use `result_index`. It MUST NOT silently emit a short
   array and leave the consumer guessing.
5. **The dedup key is `chunk_id` when present, otherwise `source_id`.**
   `canonical_url` is a *locator*, not an identity: two distinct records can
   legitimately resolve to the same URL (a paper and its erratum landing on
   one publisher page), and a record may have no `canonical_url` at all.
   Merchants MUST NOT merge two citations that differ in
   `chunk_id`/`source_id` merely because their `canonical_url` matches.
   Citations with an identical dedup key MUST be merged into one entry whose
   `result_index` lists every result they grounded.
6. **A zero-result response still carries one citation** identifying the
   queried collection, so the agent can attribute the negative answer. It
   has an empty `data` result list, `citation.length === 1`, and that
   citation carries `result_index: []`.

> **Why not dedup on `canonical_url`.** The 0.2 draft said "deduplicated by
> `canonical_url`". That rule silently collapses distinct records that share
> a landing page and is undefined when the field is absent, so 0.3 replaces
> it with an identity-based key. This is a clarification of an underspecified
> rule, not a new wire field. A 0.2 merchant that deduplicated by URL and one
> that did not both remain parseable.

Retrieval provenance (§3.2) is bound by the same rule: `chunk_id`, `score`,
and `rank` on `citation[i]` describe the retrieval that produced the
result(s) `citation[i]` grounds. `retrieval.rank` is a position in the
*retrieval ranking*; `result_index` is a position in the *result list*. They
coincide only when the merchant returns results in retrieval order without
deduplicating.

### 3.4 Structured rights (v0.3, optional)

`license` is one string. It cannot say that NCBI publishes the bibliographic
record into the public domain while the article it describes stays under
publisher copyright, and it cannot say whether an agent may mine what it just
paid for. A merchant serving several upstreams ends up emitting
`citation_policy: "mixed"`, which teaches an agent nothing.

A `source`-typed citation MAY carry an optional `rights` block:

```json
"citation": [{
  "type": "source",
  "source_id": "pubmed:12345678",
  "provider": "example-pubmed-mirror",
  "retrieved_at": "2026-08-17T10:30:00Z",
  "license": "public-domain",
  "rights": {
    "metadata": { "license": "CC0-1.0", "status": "allowed" },
    "content":  { "license": "all-rights-reserved", "status": "denied" },
    "redistribution": "denied",
    "tdm": "allowed",
    "model_training": "unknown",
    "retention": "allowed",
    "terms_url": "https://www.ncbi.nlm.nih.gov/home/about/policies/",
    "retrieved_at": "2026-08-01T00:00:00Z",
    "provider_release": "eutils-2026-07"
  }
}]
```

#### Scopes

`metadata` covers the bibliographic or descriptive record. `content` covers
the body, abstract, full text, or payload. Each is an object:

| Field | Type | Meaning |
|---|---|---|
| `license` | string | License identifier as the provider states it. |
| `license_url` | string | Where that identifier is defined. |
| `status` | `allowed \| denied \| unknown` | Whether the scope may be used at all. |
| `tiers` | array of tier names | The tiers on which the merchant may serve this scope. Absent means no tier restriction. |

#### Action facets

Four facets answer "may the agent do this", each valued
`"allowed"`, `"denied"`, or `"unknown"`:

| Facet | The question |
|---|---|
| `redistribution` | May the agent republish what it received. |
| `tdm` | May the agent text- and data-mine it. |
| `model_training` | May the agent train or fine-tune a model on it. |
| `retention` | May the agent keep the body after answering. |

`citation_only: true` is shorthand for the common "reference and link it,
keep nothing" grant: it denies `redistribution` and `retention` while leaving
reference and linking permitted. A merchant MAY emit both the shorthand and
the explicit facets; when it does, they MUST agree. A `citation_only: true`
block carrying `redistribution: "allowed"` is non-conformant.

#### The unknown rule (normative)

**`unknown` is never `allowed`.** A consumer **MUST** treat `"unknown"`, an
absent facet, and an absent `rights` block alike: the action is not granted.
An agent that wants to mine a record and reads `tdm: "unknown"` has been told
no, and a merchant that has not determined whether mining is permitted
**SHOULD** emit `"unknown"` rather than omitting the facet, so the consumer
can tell "we looked and could not tell" from "we said nothing."

`permits()` in `types.ts` is the reference reading of this rule and returns
`false` for every case except an explicit `"allowed"`.

#### Auditability

Rights are versioned data. `terms_url` records the provider's terms as they
were read, `retrieved_at` records when, and `provider_release` records the
release under which. A determination made in 2026 stays auditable after the
provider rewrites its terms. A block carrying `terms_url` without
`retrieved_at` is a warning: the determination cannot be dated.

`jurisdiction` scopes a determination to a legal jurisdiction where the
provider's terms are jurisdiction-dependent. `notes` carries what the fields
above cannot.

#### Relationship to `license`

`license` keeps its v0.1 meaning and stays valid on its own. Every merchant
emitting only `license` today remains conformant, and `license` remains the
human-readable summary. Where both are present, a consumer acts on `rights`
and reads `license` as prose. A summary that contradicts the block is a
warning, never a silent reinterpretation of either field.

#### Where the block attaches

A rights block attaches at record level (on a citation), at asset level
(§3.5), and at manifest level as the provider's default determination.
**Resolution is nearest-wins and whole-block: asset, then citation, then
manifest.** There is no field-level merge. A citation carrying `rights`
replaces the manifest default in full, because a half-inherited
determination is a determination nobody made. `effectiveRights()` in
`types.ts` implements this.

`Manifest.citation_policy` keeps its meaning as the provider-wide summary. A
multi-source merchant whose policy string is `"mixed"` **SHOULD** emit
per-citation `rights` rather than leaning on the default.

#### Non-goal

The block records what the provider states and when that statement was read.
It is not legal advice and carries no inference. A merchant **MUST NOT**
synthesize a rights determination the provider did not make; the honest
answer for an undetermined facet is `"unknown"`.

### 3.5 Assets and representations (v0.3, optional)

A citation carries at most one URL per record, `canonical_url`. One work
routinely has many representations, and the difference between them is what an
agent needs: a CC-BY abstract, an all-rights-reserved publisher PDF, a
green-OA accepted manuscript in a repository, a JATS full text in PMC, a TeX
source on arXiv, a supplementary dataset, a figure. A merchant that has
located an open-access PDF has nowhere to put it.

A `source`-typed citation MAY carry an optional `assets` array:

```json
"citation": [{
  "type": "source",
  "source_id": "doi:10.1038/s41586-021-03819-2",
  "provider": "example-oa-locator",
  "retrieved_at": "2026-08-17T10:30:00Z",
  "canonical_url": "https://doi.org/10.1038/s41586-021-03819-2",
  "assets": [
    {
      "asset_id": "oa-pdf",
      "representation": "pdf",
      "mime_type": "application/pdf",
      "canonical_url": "https://repo.example.edu/bitstream/1234/manuscript.pdf",
      "checksum": "sha256:9f2c4b1e77aa0d3e5c8b6a4f2109ed7b3c5a8f01d2e4b6c8a0f2e4d6b8c0a2e4",
      "size": 2418734,
      "availability": "retrievable",
      "rights": { "content": { "license": "CC-BY-4.0", "status": "allowed" },
                  "redistribution": "allowed", "tdm": "allowed" },
      "retrieved_at": "2026-08-17T10:29:55Z"
    },
    {
      "asset_id": "publisher-pdf",
      "representation": "pdf",
      "mime_type": "application/pdf",
      "canonical_url": "https://www.nature.com/articles/s41586-021-03819-2.pdf",
      "availability": "restricted",
      "rights": { "content": { "license": "all-rights-reserved", "status": "denied" },
                  "redistribution": "denied", "tdm": "unknown" }
    }
  ]
}]
```

#### Fields

| Field | Required | Meaning |
|---|---|---|
| `asset_id` | yes | Stable within the provider. MUST be unique within one citation. |
| `representation` | yes | The role this asset plays for the record. |
| `mime_type` | no | Media type. |
| `content_type` | no | Structural type where a MIME type is too coarse, e.g. `"jats-1.3"` where `application/xml` says nothing. |
| `canonical_url` | no | The stable public address of this representation. |
| `provider_url` | no | Where this provider will serve or redirect, when it differs from the canonical address. |
| `checksum` | no | `"<algorithm>:<hex>"`, e.g. `"sha256:c6a9…f31e"`. |
| `size` | no | Size in bytes, a non-negative integer. |
| `version` | no | Provider-assigned version of this representation. |
| `rights` | no | The §3.4 block, per asset. |
| `availability` | no | Defaults to `"unknown"`. |
| `retrieved_at` | no | ISO-8601. When the merchant last established these facts. |

#### The `representation` vocabulary

`metadata`, `abstract`, `html`, `jats`, `tei`, `tex`, `pdf`, `supplement`,
`dataset`, `software`, `image`, `table`.

**The vocabulary is an open extension point** under §2.3. A merchant MAY emit
a name this revision does not define, and a consumer **MUST** degrade it to "a
representation I do not know how to use" and **MUST NOT** reject the envelope.

#### Availability

| Value | Meaning |
|---|---|
| `retrievable` | The merchant believes the asset can be fetched now. |
| `restricted` | The asset exists and the agent may not have it. |
| `absent` | The merchant looked and this representation does not exist. |
| `unknown` | Not determined. Also the reading of an omitted `availability`. |

`restricted` and `absent` are different answers and an agent acts differently
on each: "this article has a publisher PDF behind a paywall" is a lead, and
"there is no open-access copy" ends a search. An `absent` asset has nowhere to
point, so carrying an address alongside it is a warning.

#### Discovery is not a rights grant (normative)

Listing an asset says the merchant knows the asset exists at an address. It
says **nothing** about whether the agent may fetch, redistribute, mine, retain,
or train on it. That is what the per-asset `rights` block is for, and the §3.4
unknown rule applies unchanged: an asset with no rights block anywhere in the
resolution chain grants nothing, however `retrievable` it is. `assetRights()`
in `types.ts` resolves asset, then citation, then manifest, nearest wins whole.

A merchant **MUST NOT** treat `availability: "retrievable"` as a licence to
serve the bytes, and a consumer **MUST NOT** read it as one.

#### Backwards compatibility

`canonical_url` at record level keeps its current meaning: the stable public
address of the record. No merchant is required to emit `assets`, and a
merchant emitting only `canonical_url` remains fully conformant. Assets are
additive, and a record-level `canonical_url` alongside an `assets` array is
the expected shape rather than a duplication to be resolved.

#### Non-goal

feed402 defines how assets are described. It does not define a proxy, a fetch
semantic, or a caching layer for them.

### 3.6 Execution provenance (v0.3, optional)

§3.2 and §4 make one claim reproducible: given `(provider, corpus_sha256,
chunk_id, model)`, a second party with the same local dense index can
recompute the score. That claim holds only for a merchant whose entire
answer is one embedding lookup over a static local corpus. It does not hold
for a merchant that proxies a live upstream — PubMed E-utilities, OpenAlex,
Semantic Scholar, ClinicalTrials.gov, PubChem — because there is no local
index to declare. §3.2 gives such a merchant nothing to emit, so it looks
identical to a merchant that could describe its execution and chose not to.
This section generalizes retrieval provenance into **execution provenance**:
enough information to tie a result to the run that produced it, whether that
run was a local vector lookup, an upstream proxy call, or a multi-step
pipeline.

§3.2's fields (`chunk_id`, `retrieval.model/score/rank`) keep their current
meaning unchanged and remain the right fields for a local-index merchant.
Execution provenance is additive alongside them, not a replacement.

```json
"citation": [{
  "type": "source",
  "source_id": "pubmed:12345678",
  "provider": "example-pubmed-proxy",
  "retrieved_at": "2026-08-17T10:30:00Z",
  "execution": {
    "level": 2,
    "request_id": "req_01JBX3Z8QK",
    "query_fingerprint": "sha256:9c1f...a04e",
    "provider_request_fingerprint": "sha256:71ab...ee02",
    "retrieval_pipeline": "gateway.pubmed.search",
    "software": "x402-research-gateway",
    "software_version": "0.6.2",
    "git_commit": "a1b2c3d",
    "provider_release": "eutils-2026-07",
    "response_sha256": "sha256:44de...19b0"
  }
}]
```

#### Fields

An `execution` block attaches to a citation. All fields are optional; a
merchant emits the ones its architecture can honestly produce and omits the
rest, which is a valid, conformant, lower level (see below).

| Field | Type | Identifies |
|---|---|---|
| `level` | `0 \| 1 \| 2 \| 3` | The conformance level this block actually reaches. See below. |
| `request_id` | string | This specific call. Opaque, merchant-scoped. |
| `query_fingerprint` | string | The query that produced this result, without revealing it. See Privacy. |
| `query_plan_fingerprint` | string | The resolved query plan (expanded filters, routed sub-queries) when it differs from the raw query. |
| `provider_request_fingerprint` | string | The exact upstream request this merchant issued, credentials excluded. See Privacy. |
| `corpus_sha256` | string | Same meaning as `IndexManifest.corpus_sha256` (§4.1); present here when it varies per citation rather than being constant for the whole manifest. |
| `index_id` | string | Which index served this result, for a merchant running more than one. |
| `index_build` | string | The build/version of that index, when it revises independently of `IndexManifest.built_at`. |
| `provider_release` | string | The upstream API version or release train the merchant proxied against, e.g. `"eutils-2026-07"`. Same field as §3.4's `Rights.provider_release`; one spelling, two attachment points. |
| `retrieval_pipeline` | string | Named identifier for the code path that produced this result, e.g. `"gateway.pubmed.search"`. Open string. |
| `software` | string | The software that ran the execution, e.g. `"x402-research-gateway"`. Shared spelling with §3.7's lineage software identity — see Reconciliation below. |
| `software_version` | string | Version of `software`. |
| `git_commit` | string | Commit hash of the running build, when the merchant publishes one. |
| `response_sha256` | string | Hash of the exact upstream response body the merchant received, before any transformation. Enables byte-level replay against a pinned upstream release. |

#### Conformance levels

A merchant advertises how much of this it does in the manifest:
`Manifest.provenance_level: 0 | 1 | 2 | 3`. Levels are cumulative; a merchant
at level 2 satisfies everything level 1 asks. A merchant MAY emit a citation
whose actual `execution.level` is lower than its manifest default — the
citation-level `level` is authoritative for that citation.

| Level | Requires | What it buys an agent |
|---|---|---|
| 0 | Nothing. No `execution` block. | Unchanged from today; still a valid feed402 merchant. |
| 1 | `request_id` (and `query_fingerprint` when the merchant wants calls linkable). | "This response came from a specific execution," with no claim about what that execution was. |
| 2 | Level 1, plus whichever of `corpus_sha256` / `index_id` / `index_build` / `provider_release` / `retrieval_pipeline` / `software` / `software_version` apply to this merchant's architecture. | The §4.2 reproducibility argument: enough to say what ran, against what corpus or upstream release. |
| 3 | Level 2, plus `response_sha256`. | Byte-level replay: a second party holding the same upstream release can verify the merchant did not alter what it received before citing it. |

An agent that requires level 2 reads `Manifest.provenance_level` before
paying and skips merchants below it, the same filtering pattern §1.1
capabilities already establish.

#### Privacy (normative)

A user's question is routinely the sensitive part of a feed402 call, and a
merchant publishing it in a citeable, re-servable envelope leaks it to every
downstream reader of that citation.

- Emitting the plaintext query is **permitted** and **never required**. No
  field in this section accepts plaintext query text.
- `query_fingerprint` **MUST** be a one-way construction over the normalized
  query: a salted or keyed digest (HMAC-SHA256 with a merchant-held key, or
  SHA-256 with a merchant-held salt not published anywhere in the manifest
  or envelope). The exact algorithm is merchant-chosen; the requirement is
  that two calls carrying the same query produce the same fingerprint within
  one provider, and that the fingerprint does not let a holder recover the
  query. A merchant **MUST NOT** use unsalted SHA-256 of the raw query
  string, which is reversible by dictionary against any guessable query
  space.
- `provider_request_fingerprint` is computed the same way, over the upstream
  request the merchant actually issued, **after** excluding: API keys,
  bearer tokens, session cookies, signature parameters, and personally
  identifying query parameters such as a polite-pool `email`/`mailto` value.
  This is the same exclusion list `conformance/validate.ts`'s
  `CREDENTIAL_PARAMS` already enforces against published URLs (§3.4); a
  merchant computing this fingerprint over the raw outgoing request before
  applying that exclusion list produces a hash a determined holder can
  brute-force back to a live credential, which defeats the purpose of
  hashing it in the first place.
- `response_sha256` covers response bytes, not request parameters, and
  carries no privacy exclusion of its own — a merchant with an upstream
  response containing a caller-identifying value in the body SHOULD scrub it
  before hashing, or omit `response_sha256` for that call.

#### Reconciliation with §3.7 lineage

Both this section and §3.7 need to say "this software, this version" for a
run. They share one spelling: `software` / `software_version` / `git_commit`
mean the same thing in an `execution` block and in a lineage step. A
merchant that already emits `execution.software_version` for a citation
SHOULD reuse the identical string in the corresponding lineage step's
`software_version` rather than restating the fact under a different name.

#### Worked example: the reference gateway

`x402-research-gateway`'s proxying routes (`internal/handler/feed402.go`)
own no retrieval index — the code comment states this directly — so they
cannot honor §4's `IndexManifest` or §3.2's `retrieval.model/score/rank`.
Under this section they are not exempt from provenance, only from the
local-index subset of it. A proxying route populates:

```json
"execution": {
  "level": 2,
  "request_id": "req_01JBX3Z8QK",
  "query_fingerprint": "sha256:9c1f...a04e",
  "provider_request_fingerprint": "sha256:71ab...ee02",
  "retrieval_pipeline": "gateway.pubmed.search",
  "software": "x402-research-gateway",
  "software_version": "0.6.2",
  "provider_release": "eutils-2026-07"
}
```

`internal/handler/insight.go` additionally identifies its summarizer as
`mock:template-v1` or `openai:<model>`; that string becomes
`execution.software` = the summarizer identity, with `retrieval_pipeline`
naming the upstream retrieval route it fanned out to before summarizing.
§3.7 covers the summarization step itself as a lineage transformation; this
section covers only "what executed," not "what was derived from what."

#### Non-goal

This section does not define a query language, a replay protocol, or a
verification service. It defines the fields a merchant needs to make replay
and reproduction *possible* for a party willing to build one.

### 3.7 Derivation and lineage provenance (v0.3, optional)

`citation` grounds `data` in sources, which is sufficient for `raw` and
`query`. It is not sufficient for `insight`, or for anything computed. The
`insight` tier already produces derived output — the reference gateway's
`insight.go` runs a retrieval route, truncates snippets to
`maxContextChars`, and passes them to a summarizer — and the envelope shows
citations and answer text but not that a transformation happened, which
software produced it, which snippets went in, or that truncation occurred.
Two merchants running different summarizers over identical sources return
indistinguishable envelope shapes. The same gap blocks an agent that merges
results from several feed402 merchants, dedupes them, and reranks: the
merged object's relationship to its inputs is unrepresentable, so the
provenance chain ends at the first hop.

#### Lineage entries

An envelope MAY carry a top-level `lineage` array. Lineage is additive and
never displaces citations — a lineage-bearing envelope still carries the
full mandatory `citation` array from §3, and `sources` in a lineage entry
references into that array rather than restating it:

```json
{
  "data": { "answer": "..." },
  "citation": [
    { "type": "source", "source_id": "pubmed:111", "...": "..." },
    { "type": "source", "source_id": "pubmed:222", "...": "..." }
  ],
  "lineage": [
    {
      "step": 0,
      "derived_object": "insight:req_01JBX3Z8QK#context",
      "sources": [0, 1],
      "transformation": "context_assembly",
      "software": "x402-research-gateway",
      "software_version": "0.6.2",
      "timestamp": "2026-08-17T10:30:00.100Z",
      "notes": "truncated to maxContextChars=4000; both snippets kept in full"
    },
    {
      "step": 1,
      "derived_object": "insight:req_01JBX3Z8QK#answer",
      "sources": ["insight:req_01JBX3Z8QK#context"],
      "transformation": "summarization",
      "software": "openai:gpt-4o-mini",
      "timestamp": "2026-08-17T10:30:01.400Z"
    }
  ],
  "receipt": { "...": "..." }
}
```

#### Fields

| Field | Type | Meaning |
|---|---|---|
| `step` | number | Zero-based order within this envelope's `lineage` array. Steps execute in ascending order. |
| `derived_object` | string | Identity of the object this step produced. Opaque to the spec; a merchant-chosen string stable enough to be referenced as a `sources` entry by a later step or by another merchant. |
| `sources` | array | What this step consumed. Each entry is either a non-negative integer index into `citation` (a step consuming a source citation directly) or a string matching an earlier step's `derived_object` (a step consuming a prior step's output). |
| `transformation` | string | What operation this step performed. Open string under §2.3 — no required vocabulary. Examples in this revision's worked example: `context_assembly`, `summarization`, `dedup`, `rerank`, `merge`. A merchant MAY use any string that names its operation. |
| `software` | string | Same spelling as §3.6's `execution.software`. The software or model identity that ran this step. |
| `software_version` | string | Same spelling as §3.6's `execution.software_version`. |
| `git_commit` | string | Same spelling as §3.6's `execution.git_commit`. |
| `timestamp` | string | ISO-8601. When this step ran. |
| `notes` | string | Free text for a fact the fields above cannot carry, e.g. a truncation that happened during this step. |

Only `derived_object`, `sources`, and `transformation` are required on a
lineage entry that is present at all; `lineage` itself remains entirely
optional at the envelope level.

#### Multi-step composition

A pipeline with more than one transformation emits one lineage entry per
step rather than a single collapsed entry, because collapsing hides exactly
the fact this section exists to expose — that context assembly and
summarization are different operations with potentially different software
identities, and a consumer auditing "did truncation happen before or after
summarization" needs the steps distinguished. A merchant with a genuinely
single-step pipeline emits a `lineage` array of length 1.

Cross-merchant composition follows from `derived_object` being an opaque
string: an agent that merges results from feed402 merchant A and merchant B
can emit its own `lineage` entry (if it re-publishes a feed402 envelope of
its own) whose `sources` cites `derived_object` strings or `source_id`
values produced by A and B. Nothing in this section requires the merging
agent to be a feed402 merchant itself; the composition rule exists so that
one can be, without a new field.

#### PROV alignment

[W3C PROV](https://www.w3.org/TR/prov-overview/) models exactly this
entity/activity/agent relationship, and is the obvious prior art. This
section is **not** a PROV serialization. A full PROV document (PROV-O,
PROV-JSON, or PROV-XML) carries qualified relations, bundles, and an
extensible ontology of relation types that are heavier than a JSON object an
agent parses while deciding whether a $0.002 call is worth spending on. The
decision is a documented crosswalk, not adoption:

| feed402 lineage | PROV concept |
|---|---|
| `derived_object` | `prov:Entity` |
| a lineage step (`transformation` + `timestamp`) | `prov:Activity` |
| `software` / `software_version` / `git_commit` | `prov:Agent` (specifically `prov:SoftwareAgent`) |
| a `sources` entry pointing at a citation | `prov:used` (Activity used Entity) |
| a `sources` entry pointing at a prior `derived_object` | `prov:wasDerivedFrom` (Entity derived from Entity), mediated by the consuming Activity |
| the step that produced `derived_object` | `prov:wasGeneratedBy` (Entity generated by Activity) |
| `software` running a step | `prov:wasAssociatedWith` (Activity associated with Agent) |

A merchant or downstream tool that wants full PROV interop can project a
feed402 `lineage` array into this shape mechanically. feed402 itself stays
the small object; PROV projection is a consumer's choice, not a wire
requirement. This crosswalk MAY grow in a future revision if a real
consumer needs bundle- or qualification-level PROV features; none has been
identified as of this writing.

#### Worked example: the reference gateway's insight pipeline

`internal/handler/insight.go` runs three logical steps: fan out to a
retrieval route, truncate context to `maxContextChars`, then summarize.
Steps 1 and 2 share one lineage entry (`context_assembly`) because
truncation is a property of assembly, not a separately identified
transformation in the current implementation; summarization is its own step
because it is where the software identity changes from the gateway itself
to a named summarizer (`mock:template-v1` or `openai:<model>`):

```json
"lineage": [
  {
    "step": 0,
    "derived_object": "insight:req_01JBX3Z8QK#context",
    "sources": [0, 1],
    "transformation": "context_assembly",
    "software": "x402-research-gateway",
    "software_version": "0.6.2",
    "timestamp": "2026-08-17T10:30:00.100Z",
    "notes": "maxContextChars=4000 applied; 2 of 2 snippets retained"
  },
  {
    "step": 1,
    "derived_object": "insight:req_01JBX3Z8QK#answer",
    "sources": ["insight:req_01JBX3Z8QK#context"],
    "transformation": "summarization",
    "software": "openai:gpt-4o-mini",
    "timestamp": "2026-08-17T10:30:01.400Z"
  }
]
```

#### Non-goal

No scientific transformation taxonomy. `transformation` names an operation,
never a discipline; a merchant summarizing patents, deduping sensor
readings, or joining two proprietary tables all use this same field with a
string of their own choosing.

## 4. Index manifest (v0.2, optional)

A provider that backs its `query` or `insight` tier with a retrieval index
(dense embeddings, sparse BM25, or hybrid) MAY declare that index in the
top-level `index` block of `/.well-known/feed402.json`:

```json
{
  "name": "kruse-feed402",
  "spec": "feed402/0.3",
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

v0.2 defined three `type` values; future revisions MAY add more. Consumers
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

The whole `index` block is optional. A merchant with no
embeddings continues to serve a manifest with no `index` field and remains
fully spec-compliant under v0.3. An agent that requires an index SHOULD
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

### 6.1.1 The jurisdiction rules as a structured rights block

The two paragraphs above state the jurisdiction and tier rules in prose
because v0.2 had no schema for them. §3.4 does, and this is the worked
translation. `fixtures/v0.3/insight-rights-patents-jurisdiction.json` carries
all three cases in one envelope.

**US, PatentsView or Google Patents BigQuery.** Both upstreams are CC-BY-4.0,
so metadata and content carry the same license and every action is granted:

```json
"rights": {
  "jurisdiction": "US",
  "metadata": { "license": "CC-BY-4.0", "status": "allowed" },
  "content":  { "license": "CC-BY-4.0", "status": "allowed" },
  "redistribution": "allowed", "tdm": "allowed",
  "model_training": "allowed", "retention": "allowed",
  "terms_url": "https://www.uspto.gov/terms-use-uspto-websites",
  "retrieved_at": "2026-08-01T00:00:00Z",
  "provider_release": "patentsview-2026-07"
}
```

**EP via EPO OPS.** Bibliographic data is servable, the body is not, and the
fair-use terms cover neither mining nor training. `citation_only` carries the
"reference and link, keep nothing" half; the two remaining facets are stated
outright:

```json
"rights": {
  "jurisdiction": "EP",
  "metadata": { "license": "EPO-OPS-fair-use", "status": "allowed" },
  "content":  { "license": "EPO-OPS-fair-use", "status": "denied" },
  "citation_only": true,
  "tdm": "denied", "model_training": "denied",
  "terms_url": "https://www.epo.org/en/legal/terms-of-use",
  "retrieved_at": "2026-08-01T00:00:00Z",
  "provider_release": "ops-3.2"
}
```

**WO via PATENTSCOPE.** The derivative-license clause admits content on the
`insight` tier alone. `content.tiers` says so in the schema, which is the
rule §6.1 could previously state only in prose. Mining is undetermined, and
`"unknown"` says that without granting it:

```json
"rights": {
  "jurisdiction": "WO",
  "metadata": { "license": "citation-only", "status": "allowed" },
  "content":  { "license": "WIPO-PATENTSCOPE-derivative",
                "status": "allowed", "tiers": ["insight"] },
  "redistribution": "denied", "tdm": "unknown",
  "model_training": "denied", "retention": "denied",
  "terms_url": "https://patentscope.wipo.int/search/en/help/terms.jsf",
  "retrieved_at": "2026-08-01T00:00:00Z"
}
```

The provider-wide default lives in the manifest
(`fixtures/v0.3/manifest-rights-default.json`) and covers US records. EP and
WO citations carry their own block, which replaces that default whole per
§3.4. `citation_policy: "mixed"` survives as the human summary and stops
being the only machine-readable answer.

The DB layer is abstracted behind a `PatentsRepo` interface in
`routes/patents.ts`; the reference server boots with `MockPatentsRepo` so
`demo.sh` works without a Postgres connection. Production deployments swap in
a Postgres-backed impl loading from the schema in bkt-5qg.

## 7. Migration to v0.3

### 7.1 The break: `citation` object to array

v0.1 and v0.2 shipped `Envelope.citation` as a single object. v0.3 makes it
an array so multi-record tiers can ground every result without smuggling
evidence into `data`. This is the only breaking change in 0.3.

**Consumers.** A 0.3 consumer MUST prefer `envelope.citation` as an array.
Reading a historical envelope is a one-line normalization:

```ts
const citations = Array.isArray(env.citation) ? env.citation : [env.citation];
```

`toCanonicalEnvelope()` in `types.ts` does exactly this and is what the
conformance suite uses to read v0.1/v0.2 fixtures.

**Merchants.** A 0.3 merchant MUST emit the array. During the migration
window it MAY additionally emit `citation_legacy`, a copy of `citation[0]`,
for consumers still on 0.2. `citation_legacy` is advisory: a 0.3 consumer
MUST NOT require it and MUST NOT prefer it over the array.

### 7.2 Deprecated aliases and their sunset

| Field | Where | Replacement | Mapping | Sunset |
|---|---|---|---|---|
| `citation_legacy` | envelope, any merchant | `citation[0]` | identity | `feed402/0.5` |
| `hits[]` | `data`, x402-research-gateway search tiers | `citation[]` | `hits[i].source_id` → `citation[i].source_id`; `hits[i].canonical_url` → `citation[i].canonical_url`; `hits[i].rank` → `citation[i].retrieval.rank`; `hits[i]` position → `citation[i].result_index` | `feed402/0.5` |
| `citations[]` | `data`, ingest-harness `/query` | `citation[]` | element-wise identity, ordinally aligned | `feed402/0.5` |
| `routes[]` | manifest, x402-research-gateway | `operations[]` | §1.3 | `feed402/0.5` |
| `tier_routes{}` | manifest, x402-research-gateway | `operations[]` grouped by `tier` | §1.3 | `feed402/0.5` |

Sunset means: at `feed402/0.5` a conformant consumer stops reading these
fields, and a conformant merchant stops emitting them. Until then they are
duplicates of authoritative data, never the only copy. Emitting an alias
whose content disagrees with the `citation` array is non-conformant.

`routes` and `tier_routes` were never spec fields, so their removal is not a
protocol break. They are listed here because the reference gateway published
them and agents may be reading them. A merchant SHOULD emit `operations`
alongside `routes` during the window, and consumers reading through
`manifestOperations()` handle either.

### 7.3 Historical fixtures

`fixtures/legacy/` holds v0.1 and v0.2 envelopes and manifests captured
before the break. They are never rewritten in place. The conformance suite
parses them under the legacy rules on every run, so a change that makes an
old envelope unreadable fails CI.

### 7.4 What is not breaking

The §2.3 unknown-field rule is unchanged. Everything else 0.3 adds
(`result_index`, `citation_legacy`) is optional. A 0.2 manifest is a valid
0.3 manifest apart from its `spec` string.

## 8. What's out of scope for v0.3

- Multi-provider federation / registry
- Streaming responses (WebSocket / SSE)
- Refunds, disputes, credit
- Caching / proxy layer semantics
- Rate limiting semantics
- Signature verification of the citation block itself (VDS uses wallet sig;
  `source` does not. A future revision may introduce a provider signature.)
- Required-field promotion of any §4 `index` subfield (stays optional)

All deferred to v0.4+. Covered by future amendments to this spec.

---

**That's the whole protocol.** One manifest, optionally carrying an index
block and a capability-and-operations description, stock x402 handshake, one
envelope shape with a mandatory citation array, three query tiers, additive
citation-type and capability extension points.
