/**
 * feed402 v0.3 — shared types
 * These mirror SPEC.md §1 (manifest), §3 (envelope), §4 (index manifest).
 * Keep this file in sync with the spec; it is intentionally small.
 *
 * v0.3 carries one breaking change from v0.2: `Envelope.citation` is an
 * array. Everything else added since v0.1 is optional, and consumers must
 * ignore unknown fields per SPEC §2.3.
 */

/** Canonical protocol version string emitted in `Manifest.spec`. */
export const SPEC_VERSION = "feed402/0.3" as const;

/** Protocol versions this repo can parse, oldest first. */
export const KNOWN_SPEC_VERSIONS = [
  "feed402/0.1",
  "feed402/0.2",
  "feed402/0.3",
] as const;

/**
 * Version at which the deprecated aliases introduced for the 0.3 migration
 * (`Envelope.citation_legacy` and the gateway's `hits` array) stop being
 * read by conformant consumers. See SPEC.md §7.
 */
export const DEPRECATION_SUNSET_VERSION = "feed402/0.5" as const;

// ---------- §1: Discovery manifest ----------

export type TierName = "raw" | "query" | "insight";

export interface TierSpec {
  path: string;
  price_usd: number;
  unit: "row" | "call";
}

export interface Manifest {
  name: string;
  version: string;
  /** Protocol version, e.g. "feed402/0.2". Use the SPEC_VERSION constant. */
  spec: string;
  chain: "base" | "base-sepolia" | string;
  wallet: `0x${string}`;
  tiers: Partial<Record<TierName, TierSpec>>;
  schema_url?: string;
  citation_policy?: string;
  citation_types: CitationType[];
  contact?: string;
  /**
   * §4 (v0.2, optional) — retrieval index backing the `query` / `insight`
   * tiers. Omitted by pure `raw` merchants or by providers that do not wish
   * to expose retrieval internals.
   */
  index?: IndexManifest;
  /**
   * §1.1 (v0.3, optional) — coarse summary of what this merchant can do.
   * A hint for agent filtering: an agent can skip a merchant whose
   * capability set cannot serve its goal without reading every operation.
   *
   * SHOULD equal the distinct `capability` values in `operations` when both
   * are present. Where they disagree, `operations` is authoritative, since
   * it names concrete callable paths.
   */
  capabilities?: Capability[];
  /**
   * §1.2 (v0.3, optional) — the concrete operations this merchant exposes.
   *
   * `tiers` remains the pricing view and the fallback for tier-shaped
   * agents. `operations` is the capability view, and is what a merchant
   * serving many heterogeneous paths at the same tier needs in order to be
   * discoverable. Operations reference a tier for their price rather than
   * restating it.
   */
  operations?: OperationSpec[];
  /**
   * §3.4 (v0.3, optional) — the provider's default rights determination,
   * used when a citation or asset carries no `rights` of its own.
   *
   * `citation_policy` stays the human-readable summary. A multi-source
   * merchant whose policy string is `"mixed"` SHOULD emit per-citation
   * `rights` instead of relying on this default.
   */
  rights?: Rights;
}

// ---------- §1.1: Capability vocabulary (v0.3) ----------

/**
 * The capability names this spec revision defines. Deliberately generic
 * across data services: a capability describes *what an operation does*,
 * never what domain it belongs to and never which upstream backs it.
 */
export const CAPABILITIES = [
  "search",
  "fetch",
  "references",
  "cited_by",
  "authors",
  "institutions",
  "datasets",
  "software",
  "patents",
  "vocabulary",
  "full_text",
  "structured_full_text",
  "assets",
  "bulk",
  "incremental_sync",
  "semantic_search",
  "filters",
  "pagination",
] as const;

export type KnownCapability = (typeof CAPABILITIES)[number];

/**
 * A capability name. The vocabulary is an open extension point under the
 * §2.3 unknown-field rule: a merchant MAY advertise a name this revision
 * does not define, and a conformant agent MUST degrade that to "an
 * operation I do not know how to drive" rather than rejecting the manifest.
 */
export type Capability = KnownCapability | (string & {});

