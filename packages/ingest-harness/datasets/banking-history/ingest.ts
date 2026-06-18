// Banking history: banks (instance-of bank, central bank, investment bank), founding date,
// HQ coords. License: CC0/CC-BY-SA via Wikidata.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sparql, parseCoord, csvEscape, slug, sleep } from "../_lib/wikidata.js";

const OUT = "./datasets/banking-history";

const SLICES: Array<{ kind: string; qid: string }> = [
  { kind: "bank",            qid: "Q22687"    }, // bank
  { kind: "central-bank",    qid: "Q1242345"  }, // central bank
  { kind: "investment-bank", qid: "Q1058914"  }, // investment bank
  { kind: "stock-exchange",  qid: "Q11691"    }, // stock exchange
];

async function runSlice(qid: string, limit: number) {
  const q = `
    SELECT ?item ?itemLabel ?inception ?hqCoord ?hqLabel ?desc WHERE {
      ?item wdt:P31/wdt:P279* wd:${qid} .
      ?item wdt:P571 ?inception .
      OPTIONAL {
        ?item wdt:P159 ?hq .
        ?hq wdt:P625 ?hqCoord .
      }
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?inception
    LIMIT ${limit}`;
  return sparql(q);
}

async function main() {
  console.log("banking-history ingest");
  mkdirSync(OUT, { recursive: true });
  const all: any[] = [];
  for (const s of SLICES) {
    process.stdout.write(`  ${s.kind} ... `);
    try { const r = await runSlice(s.qid, 500); for (const b of r) all.push({ b, kind: s.kind }); console.log(r.length); }
    catch (e: any) { console.log(`SKIP (${e.message.split("\n")[0]})`); }
    await sleep(800);
  }

  const cols = ["id","lat","lon","timestamp","source_url","license","name","kind","description"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  const seen = new Set<string>();
  let kept = 0;

  for (const { b, kind } of all) {
    const qid = b.item.value.split("/").pop();
    if (seen.has(qid)) continue;
    seen.add(qid);
    const ts = b.inception?.value;
    if (!ts || ts.startsWith("-")) continue;
    const { lat, lon } = parseCoord(b.hqCoord?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = b.itemLabel?.value ?? qid;
    const desc = b.desc?.value ?? "";
    const id = `wd-${qid}-${slug(name)}`.slice(0, 90);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, lat, lon, ts, url, "CC-BY-SA-4.0", name, kind, desc].map(csvEscape).join(","));
    if (desc.length > 10) chunks.push(JSON.stringify({
      chunk_id: `${id}#c0`,
      source_id: `banking-history:${id}`,
      text: `${name} (${kind}, founded ${ts.slice(0,10)}). ${desc}`,
      canonical_url: url, license: "CC-BY-SA-4.0",
    }));
    kept++;
  }
  writeFileSync(join(OUT, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: banking-history
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://banking-history.feed402.dev/schema.json
`);
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    kept, chunks: chunks.length, generated_at: new Date().toISOString(),
    slices: SLICES.map(s => s.kind),
  }, null, 2));
  console.log(`✓ ${kept} banks + ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
