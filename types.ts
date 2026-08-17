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
  license?: string;
  canonical_url?: string;
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
