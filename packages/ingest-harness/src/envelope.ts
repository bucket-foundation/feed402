import type { Citation, Envelope, Receipt, Row, Tier, Manifest, Chunk } from "./types.js";

export function rowCitation(r: Row, provider: string): Citation {
  return {
    type: "source",
    source_id: `${provider}:${r.id}`,
    provider,
    retrieved_at: new Date().toISOString(),
    license: r.license,
    canonical_url: r.source_url,
  };
}

export function chunkCitation(c: Chunk, provider: string, score: number, rank: number, model: string): Citation {
  return {
    type: "source",
    source_id: c.source_id,
    provider,
    retrieved_at: new Date().toISOString(),
    license: c.license ?? "unspecified",
    canonical_url: c.canonical_url ?? "",
    chunk_id: c.chunk_id,
    retrieval: { model, score, rank },
  };
}

export function batchCitation(provider: string, manifest: Manifest, count: number): Citation {
  return {
    type: "source",
    source_id: `${provider}:batch:${count}`,
    provider,
    retrieved_at: new Date().toISOString(),
    license: manifest.citation_policy,
    canonical_url: `https://${provider}/.well-known/feed402.json`,
  };
}

export function makeReceipt(tier: Tier, manifest: Manifest, tx?: string): Receipt {
  return {
    tier,
    price_usd: manifest.tiers[tier].price_usd,
    tx,
    paid_at: tx ? new Date().toISOString() : undefined,
  };
}

/**
 * Build a feed402/0.3 envelope. Accepts a single citation or an array; the
 * wire shape is always an array (SPEC §3).
 *
 * `opts.legacyAlias` additionally emits the deprecated singular
 * `citation_legacy` field for consumers still on 0.2. Off by default.
 */
export function envelope<T>(
  data: T,
  citation: Citation | Citation[],
  receipt: Receipt,
  opts?: { legacyAlias?: boolean },
): Envelope<T> {
  const citations = Array.isArray(citation) ? citation : [citation];
  const env: Envelope<T> = { data, citation: citations, receipt };
  if (opts?.legacyAlias && citations.length > 0) env.citation_legacy = citations[0];
  return env;
}
