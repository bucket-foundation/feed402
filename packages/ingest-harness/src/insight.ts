// BM25 retrieval over chunks.jsonl (sparse default for v0).
// For dense indexes the per-dataset bead pre-computes embeddings + a faiss-ish
// flat index; this harness only ships sparse to keep zero-deps.
import { readFileSync, existsSync } from "node:fs";
import type { Chunk } from "./types.js";

export interface InsightHit {
  chunk: Chunk;
  score: number;
  rank: number;
}

const STOP = new Set(["the","a","an","and","or","of","in","to","is","for","on","with","by","at","as","that","this","be","are","was","were"]);

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t && !STOP.has(t));
}

export class Bm25 {
  private docs: { id: string; tokens: string[]; len: number }[] = [];
  private df = new Map<string, number>();
  private avgdl = 0;
  private k1 = 1.5;
  private b = 0.75;
  private chunks: Chunk[] = [];

  static fromJsonl(path: string): Bm25 {
    const idx = new Bm25();
    if (!existsSync(path)) return idx;
    const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const c = JSON.parse(line) as Chunk;
      idx.add(c);
    }
    idx.finalize();
    return idx;
  }

  add(c: Chunk) {
    const tokens = tokenize(c.text);
    const seen = new Set<string>();
    for (const t of tokens) if (!seen.has(t)) { seen.add(t); this.df.set(t, (this.df.get(t) ?? 0) + 1); }
    this.docs.push({ id: c.chunk_id, tokens, len: tokens.length });
    this.chunks.push(c);
  }

  finalize() {
    const tot = this.docs.reduce((s, d) => s + d.len, 0);
    this.avgdl = this.docs.length ? tot / this.docs.length : 0;
  }

  search(query: string, k = 5): InsightHit[] {
    const q = tokenize(query);
    if (!this.docs.length || !q.length) return [];
    const N = this.docs.length;
    const scores = new Float64Array(N);
    for (const term of q) {
      const df = this.df.get(term) ?? 0;
      if (!df) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let i = 0; i < N; i++) {
        const d = this.docs[i];
        const tf = d.tokens.reduce((c, t) => c + (t === term ? 1 : 0), 0);
        if (!tf) continue;
        const denom = tf + this.k1 * (1 - this.b + this.b * (d.len / (this.avgdl || 1)));
        scores[i] += idf * (tf * (this.k1 + 1)) / denom;
      }
    }
    const ranked = Array.from(scores)
      .map((s, i) => ({ i, s }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k);
    return ranked.map((x, rank) => ({ chunk: this.chunks[x.i], score: x.s, rank }));
  }

  get size() { return this.docs.length; }
}
