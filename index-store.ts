/**
 * feed402 — dense vector index persistence + top-k search.
 *
 * Single-file JSON on disk. Not a production vector store — in production
 * you want pgvector, qdrant, lance, etc. The point of this file is to
 * (a) keep the reference server's dependencies to zero beyond hono and
 * (b) make the artifact the §4 `corpus_sha256` refers to a single
 * inspectable blob any auditor can diff.
 *
 * Schema (INDEX_SCHEMA_VERSION=1):
 *   {
 *     schema: 1,
 *     model: string,            // matches Embedder.id()
 *     dim: number,
 *     distance: "cosine",
 *     built_at: string,         // ISO-8601
 *     corpus_sha256: string,    // matches corpusFingerprint()
 *     chunk_strategy: ChunkStrategy,
 *     chunks: Array<{
 *       chunk_id, source_id, title, canonical_url, text, vec,
 *     }>,
 *   }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChunkStrategy } from "./types.js";
import type { CorpusChunk } from "./corpus.js";
import { cosine } from "./embedder.js";

export const INDEX_SCHEMA_VERSION = 1;

export interface PersistedIndex {
  schema: number;
  model: string;
  dim: number;
  distance: "cosine";
  built_at: string;
  corpus_sha256: string;
  chunk_strategy: ChunkStrategy;
  chunks: Array<CorpusChunk & { vec: number[] }>;
}

export interface SearchHit {
  chunk: CorpusChunk;
  score: number;
  rank: number;
}

export function saveIndex(path: string, index: PersistedIndex): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(index));
}

export function loadIndex(path: string): PersistedIndex | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedIndex;
  if (parsed.schema !== INDEX_SCHEMA_VERSION) {
    throw new Error(
      `index schema mismatch at ${path}: got ${parsed.schema}, want ${INDEX_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}

/**
 * Top-k cosine search. Linear scan — fine for corpora up to ~100k chunks
 * on a modern CPU. Swap in HNSW / an external store past that.
 */
export function topK(index: PersistedIndex, queryVec: number[], k = 5): SearchHit[] {
  const scored = index.chunks.map((c, i) => ({ i, score: cosine(queryVec, c.vec) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s, rank) => ({
    chunk: index.chunks[s.i],
    score: s.score,
    rank,
  }));
}
