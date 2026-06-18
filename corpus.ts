/**
 * feed402 — real Kruse corpus loader.
 *
 * The in-memory `CORPUS` in server.ts is 3 hand-written demo papers —
 * enough to exercise the envelope shape, too small to demonstrate real
 * retrieval. This module loads the 460-post Jack Kruse longevity corpus
 * (canonical source = `~/jackkruse/articles/*.md`), chunks it, and hands
 * it to the index builder.
 *
 * Provider vs. upstream: Kruse is a citation-only merchant. We emit
 * snippets + `canonical_url` only, never full-text. The full post lives
 * at jackkruse.com; we are *pointers*, not a mirror. License is
 * "citation-only" per feed402 SPEC §3.1 — downstream agents that want the
 * full text must fetch `canonical_url` themselves.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

export interface CorpusChunk {
  /** `<source_id>#c<n>`, per SPEC §3.2. */
  chunk_id: string;
  /** Stable, prefixed source identifier (e.g. `kruse:mitochondrial-dehydration`). */
  source_id: string;
  /** Human-readable post title. */
  title: string;
  /** URL of the full post on the origin site. */
  canonical_url: string;
  /** The chunked text. 300–400 words with 50-word overlap. */
  text: string;
  /** Zero-based chunk index within the post. */
  chunk_index: number;
}

const DEFAULT_KRUSE_DIR =
  process.env.KRUSE_CORPUS_DIR ?? join(homedir(), "jackkruse", "articles");
const KRUSE_SOURCE_PREFIX = "kruse";
const KRUSE_CANONICAL_BASE = "https://jackkruse.com/";

const CHUNK_WORDS = 350;
const CHUNK_OVERLAP = 50;
const MAX_POSTS_ENV = process.env.KRUSE_MAX_POSTS;

/**
 * Load + chunk the Kruse corpus. Returns `null` if the corpus directory
 * is missing (we fall back to the in-memory demo corpus in that case).
 */
export function loadKruseCorpus(dir: string = DEFAULT_KRUSE_DIR): CorpusChunk[] | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const cap = MAX_POSTS_ENV ? Number(MAX_POSTS_ENV) : files.length;
  const chunks: CorpusChunk[] = [];
  for (const file of files.slice(0, cap)) {
    const path = join(dir, file);
    const raw = readFileSync(path, "utf8");
    const slug = basename(file, ".md");
    const title = extractTitle(raw) ?? humanizeSlug(slug);
    const body = stripFrontmatter(raw);
    const postChunks = chunkText(body);
    postChunks.forEach((text, i) => {
      chunks.push({
        chunk_id: `${KRUSE_SOURCE_PREFIX}:${slug}#c${i}`,
        source_id: `${KRUSE_SOURCE_PREFIX}:${slug}`,
        title,
        canonical_url: KRUSE_CANONICAL_BASE + slug + "/",
        text,
        chunk_index: i,
      });
    });
  }
  return chunks;
}

/** Stable corpus fingerprint — emitted as §4.1 `corpus_sha256`. */
export function corpusFingerprint(chunks: CorpusChunk[]): string {
  const sorted = [...chunks].sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));
  const h = createHash("sha256");
  for (const c of sorted) {
    h.update(c.chunk_id);
    h.update("\0");
    h.update(createHash("sha256").update(c.text).digest("hex"));
    h.update("\n");
  }
  return h.digest("hex");
}

// ---------- Helpers ----------

function extractTitle(md: string): string | null {
  // Prefer front-matter `title:`, else first `# ` heading.
  const fm = md.match(/^---\s*[\s\S]*?^title:\s*(.+?)\s*$/m);
  if (fm) return fm[1].replace(/^["']|["']$/g, "").trim();
  const h1 = md.match(/^#\s+(.+?)\s*$/m);
  return h1 ? h1[1].trim() : null;
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function stripFrontmatter(md: string): string {
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end !== -1) return md.slice(end + 4).trim();
  }
  return md.trim();
}

/**
 * Word-window chunker with overlap. Operates on normalized whitespace so
 * an embedding of a chunk here matches an embedding of the same text
 * re-chunked from the canonical source (provided they agree on
 * `CHUNK_WORDS` + `CHUNK_OVERLAP` — declared in §4 `chunk_strategy`).
 */
function chunkText(body: string): string[] {
  const words = body.replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 0) return [];
  if (words.length <= CHUNK_WORDS) return [words.join(" ")];
  const out: string[] = [];
  const stride = CHUNK_WORDS - CHUNK_OVERLAP;
  for (let start = 0; start < words.length; start += stride) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    out.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
  }
  return out;
}

export const KRUSE_CHUNK_STRATEGY = {
  kind: "token-window" as const,
  size: CHUNK_WORDS,
  overlap: CHUNK_OVERLAP,
};
