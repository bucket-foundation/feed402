import { Hono } from "hono";
import type { DatasetConfig } from "./types.js";
import { parseQuery, applyQuery } from "./query.js";
import { Bm25 } from "./insight.js";
import { rowCitation, chunkCitation, batchCitation, makeReceipt, envelope } from "./envelope.js";
import { challenge, checkPayment, paymentModeFromEnv, buildV2Middleware, type PaymentMode } from "./x402.js";
export { paymentModeFromEnv };

export interface ServerOpts {
  dataset: DatasetConfig;
  bm25: Bm25;
  payment: PaymentMode;
}

export async function buildServer({ dataset, bm25, payment }: ServerOpts) {
  const app = new Hono();
  const m = dataset.manifest;
  const provider = m.name;

  // Permissive CORS — feed402 endpoints are public-by-design, paywalled at the row.
  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "x-payment, content-type");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Expose-Headers", "www-authenticate, x-payment-response, payment-required");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  // Real x402/v2 middleware (active only when FEED402_X402_MODE=v2 + FEED402_PAY_TO set).
  // Mount BEFORE the /raw /query /insight handlers so it can challenge / settle.
  // The paths it sees are post-rewrite (/raw, /query, /insight without prefix).
  const v2 = await buildV2Middleware(m, payment);
  if (v2) {
    app.use("/raw", v2);
    app.use("/query", v2);
    app.use("/insight", v2);
  }

  // Discovery
  app.get("/.well-known/feed402.json", (c) => c.json(m));
  app.get("/schema.json", (c) => c.json({
    type: "object",
    required: ["id", "lat", "lon", "timestamp", "source_url", "license"],
    properties: {
      id: { type: "string" },
      lat: { type: "number" },
      lon: { type: "number" },
      timestamp: { type: "string", format: "date-time" },
      source_url: { type: "string", format: "uri" },
      license: { type: "string" }
    },
    additionalProperties: true
  }));

  app.get("/health", (c) => c.json({
    ok: true, provider, rows: dataset.rows.length, chunks: bm25.size,
    spec: m.spec, payment_enforced: payment.enforce
  }));

  // RAW — bulk passthrough; pay per row signaled but billed per call in dev
  app.all("/raw", async (c) => {
    const pay = await checkPayment(c, payment);
    if (!pay.paid) return challenge(c, m, "raw");
    const qs = new URL(c.req.url).searchParams;
    const limit = Math.min(1000, +(qs.get("limit") ?? "100"));
    const offset = Math.max(0, +(qs.get("offset") ?? "0"));
    const ids = qs.get("ids")?.split(",").filter(Boolean);
    let rows = dataset.rows;
    if (ids?.length) rows = rows.filter(r => ids.includes(r.id));
    const slice = rows.slice(offset, offset + limit);
    // §3.3: one citation per returned row, ordinally aligned with `rows`.
    // An empty slice still needs a citation, so fall back to the batch citation.
    const rawCitations = slice.length
      ? slice.map(r => rowCitation(r, provider))
      : [batchCitation(provider, m, 0)];
    return c.json(envelope(
      { rows: slice, total: rows.length, offset, limit },
      rawCitations,
      makeReceipt("raw", m, pay.tx),
    ));
  });

  // QUERY — bbox + time + filters
  app.all("/query", async (c) => {
    const pay = await checkPayment(c, payment);
    if (!pay.paid) return challenge(c, m, "query");
    const qs = new URL(c.req.url).searchParams;
    const q = parseQuery(qs);
    const matched = applyQuery(dataset.rows, q);
    const rowCitations = matched.map(r => rowCitation(r, provider));
    return c.json(envelope(
      {
        rows: matched,
        count: matched.length,
        query: q,
        // Deprecated since feed402/0.3: the same citations now ride in the
        // envelope `citation` array, ordinally aligned with `rows`. Kept so
        // existing globe-viz consumers keep working. Sunset at feed402/0.5.
        citations: rowCitations,
      },
      rowCitations.length ? rowCitations : [batchCitation(provider, m, 0)],
      makeReceipt("query", m, pay.tx),
    ));
  });

  // INSIGHT — top-K BM25 over chunks + summary
  app.all("/insight", async (c) => {
    const pay = await checkPayment(c, payment);
    if (!pay.paid) return challenge(c, m, "insight");
    const qs = new URL(c.req.url).searchParams;
    const query = qs.get("q") ?? "";
    const k = Math.min(20, +(qs.get("k") ?? "5"));
    if (!query) return c.json({ error: "missing_q" }, 400);
    const hits = bm25.search(query, k);
    const model = m.index?.model ?? "bm25";
    const data = {
      query,
      top_k: hits.map(h => ({
        chunk_id: h.chunk.chunk_id,
        source_id: h.chunk.source_id,
        score: h.score,
        rank: h.rank,
        text: h.chunk.text.slice(0, 600),
        canonical_url: h.chunk.canonical_url,
      })),
    };
    // §3.3: one citation per hit, ordinally aligned with `data.top_k`.
    const citation = hits.length
      ? hits.map((h, i) => chunkCitation(h.chunk, provider, h.score, i, model))
      : [batchCitation(provider, m, 0)];
    return c.json(envelope(data, citation, makeReceipt("insight", m, pay.tx)));
  });

  return app;
}