/** Whether `name` is in the vocabulary defined by this spec revision. */
export function isKnownCapability(name: string): name is KnownCapability {
  return (CAPABILITIES as readonly string[]).includes(name);
}

// ---------- §1.2: Operation metadata (v0.3) ----------

/**
 * How an operation pages through results. All five are already in use by
 * reference merchants: `offset` (Semantic Scholar, PubMed `retstart`),
 * `page` (OpenAlex `page`/`per_page`), `token` (ClinicalTrials.gov
 * `pageToken`), `cursor` (opaque resumable cursors), `none`.
 */
export type PaginationModel = "none" | "offset" | "page" | "cursor" | "token";

/**
 * A machine-readable schema. Either a URL that resolves to a JSON Schema
 * document, or an inline JSON Schema object. Kept deliberately loose: the
 * point is that an agent can construct a call, not that this spec pins a
 * schema dialect.
 */
export type SchemaRef = string | Record<string, unknown>;

export interface OperationSpec {
  /**
   * Stable identifier for the operation, distinct from `path`. A merchant
   * MAY re-route or version a path; `operation_id` is what an agent caches
   * and what appears in logs. MUST be unique within a manifest.
   */
  operation_id: string;
  /** Which capability this operation fulfills. */
  capability: Capability;
  /** Concrete request path, e.g. `/openalex/works/search`. */
  path: string;
  /** HTTP method. Defaults to `POST` when omitted. */
  method?: string;
  /**
   * Which entry of `tiers` prices this operation. Omitted only by a
   * merchant that does not price per tier; agents then treat the operation
   * as priced by the tier map's cheapest entry.
   */
  tier?: TierName;
  description?: string;
  /** Shape of the request body, so an agent can construct a call. */
  input_schema?: SchemaRef;
  /** Shape of `Envelope.data` for this operation. */
  output_schema?: SchemaRef;
  /** Defaults to `"none"` when omitted. */
  pagination_model?: PaginationModel;
  /**
   * Identifier namespaces this operation accepts as input, e.g.
   * `["doi", "pmid", "openalex"]`. Namespace strings are opaque to this
   * spec; agents match them against what they hold.
   */
  identifier_schemes?: string[];
  /**
   * Which member of `identifier_schemes` is canonical for results, if any.
   * Lets an agent pick a join key across merchants.
   */
  canonical_identifier?: string;
  /** Media types this operation returns, e.g. `["application/json"]`. */
  content_types?: string[];
}

// ---------- §1.3: Legacy `routes` migration (v0.3) ----------

/**
 * A route entry as emitted by the pre-0.3 reference gateway in its non-spec
 * `routes` / `tier_routes` manifest fields. Retained so those manifests stay
 * parseable through the deprecation window (SPEC §7.2).
 *
 * @deprecated since feed402/0.3 — emit `operations` instead.
 */
export interface LegacyRouteEntry {
  id: string;
  path: string;
  method?: string;
  tier?: string;
  description?: string;
  price?: { path?: string; price_usd?: number; unit?: string };
  citation?: { source_prefix?: string; provider_url?: string; license?: string };
}

/**
 * Manifest as emitted by the pre-0.3 gateway: the standard fields plus the
 * two private enumeration fields.
 *
 * @deprecated since feed402/0.3
 */
export interface LegacyRoutedManifest extends Manifest {
  /** @deprecated superseded by `operations`. */
  routes?: LegacyRouteEntry[];
  /** @deprecated derivable from `operations` by grouping on `tier`. */
  tier_routes?: Record<string, LegacyRouteEntry[]>;
}

/**
 * Best-effort capability inference for a legacy route that carries no
 * declared capability.
 *
 * This is a lossy fallback for manifests written before the vocabulary
 * existed. It distinguishes only `search` from `fetch`, because those are
 * the only two intents recoverable from a path with any confidence. A
 * merchant that wants to be discovered accurately MUST declare
 * `operations` explicitly rather than rely on this.
 */
