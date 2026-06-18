/**
 * feed402 v0.2 — shared types
 * These mirror SPEC.md §1 (manifest), §3 (envelope), §4 (index manifest).
 * Keep this file in sync with the spec; it is intentionally small.
 *
 * v0.2 is fully backwards-compatible with v0.1: every new field is optional,
 * and v0.1 consumers must ignore unknown fields per SPEC §2.3.
 */

/** Canonical protocol version string emitted in `Manifest.spec`. */
export const SPEC_VERSION = "feed402/0.2" as const;

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
  /** Zero-based position in the result list for this request. */
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
   * Citations grounding `data`. Always an array (length 0+).
   * - Single-row endpoints (e.g. /patents/{id}) return [oneCitation].
   * - Multi-row endpoints (e.g. /patents/search) return one Citation per
   *   source row, deduplicated by canonical_url. v0.1 consumers expecting a
   *   singular `citation` MUST be updated.
   */
  citation: Citation[];
  receipt: Receipt;
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
