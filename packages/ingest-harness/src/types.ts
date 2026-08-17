// feed402/0.3 wire types — see /home/gian/agfarms/feed402/SPEC.md
export type Tier = "raw" | "query" | "insight";

export interface Manifest {
  name: string;
  version: string;
  spec: string;          // e.g. "feed402/0.3"
  chain: string;          // "base" | "base-sepolia"
  wallet: string;         // 0x...
  tiers: Record<Tier, { path: string; price_usd: number; unit: string }>;
  schema_url?: string;
  citation_policy: string; // license string
  citation_types: string[];
  contact: string;
  index?: IndexBlock;
}

export interface IndexBlock {
  type: "dense" | "sparse" | "hybrid";
  model: string;
  dim?: number;
  distance?: "cosine" | "dot" | "l2";
  chunks: number;
  chunk_strategy: { kind: string; size?: number; overlap?: number };
  corpus_sha256: string;
  built_at: string;
}

export interface Citation {
  type: "source" | "vds" | string;
  source_id: string;
  provider: string;
  retrieved_at: string;
  license: string;
  canonical_url: string;
  chunk_id?: string;
  retrieval?: { model: string; score: number; rank: number };
  /** §3.3 — zero-based indices of results this citation grounds. */
  result_index?: number[];
  // VDS / future types: arbitrary additional fields allowed (spec §2.3)
  [k: string]: unknown;
}

export interface Receipt {
  tier: Tier;
  price_usd: number;
  tx?: string;
  paid_at?: string;
}

export interface Envelope<T = unknown> {
  data: T;
  /** §3 — always an array in feed402/0.3. */
  citation: Citation[];
  /** @deprecated 0.2 alias holding `citation[0]`. Sunset at feed402/0.5. */
  citation_legacy?: Citation;
  receipt: Receipt;
}

/** Envelope shape emitted by v0.1 / v0.2 merchants. */
export interface LegacyEnvelope<T = unknown> {
  data: T;
  citation: Citation;
  receipt: Receipt;
}

// Per-row schema produced by the harness from any CSV
export interface Row {
  id: string;
  lat: number;
  lon: number;
  timestamp: string;       // ISO-8601
  source_url: string;
  license: string;
  [k: string]: unknown;    // extra columns
}

export interface Chunk {
  chunk_id: string;
  source_id: string;
  text: string;
  canonical_url?: string;
  license?: string;
}

export interface DatasetConfig {
  provider: string;        // manifest.name
  defaultLicense: string;
  defaultCanonicalUrlPrefix?: string;
  rows: Row[];
  chunks: Chunk[];
  manifest: Manifest;
}