export function inferCapabilityFromRoute(route: LegacyRouteEntry): Capability {
  const haystack = `${route.id} ${route.path}`.toLowerCase();
  return /search|query/.test(haystack) ? "search" : "fetch";
}

/**
 * Convert a legacy `routes` array into the standard operations list.
 *
 * Pure and additive: it never drops a route, and a route whose tier is not
 * a recognized tier name keeps its path and id while leaving `tier`
 * undefined, so the operation stays callable.
 */
export function operationsFromLegacyRoutes(
  routes: readonly LegacyRouteEntry[],
): OperationSpec[] {
  return routes.map((r) => {
    const op: OperationSpec = {
      operation_id: r.id,
      capability: inferCapabilityFromRoute(r),
      path: r.path,
    };
    if (r.method) op.method = r.method;
    if (r.tier === "raw" || r.tier === "query" || r.tier === "insight") {
      op.tier = r.tier;
    }
    if (r.description) op.description = r.description;
    return op;
  });
}

/**
 * Read a manifest's operations, synthesizing them from the deprecated
 * `routes` field when the merchant has not migrated yet.
 *
 * Consumers SHOULD call this instead of reading `operations` directly, so
 * that un-migrated merchants keep working for the whole deprecation window.
 * Returns an empty array for a tier-only merchant, which is a valid shape:
 * such a merchant is driven through `tiers` exactly as in 0.2.
 */
export function manifestOperations(manifest: LegacyRoutedManifest): OperationSpec[] {
  if (manifest.operations && manifest.operations.length > 0) {
    return manifest.operations;
  }
  if (manifest.routes && manifest.routes.length > 0) {
    return operationsFromLegacyRoutes(manifest.routes);
  }
  return [];
}

// ---------- §3.4: Structured rights (v0.3, optional) ----------

/**
 * A three-state answer to "may the agent do this". The third state is the
 * point of the type: a merchant that has not determined whether an action is
 * permitted says `"unknown"` rather than omitting the field and letting the
 * consumer guess.
 *
 * SPEC §3.4: a consumer MUST treat `"unknown"` and absence as not granted.
 * `permits()` below is the only correct way to read one of these.
 */
export type Permission = "allowed" | "denied" | "unknown";

/** The action facets this revision defines. Open under §2.3. */
export const RIGHTS_FACETS = [
  "redistribution",
  "tdm",
  "model_training",
  "retention",
] as const;

export type RightsFacet = (typeof RIGHTS_FACETS)[number];

/**
 * Rights over one scope of a record: the descriptive metadata, or the body.
 * A CC0 bibliographic record describing an all-rights-reserved article is the
 * routine case, and one `license` string cannot say it.
 */
export interface RightsScope {
  /** License identifier as the provider states it, e.g. `"CC-BY-4.0"`. */
  license?: string;
  /** Where that identifier is defined, when the provider gives a URL. */
  license_url?: string;
  /** Whether this scope may be used at all. Read through `permits()`. */
  status?: Permission;
  /**
   * The tiers on which the merchant may serve this scope. Absent means no
   * tier restriction. Lets a merchant say "this content is admitted only on
   * the insight tier" in the schema rather than in prose (SPEC §6.1).
   */
  tiers?: TierName[];
}

/**
 * §3.4 structured rights. Attaches to a citation (record level), to an asset
 * (§3.5), and to a manifest as the provider's default determination.
 *
 * The block records what the provider states and when that statement was
 * read. It is not a legal conclusion, and a merchant MUST NOT synthesize a
 * determination the provider did not make.
 */
export interface Rights {
  /** Rights over the bibliographic or descriptive record. */
  metadata?: RightsScope;
  /** Rights over the body, abstract, full text, or payload. */
  content?: RightsScope;
  /** May the agent republish what it received. */
  redistribution?: Permission;
  /** May the agent text- and data-mine it. */
  tdm?: Permission;
  /** May the agent train or fine-tune a model on it. */
  model_training?: Permission;
  /** May the agent retain the body after answering. */
  retention?: Permission;
  /**
   * Shorthand for the common "reference and link it, keep nothing" grant.
   * `true` means `redistribution` and `retention` are denied. A merchant MAY
   * emit both this and the explicit facets; they MUST agree.
   */
  citation_only?: boolean;
  /** The provider's terms as retrieved. */
  terms_url?: string;
  /** ISO-8601. When those terms were read. Terms change; determinations age. */
  retrieved_at?: string;
  /** Provider release or version under which the terms were read. */
  provider_release?: string;
  /** Jurisdiction this determination is scoped to, when it is scoped. */
  jurisdiction?: string;
  /** Free text for a determination the fields above cannot carry. */
  notes?: string;
}

