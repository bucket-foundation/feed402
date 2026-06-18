// Physicists by birth century — split to avoid Wikidata 504s on the unbounded query.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sparql, parseCoord, csvEscape, slug, sleep } from "../_lib/wikidata.js";

const OUT = "./datasets/physics-history";

async function century(start: number, end: number, limit = 600) {
  const q = `
    SELECT ?p ?pLabel ?birth ?coord ?desc WHERE {
      ?p wdt:P106 wd:Q169470 .
      ?p wdt:P569 ?birth .
      FILTER(?birth >= "${start}-01-01"^^xsd:dateTime && ?birth < "${end}-01-01"^^xsd:dateTime)
      ?p wdt:P19 ?bp . ?bp wdt:P625 ?coord .
      OPTIONAL { ?p schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}`;
  return sparql(q);
}

async function main() {
  console.log("physics-history ingest (century-batched)");
  mkdirSync(OUT, { recursive: true });
  const all: any[] = [];
  for (const [a, b] of [[1500,1700],[1700,1800],[1800,1850],[1850,1900],[1900,1925],[1925,1950],[1950,1975],[1975,2010]] as const) {
    process.stdout.write(`  ${a}-${b} ... `);
    try { const r = await century(a, b); for (const x of r) all.push(x); console.log(r.length); }
    catch (e: any) { console.log(`SKIP (${e.message.split("\n")[0]})`); }
    await sleep(900);
  }

  const cols = ["id","lat","lon","timestamp","source_url","license","name","kind","description"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  const seen = new Set<string>();
  let kept = 0;

  for (const b of all) {
    const qid = b.p.value.split("/").pop();
    if (seen.has(qid)) continue;
    seen.add(qid);
    const ts = b.birth?.value;
    if (!ts || ts.startsWith("-")) continue;
    const { lat, lon } = parseCoord(b.coord?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = b.pLabel?.value ?? qid;
    const desc = b.desc?.value ?? "";
    const id = `wd-${qid}-${slug(name)}`.slice(0, 90);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, lat, lon, ts, url, "CC-BY-SA-4.0", name, "physicist", desc].map(csvEscape).join(","));
    if (desc.length > 10) chunks.push(JSON.stringify({
      chunk_id: `${id}#c0`,
      source_id: `physics-history:${id}`,
      text: `${name} (physicist, b. ${ts.slice(0,10)}). ${desc}`,
      canonical_url: url, license: "CC-BY-SA-4.0",
    }));
    kept++;
  }
  writeFileSync(join(OUT, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: physics-history
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://physics-history.feed402.dev/schema.json
`);
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    kept, chunks: chunks.length, generated_at: new Date().toISOString(),
  }, null, 2));
  console.log(`✓ ${kept} physicists + ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
