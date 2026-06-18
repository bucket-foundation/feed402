// Ingest historical events with point-in-time + coordinates from Wikidata SPARQL.
// License: Wikidata = CC0 (data); descriptions = CC-BY-SA-4.0 from linked Wikipedia.
// Endpoint: https://query.wikidata.org/sparql
//
// Strategy: pull a few orthogonal slices and union them, since one mega-query gets
// throttled. Each slice has clear license + clear time/space dimensions.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SPARQL = "https://query.wikidata.org/sparql";
const UA = "feed402-ingest/0.1 (https://bucket.foundation; ops@bucket.foundation)";

interface Args { out: string; perSlice: number; }
function parseArgs(): Args {
  const a: Args = { out: "./datasets/world-history", perSlice: 200 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--per-slice") a.perSlice = +argv[++i];
  }
  return a;
}

// Each slice = (kind, Wikidata QID for instanceOf or subclass*).
// We cap each at perSlice so the union is balanced.
const SLICES: Array<{ kind: string; qid: string; verb: string }> = [
  { kind: "battle",      qid: "Q178561",  verb: "wdt:P31/wdt:P279*" }, // battle
  { kind: "war",         qid: "Q198",     verb: "wdt:P31/wdt:P279*" }, // war
  { kind: "treaty",      qid: "Q131569",  verb: "wdt:P31/wdt:P279*" }, // treaty
  { kind: "revolution",  qid: "Q10931",   verb: "wdt:P31/wdt:P279*" }, // revolution
  { kind: "earthquake",  qid: "Q7944",    verb: "wdt:P31/wdt:P279*" }, // earthquake
  { kind: "epidemic",    qid: "Q44512",   verb: "wdt:P31/wdt:P279*" }, // epidemic
  { kind: "election",    qid: "Q40231",   verb: "wdt:P31/wdt:P279*" }, // election
  { kind: "coup",        qid: "Q45382",   verb: "wdt:P31/wdt:P279*" }, // coup d'état
  { kind: "expedition",  qid: "Q2401485", verb: "wdt:P31/wdt:P279*" }, // expedition
  { kind: "founding",    qid: "Q24039104",verb: "wdt:P31/wdt:P279*" }, // founding
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

interface SparqlBinding {
  item:        { value: string };
  itemLabel?:  { value: string };
  date:        { value: string };
  coord:       { value: string };
  desc?:       { value: string };
}

async function runSlice(slice: typeof SLICES[number], limit: number): Promise<SparqlBinding[]> {
  const q = `
    SELECT ?item ?itemLabel ?date ?coord ?desc WHERE {
      ?item ${slice.verb} wd:${slice.qid} .
      ?item wdt:P585|wdt:P580 ?date .
      ?item wdt:P625 ?coord .
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?date
    LIMIT ${limit}`;
  const url = `${SPARQL}?query=${encodeURIComponent(q)}&format=json`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`SPARQL ${r.status} for ${slice.kind}: ${body.slice(0, 200)}`);
  }
  const j = await r.json() as { results: { bindings: SparqlBinding[] } };
  return j.results.bindings;
}

function parseCoord(wkt: string): { lat: number; lon: number } {
  // Point(lon lat)
  const m = wkt.match(/^Point\(([-\d.]+)\s+([-\d.]+)\)$/);
  if (!m) return { lat: NaN, lon: NaN };
  return { lon: +m[1], lat: +m[2] };
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function main() {
  const args = parseArgs();
  console.log(`world-history ingest: per-slice=${args.perSlice} out=${args.out}`);
  mkdirSync(args.out, { recursive: true });

  const all: Array<{ binding: SparqlBinding; kind: string }> = [];
  for (const s of SLICES) {
    process.stdout.write(`  ${s.kind} ... `);
    try {
      const rows = await runSlice(s, args.perSlice);
      for (const b of rows) all.push({ binding: b, kind: s.kind });
      console.log(`${rows.length}`);
    } catch (e: any) {
      console.log(`SKIP (${e.message.split("\n")[0]})`);
    }
    // gentle pace for Wikidata
    await new Promise(r => setTimeout(r, 800));
  }
  console.log(`  total raw: ${all.length}`);

  const cols = ["id","lat","lon","timestamp","source_url","license","title","kind","description"];
  const lines: string[] = [cols.join(",")];
  const chunks: string[] = [];
  const seen = new Set<string>();
  let kept = 0;

  for (const { binding, kind } of all) {
    const qid = binding.item.value.split("/").pop()!;
    if (seen.has(qid)) continue;
    seen.add(qid);
    const { lat, lon } = parseCoord(binding.coord.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ts = binding.date.value;
    if (!ts || ts.startsWith("-")) continue; // skip BCE in v0 (parser limitation)
    const title = binding.itemLabel?.value ?? qid;
    const desc = binding.desc?.value ?? "";
    const id = `wd-${qid}-${slug(title)}`.slice(0, 90);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, lat, lon, ts, url, "CC-BY-SA-4.0", title, kind, desc].map(csvEscape).join(","));
    if (desc.length > 30) {
      chunks.push(JSON.stringify({
        chunk_id: `${id}#c0`,
        source_id: `world-history:${id}`,
        text: `${title} (${kind}, ${ts.slice(0,10)}). ${desc}`,
        canonical_url: url,
        license: "CC-BY-SA-4.0",
      }));
    }
    kept++;
  }

  writeFileSync(join(args.out, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(args.out, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(args.out, "manifest.yaml"),
`name: world-history
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://world-history.feed402.dev/schema.json
`);
  writeFileSync(join(args.out, "ingest.stats.json"), JSON.stringify({
    fetched: all.length, kept, chunks: chunks.length, generated_at: new Date().toISOString(),
    slices: SLICES.map(s => s.kind),
  }, null, 2));

  console.log(`✓ wrote ${kept} unique events with coords + ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