/**
 * Resolve a facet after applying the `citation_only` shorthand.
 * Returns `"unknown"` when the merchant said nothing.
 */
export function rightsFacet(rights: Rights | undefined, facet: RightsFacet): Permission {
  if (!rights) return "unknown";
  const explicit = rights[facet];
  if (explicit === "allowed" || explicit === "denied" || explicit === "unknown") {
    return explicit;
  }
  if (rights.citation_only === true && (facet === "redistribution" || facet === "retention")) {
    return "denied";
  }
  return "unknown";
}

/**
 * The §3.4 unknown rule in code: an action is permitted only when a rights
 * block says so in as many words. Absent block, absent facet, and `"unknown"`
 * all return `false`.
 */
export function permits(rights: Rights | undefined, facet: RightsFacet): boolean {
  return rightsFacet(rights, facet) === "allowed";
}

/**
 * Rights that apply to a thing, nearest block wins whole.
 *
 * There is no field-level merge. A citation carrying `rights` replaces the
 * manifest default entirely, because a half-inherited determination is a
 * determination nobody made.
 */
export function effectiveRights(...blocks: Array<Rights | undefined>): Rights | undefined {
  for (const b of blocks) if (b) return b;
  return undefined;
}

// ---------- §3.5: Assets and representations (v0.3, optional) ----------

/**
 * The role an asset plays for its record. An open vocabulary under §2.3: a
 * merchant MAY emit a name this revision does not define, and a consumer MUST
 * degrade it to "a representation I do not know how to use" rather than
 * rejecting the envelope.
 */
export const REPRESENTATIONS = [
  "metadata",
  "abstract",
  "html",
  "jats",
  "tei",
  "tex",
  "pdf",
  "supplement",
  "dataset",
  "software",
  "image",
  "table",
] as const;

export type KnownRepresentation = (typeof REPRESENTATIONS)[number];
export type Representation = KnownRepresentation | (string & {});

/** Whether `name` is in the vocabulary defined by this spec revision. */
export function isKnownRepresentation(name: string): name is KnownRepresentation {
  return (REPRESENTATIONS as readonly string[]).includes(name);
}

/**
 * Whether an asset can be had.
 *
 * - `retrievable` — the merchant believes the asset can be fetched now.
 * - `restricted` — the asset exists and the agent may not have it. A useful
 *   and distinct answer from finding nothing.
 * - `absent` — the merchant looked and this representation does not exist.
 * - `unknown` — the merchant has not determined it. Also the reading of an
 *   omitted `availability`.
 *
 * Availability is a statement about reachability. It is never a rights grant;
 * see `Asset.rights` and SPEC §3.5.
 */
export type Availability = "retrievable" | "restricted" | "absent" | "unknown";

export const AVAILABILITIES = [
  "retrievable",
  "restricted",
  "absent",
  "unknown",
] as const;

/**
 * §3.5. One representation of a record. A work routinely has several: a
 * CC-BY abstract, an all-rights-reserved publisher PDF, a green-OA accepted
 * manuscript, a JATS full text, a supplementary dataset. `canonical_url` at
 * record level collapses all of them into one link; assets enumerate them.
 */
