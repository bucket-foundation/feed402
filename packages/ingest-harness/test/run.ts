// Lightweight smoke tests — no test runner dep.
import { readCsv } from "../src/csv.js";
import { loadManifest } from "../src/manifest.js";
import { applyQuery, parseQuery } from "../src/query.js";
import { Bm25 } from "../src/insight.js";
import { buildServer } from "../src/server.js";

let pass = 0, fail = 0;
function t(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch(e => { fail++; console.log(`  ✗ ${name}\n    ${e?.message ?? e}`); });
}
function eq(a: any, b: any, msg = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: any, msg = "") { if (!c) throw new Error(msg || "assertion failed"); }

const dir = new URL("../examples/world-history-seed/", import.meta.url).pathname;

await (async () => {
  console.log("\nfeed402-ingest-harness smoke tests\n");

  await t("manifest loads + defaults applied", () => {
    const m = loadManifest(dir + "manifest.yaml");
    eq(m.spec, "feed402/0.2");
    eq(m.tiers.raw.price_usd, 0.010);
    eq(m.tiers.query.price_usd, 0.005);
    eq(m.tiers.insight.price_usd, 0.002);
    ok(m.citation_types.includes("source"));
  });

  const rows = await readCsv(dir + "data.csv");

  await t("csv has 12 rows + required columns", () => {
    eq(rows.length, 12);
    ok(rows.every(r => Number.isFinite(r.lat) && Number.isFinite(r.lon)));
    ok(rows.every(r => r.source_url.startsWith("https://")));
  });

  await t("bbox query: Europe-only filters out Bahamas + Florida + Japan", () => {
    const q = parseQuery(new URLSearchParams("bbox=-15,35,40,60&limit=100"));
    const res = applyQuery(rows, q);
    ok(res.every(r => r.lon >= -15 && r.lon <= 40 && r.lat >= 35 && r.lat <= 60));
    ok(!res.find(r => r.id === "columbus-landfall"), "columbus should be excluded");
    ok(!res.find(r => r.id === "meiji-restoration"), "meiji should be excluded");
  });

  await t("time range: 1500..1900 keeps westphalia + us-decl, drops fall-of-rome", () => {
    const q = parseQuery(new URLSearchParams("from=1500&to=1900&limit=100"));
    const res = applyQuery(rows, q);
    ok(res.find(r => r.id === "peace-of-westphalia"));
    ok(res.find(r => r.id === "us-declaration"));
    ok(!res.find(r => r.id === "fall-of-rome"));
  });

  await t("filter: f.kind=collapse selects 3", () => {
    const q = parseQuery(new URLSearchParams("f.kind=collapse&limit=100"));
    const res = applyQuery(rows, q);
    eq(res.length, 3);
  });

  await t("BCE timestamps: from=-500 to=500 keeps Rome (476 CE), drops 1492", () => {
    const bce: any[] = [
      { id: "alexander-conquest", lat: 33.0, lon: 44.0, timestamp: "-0331-10-01T00:00:00Z", source_url: "x", license: "x" },
      { id: "fall-of-rome", lat: 41.9, lon: 12.5, timestamp: "0476-09-04T00:00:00Z", source_url: "x", license: "x" },
      { id: "columbus", lat: 23.0, lon: -74.5, timestamp: "1492-10-12T00:00:00Z", source_url: "x", license: "x" },
    ];
    const q = parseQuery(new URLSearchParams("from=-500&to=500"));
    const res = applyQuery(bce, q);
    eq(res.length, 2);
    ok(res.find(r => r.id === "alexander-conquest"));
    ok(res.find(r => r.id === "fall-of-rome"));
    ok(!res.find(r => r.id === "columbus"));
  });

  await t("BM25 retrieval ranks plague chunk top for 'black death plague'", () => {
    const idx = Bm25.fromJsonl(dir + "chunks.jsonl");
    ok(idx.size >= 6);
    const hits = idx.search("black death plague europe", 3);
    ok(hits.length > 0);
    eq(hits[0].chunk.chunk_id, "black-death#c0");
    ok(hits[0].score > 0);
  });

  // Server smoke: payment enforced returns 402 with WWW-Authenticate
  const m = loadManifest(dir + "manifest.yaml");
  const idx = Bm25.fromJsonl(dir + "chunks.jsonl");
  const app = await buildServer({
    dataset: { provider: m.name, defaultLicense: m.citation_policy, rows, chunks: [], manifest: m },
    bm25: idx,
    payment: { enforce: true, network: m.chain, verifier: "stub" },
  });

  await t("/.well-known/feed402.json serves manifest", async () => {
    const r = await app.request("/.well-known/feed402.json");
    eq(r.status, 200);
    const j = await r.json() as any;
    eq(j.spec, "feed402/0.2");
  });

  await t("/query w/o payment returns 402 + x402 challenge", async () => {
    const r = await app.request("/query?bbox=-15,35,40,60");
    eq(r.status, 402);
    ok(r.headers.get("www-authenticate")?.startsWith("x402"));
  });

  await t("/query w/ dev payment returns enveloped data + citation + receipt", async () => {
    const tx = Buffer.from(JSON.stringify({ tx: "0xtest" })).toString("base64");
    const r = await app.request("/query?bbox=-15,35,40,60&limit=10", { headers: { "x-payment": tx } });
    eq(r.status, 200);
    const j = await r.json() as any;
    ok(Array.isArray(j.data.rows));
    eq(j.citation.type, "source");
    eq(j.receipt.tier, "query");
    eq(j.receipt.tx, "0xtest");
  });

  await t("/insight returns top-k + chunk citation w/ retrieval block", async () => {
    const tx = Buffer.from(JSON.stringify({ tx: "0xtest" })).toString("base64");
    const r = await app.request("/insight?q=plague%20black%20death&k=3", { headers: { "x-payment": tx } });
    eq(r.status, 200);
    const j = await r.json() as any;
    ok(j.data.top_k.length > 0);
    eq(j.citation.chunk_id, "black-death#c0");
    ok(j.citation.retrieval);
    eq(j.citation.retrieval.model, "bm25");
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
