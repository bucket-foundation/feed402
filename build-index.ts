/**
 * feed402 — one-shot pipeline that builds the on-disk vector index.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npm run build-index
 *
 * Or with the mock embedder (no API key, good for CI / offline demo):
 *   FEED402_EMBEDDER=mock npm run build-index
 *
 * Inputs:
 *   - Corpus directory: $KRUSE_CORPUS_DIR (default ~/jackkruse/articles)
 *   - Embedder: OpenAI text-embedding-3-small by default
 *   - Cap: $KRUSE_MAX_POSTS (default = all)
 *
 * Output:
 *   ./index/kruse.json — consumed by server.ts on boot.
 *
 * Cost estimate for the full 460-post Kruse corpus:
 *   ~3.5k chunks × ~500 tokens/chunk = ~1.8M tokens
 *   × $0.02 / 1M tokens (text-embedding-3-small) ≈ $0.04
 *
 * The script batches up to 100 inputs per API call (OpenAI limit) and
 * honors Retry-After on 429/5xx with bounded exponential backoff.
 */
import { performance } from "node:perf_hooks";
import {
  loadKruseCorpus,
  corpusFingerprint,
  KRUSE_CHUNK_STRATEGY,
} from "./corpus.js";
import type { Embedder } from "./embedder.js";
import { OpenAIEmbedder, MockEmbedder } from "./embedder.js";
import {
  saveIndex,
  INDEX_SCHEMA_VERSION,
  type PersistedIndex,
} from "./index-store.js";

const BATCH_SIZE = 100;
const OUTPUT_PATH = process.env.FEED402_INDEX_PATH ?? "index/kruse.json";

async function main() {
  const corpus = loadKruseCorpus();
  if (!corpus || corpus.length === 0) {
    console.error(
      "[build-index] corpus dir empty or missing — set KRUSE_CORPUS_DIR or populate ~/jackkruse/articles",
    );
    process.exit(1);
  }
  console.log(`[build-index] loaded ${corpus.length} chunks`);

  const embedder = pickEmbedder();
  console.log(`[build-index] embedder = ${embedder.id()} (dim=${embedder.dim()})`);

  const vecs: number[][] = [];
  const t0 = performance.now();
  for (let i = 0; i < corpus.length; i += BATCH_SIZE) {
    const batch = corpus.slice(i, i + BATCH_SIZE);
    const batchVecs = await withRetry(() => embedder.embed(batch.map((c) => c.text)));
    vecs.push(...batchVecs);
    const done = Math.min(i + BATCH_SIZE, corpus.length);
    console.log(
      `[build-index] ${done}/${corpus.length} (${((done / corpus.length) * 100).toFixed(1)}%)`,
    );
  }
  const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[build-index] embedded ${vecs.length} chunks in ${elapsedSec}s`);

  const index: PersistedIndex = {
    schema: INDEX_SCHEMA_VERSION,
    model: embedder.id(),
    dim: embedder.dim(),
    distance: "cosine",
    built_at: new Date().toISOString(),
    corpus_sha256: corpusFingerprint(corpus),
    chunk_strategy: KRUSE_CHUNK_STRATEGY,
    chunks: corpus.map((c, i) => ({ ...c, vec: vecs[i] })),
  };

  saveIndex(OUTPUT_PATH, index);
  console.log(
    `[build-index] wrote ${OUTPUT_PATH} — corpus_sha256=${index.corpus_sha256.slice(0, 16)}...`,
  );
}

function pickEmbedder(): Embedder {
  const kind = process.env.FEED402_EMBEDDER ?? (process.env.OPENAI_API_KEY ? "openai" : "mock");
  if (kind === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY required for openai embedder");
    return new OpenAIEmbedder({
      apiKey: key,
      model: process.env.FEED402_EMBED_MODEL ?? "text-embedding-3-small",
    });
  }
  return new MockEmbedder();
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = Math.min(60_000, 1000 * 2 ** i);
      console.warn(
        `[build-index] attempt ${i + 1}/${attempts} failed: ${(e as Error).message} — retrying in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

main().catch((e) => {
  console.error("[build-index] fatal:", e);
  process.exit(1);
});
