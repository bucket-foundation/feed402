/**
 * feed402 — embedder interface + built-in implementations.
 *
 * The reference server keeps retrieval pluggable via a narrow interface
 * so:
 *
 *   1. Production use: plug in `OpenAIEmbedder` (text-embedding-3-small)
 *      or any other HTTP-callable dense embedder.
 *   2. Test / offline use: plug in `MockEmbedder` (deterministic hash
 *      pseudo-embeddings, zero network, zero API key).
 *   3. Third-party merchants: implement `Embedder` against voyage,
 *      cohere, nomic, a local sentence-transformers sidecar, etc.
 *
 * The `model` string returned by `Embedder.id()` MUST match what is emitted
 * in feed402 `IndexManifest.model` and in `Citation.retrieval.model`, so
 * re-verifiers can prove two merchants used the same model. See SPEC §4.1.
 */
import { createHash } from "node:crypto";

export interface Embedder {
  /** Stable identifier emitted in manifest + citation provenance. */
  id(): string;
  /** Output dimensionality of this embedder. */
  dim(): number;
  /** Embed a batch of strings. Returns one Float32-compatible vector per input. */
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- OpenAI embedder ----------

/**
 * OpenAI text-embedding-3-* embedder. No external npm deps — uses
 * `globalThis.fetch` (Node 20+) so `node_modules` stays minimal.
 *
 * Defaults to `text-embedding-3-small` (1536 dim, cheapest tier). Callers
 * can override via the `model` constructor arg; pass `dim` to use OpenAI's
 * built-in Matryoshka dimensionality reduction (supported on the -3
 * family) for cheaper downstream storage/scoring.
 */
export class OpenAIEmbedder implements Embedder {
  private apiKey: string;
  private modelName: string;
  private dimension: number;
  private targetDim?: number;

  constructor(opts: {
    apiKey: string;
    model?: string;
    /** Optional Matryoshka dim reduction. Default: model's native dim. */
    dim?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.modelName = opts.model ?? "text-embedding-3-small";
    // Native dims as of 2025 pricing page.
    const native: Record<string, number> = {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    };
    this.dimension = opts.dim ?? native[this.modelName] ?? 1536;
    this.targetDim = opts.dim;
  }

  id(): string {
    return `openai:${this.modelName}`;
  }
  dim(): number {
    return this.dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = {
      model: this.modelName,
      input: texts,
    };
    if (this.targetDim) body.dimensions = this.targetDim;

    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenAI embeddings failed: ${res.status} ${txt.slice(0, 400)}`);
    }
    const parsed = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return parsed.data.map((d) => d.embedding);
  }
}

// ---------- Mock embedder (tests, offline demo) ----------

/**
 * Deterministic pseudo-embedder. Hashes the input into a fixed-dim unit
 * vector. Guarantees:
 *
 *   - Same input ⇒ same vector (stable across processes).
 *   - Cosine similarity between two embeddings is in (−1, 1) and broadly
 *     tracks lexical overlap (close but not identical to substring match).
 *   - Zero network, zero cost.
 *
 * This is obviously not a real semantic embedder. It exists so the demo
 * boots in CI / on a laptop without an OpenAI key, and so tests don't
 * need network access.
 */
export class MockEmbedder implements Embedder {
  private readonly dimension: number;
  constructor(dim = 128) {
    this.dimension = dim;
  }
  id(): string {
    return `mock:sha256-${this.dimension}`;
  }
  dim(): number {
    return this.dimension;
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => pseudoEmbed(t, this.dimension));
  }
}

function pseudoEmbed(text: string, dim: number): number[] {
  // Word-bag seeded PRNG: each token contributes to a small window of
  // indices. Normalized. Deterministic. Good enough for shape tests.
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest();
    for (let i = 0; i < 8; i++) {
      const idx = h.readUInt16BE(i * 2) % dim;
      const sign = h[i + 16] & 1 ? 1 : -1;
      vec[idx] += sign;
    }
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

// ---------- Helpers ----------

/** Cosine similarity for two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