export interface Asset {
  /** Stable within the provider. MUST be unique within one citation. */
  asset_id: string;
  /** The role this asset plays for the record. */
  representation: Representation;
  mime_type?: string;
  /** Structural type where a MIME type is too coarse, e.g. `"jats-1.3"`. */
  content_type?: string;
  /** The stable public address of this representation. */
  canonical_url?: string;
  /** Where this provider will serve or redirect, when it differs. */
  provider_url?: string;
  /** `"<algorithm>:<hex>"`, e.g. `"sha256:c6a9...f31e"`. */
  checksum?: string;
  /** Size in bytes. */
  size?: number;
  /** Provider-assigned version of this representation. */
  version?: string;
  /**
   * §3.4 rights over this asset. Overrides the citation's block whole, with
   * no field-level merge. Absent means the citation's block applies, and the
   * §3.4 unknown rule applies unchanged in either case.
   */
  rights?: Rights;
  /** Defaults to `"unknown"` when omitted. */
  availability?: Availability;
  /** ISO-8601. When the merchant last established the facts above. */
  retrieved_at?: string;
}

/** Read an asset's availability, applying the omitted-means-unknown default. */
export function assetAvailability(asset: Asset): Availability {
  const a = asset.availability;
  return a === undefined ? "unknown" : a;
}

/**
 * Rights that govern an asset: its own block, else the citation's, else the
 * manifest's. Nearest wins whole (§3.4).
 *
 * Listing an asset is discovery, never a grant. An asset with no rights
 * anywhere in the chain grants nothing, however retrievable it is.
 */
export function assetRights(
  asset: Asset,
  citation?: { rights?: Rights },
  manifest?: { rights?: Rights },
): Rights | undefined {
  return effectiveRights(asset.rights, citation?.rights, manifest?.rights);
}

// ---------- §4: Index manifest (v0.2) ----------

/**
 * §4.1 extension point. v0.2 defines "dense" | "sparse" | "hybrid"; future
 * revisions may add more. Unknown values are treated as opaque retrieval
 * per SPEC §2.3.
 */
export type IndexType = "dense" | "sparse" | "hybrid" | string;

export type ChunkKind = "token-window" | "paragraph" | "post" | "none" | string;

export interface ChunkStrategy {
  kind: ChunkKind;
  /** Required when `kind === "token-window"`. Ignored otherwise. */
  size?: number;
  /** Required when `kind === "token-window"`. Ignored otherwise. */
  overlap?: number;
}

export interface IndexManifest {
  type: IndexType;
  /**
   * Embedding model identifier. MUST match `Citation.retrieval.model`
   * in §3.2 envelopes. Sparse-only merchants SHOULD emit `"none"`.
   */
  model: string;
  /** Embedding dimensionality. Required when type is "dense" or "hybrid". */
  dim?: number;
  /** Similarity metric. Required when type is "dense" or "hybrid". */
  distance?: "cosine" | "dot" | "l2";
  /** Total indexable units at `built_at`. */
  chunks: number;
  chunk_strategy: ChunkStrategy;
  /**
   * Hex SHA-256 fingerprint of the corpus at index time. Lets two
   * merchants prove they indexed the same corpus.
   */
  corpus_sha256: string;
  /** ISO-8601 timestamp of the build that produced this index. */
  built_at: string;
}

// ---------- §3: Response envelope ----------

export type CitationType = "source" | "vds" | string;

/**
 * §3.2 (v0.2) — optional retrieval provenance attached to source citations.
 * Emitted only when the merchant ran an index lookup to produce the result.
 */
export interface RetrievalProvenance {
  /** Same string emitted by `IndexManifest.model`. */
  model: string;
  /** Raw similarity score. Higher = more relevant. */
  score: number;
  /**
   * Zero-based position in the *retrieval* ranking that produced this
   * citation. Distinct from `result_index`, which points into the
   * envelope's result list. The two coincide when the merchant returns
   * results in retrieval order and does no deduplication.
   */
  rank: number;
}

