// Constitutions of nations + their amendments, by inception date, with the
// country's capital coordinates as the geo proxy. License: CC0 (Wikidata).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sparql, parseCoord, csvEscape, slug } from "../_lib/wikidata.js";

const OUT = "./datasets/constitutions";

// Constitutions: items that are instance of "constitution" (Q7755) or subclass*.
// Join to country via P1001 (applies to jurisdiction) → that country's P36 (capital) → P625 (coord).
// Inception via P571.
const QUERY = `
SELECT ?item ?itemLabel ?inception ?country ?countryLabel ?capitalCoord ?desc WHERE {
  ?item wdt:P31/wdt:P279* wd:Q7755 .
  ?item wdt:P571 ?inception .
  OPTIONAL {
    ?item wdt:P1001 ?country .
    ?country wdt:P36 ?capital .
    ?capital wdt:P625 ?capitalCoord .
  }
  OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?inception
LIMIT 1500`;

async function main() {
  console.log("constitutions ingest: querying Wikidata...");
  mkdirSync(OUT, { recursive: true });
  const rows = await sparql(QUERY);
  console.log(`  raw: ${rows.length}`);

  const cols = ["id","lat","lon","timestamp","source_url","license","title","country","description"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  let kept = 0;

  for (const b of rows) {
    const ts = b.inception?.value;
    if (!ts || ts.startsWith("-")) continue;
    const { lat, lon } = parseCoord(b.capitalCoord?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const qid = b.item!.value.split("/").pop()!;
    const title = b.itemLabel?.value ?? qid;
    const country = b.countryLabel?.value ?? "";
    const desc = b.desc?.value ?? "";
    const id = `wd-${qid}-${slug(title)}`.slice(0, 90);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, lat, lon, ts, url, "CC-BY-SA-4.0", title, country, desc].map(csvEscape).join(","));
    chunks.push(JSON.stringify({
      chunk_id: `${id}#c0`,
      source_id: `constitutions:${id}`,
      text: `${title} (${country || "n/a"}, adopted ${ts.slice(0,10)}). ${desc}`.trim(),
      canonical_url: url,
      license: "CC-BY-SA-4.0",
    }));
    kept++;
  }
  writeFileSync(join(OUT, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: constitutions
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://constitutions.feed402.dev/schema.json
`);
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    fetched: rows.length, kept, chunks: chunks.length, generated_at: new Date().toISOString(),
  }, null, 2));
  console.log(`✓ ${kept} constitutions with adoption-date + capital coords, ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