export interface CitationSource {
  type: "source";
  source_id: string;
  provider: string;
  retrieved_at: string; // ISO-8601
  /**
   * Human-readable summary of the rights over this record. Unchanged since
   * v0.1 and still valid on its own. When `rights` (§3.4) is also present,
   * `rights` is what a consumer acts on and this stays the summary.
   */
  license?: string;
  canonical_url?: string;
  /**
   * §3.4 (v0.3, optional). Structured rights over this record. Falls back to
   * the manifest's `rights` when absent, and to nothing when that is absent
   * too, in which case every action is unknown and therefore not granted.
   */
  rights?: Rights;
  /**
   * §3.5 (v0.3, optional). The representations of this record the merchant
   * knows about. `canonical_url` keeps its meaning and no merchant is
   * required to emit assets.
   */
  assets?: Asset[];
  /**
   * §3.3 (v0.3, optional). Zero-based indices of the results in the
   * envelope's result list that this citation grounds.
   *
   * Omitted means ordinal alignment: `citation[i]` grounds result `i`.
   * A merchant that deduplicates citations, or emits fewer citations than
   * results, MUST emit `result_index` on every citation in the array.
   */
  result_index?: number[];
  /**
   * §3.2 (v0.2, optional). Stable chunk identifier in the form
   * `<source_id>#c<n>`. Must round-trip stably for the same corpus version.
   */
  chunk_id?: string;
  /**
   * §3.2 (v0.2, optional). Retrieval provenance. Providers doing retrieval
   * SHOULD emit this; pure `raw` merchants omit it.
   */
  retrieval?: RetrievalProvenance;
}

export interface CitationVDS {
  type: "vds";
  script_id: string;
  session_id: string;
  captured_by: `0x${string}`;
  captured_at: string; // ISO-8601
  verifier: string;
  verification: {
    status: "PASS" | "FAIL" | "INCONCLUSIVE";
    confidence: number;
    findings: Array<{
      kind: string;
      value: string | number;
      confidence: number;
    }>;
  };
  onchain?: string;
  signature: `0x${string}`;
  /** §3.3 (v0.3, optional). Same semantics as `CitationSource.result_index`. */
  result_index?: number[];
}

export type Citation = CitationSource | CitationVDS;

export interface Receipt {
  tier: TierName;
  price_usd: number;
  /** Transaction hash, or "stub" in demo mode. */
  tx: string;
  paid_at: string; // ISO-8601
}

export interface Envelope<D = unknown> {
  data: D;
  /**
   * Citations grounding `data`. Always an array, length >= 1 on success.
   * - Single-record endpoints return exactly one citation.
   * - Multi-record endpoints return one citation per distinct source
   *   record, deduplicated by `chunk_id ?? source_id` (SPEC §3.3).
   */
  citation: Citation[];
  /**
   * Deprecated 0.2 compatibility alias holding `citation[0]`. A 0.3
   * merchant MAY emit it during the migration window; a 0.3 consumer MUST
   * prefer `citation` and MUST NOT require this field. Sunset at
   * `DEPRECATION_SUNSET_VERSION`.
   *
   * @deprecated since feed402/0.3
   */
  citation_legacy?: Citation;
  receipt: Receipt;
}

/**
 * Envelope as emitted by v0.1 / v0.2 merchants, where `citation` was a
 * single object. Retained so historical envelopes stay parseable.
 */
export interface LegacyEnvelope<D = unknown> {
  data: D;
  citation: Citation;
  receipt: Receipt;
}

/**
 * Normalize any envelope, historical or canonical, into the 0.3 shape.
 * Never throws on a well-formed 0.1/0.2/0.3 envelope.
 */
export function toCanonicalEnvelope<D>(
  env: Envelope<D> | LegacyEnvelope<D>,
): Envelope<D> {
  const citation = Array.isArray(env.citation) ? env.citation : [env.citation];
  return { ...env, citation };
}

/**
 * Resolve which results a citation grounds. Falls back to ordinal
 * alignment (SPEC §3.3) when `result_index` is absent.
 */
export function citationResultIndices(
  citation: Citation,
  position: number,
): number[] {
  const explicit = (citation as { result_index?: number[] }).result_index;
  return explicit && explicit.length > 0 ? explicit : [position];
}

// ---------- §5: Errors ----------

export type ErrorCode =
  | "invalid_tier"
  | "invalid_input"
  | "upstream_unavailable"
  | "rate_limited"
  | "citation_unavailable";

export interface ErrorBody {
  error: { code: ErrorCode | string; message: string };
  trace_id: string;
}
