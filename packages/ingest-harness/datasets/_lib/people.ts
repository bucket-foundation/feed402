// Generic Wikidata "people-of-occupation" ingest used by math-history,
// physics-history, medical-history, banking-history. One person = one row,
// geocoded to birthplace coords, timestamped at birth date.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sparql, parseCoord, csvEscape, slug } from "./wikidata.js";

export interface PeopleConfig {
  outDir: string;
  providerName: string;
  occupationQids: string[];   // P106 = occupation
  limit?: number;
  topicLabel: string;         // e.g. "mathematician"
}

export async function ingestPeople(cfg: PeopleConfig) {
  console.log(`${cfg.providerName} ingest: ${cfg.topicLabel} via Wikidata`);
  mkdirSync(cfg.outDir, { recursive: true });
  const limit = cfg.limit ?? 1500;
  const occVals = cfg.occupationQids.map(q => `wd:${q}`).join(" ");
  const q = `
    SELECT ?p ?pLabel ?birth ?birthPlaceCoord ?desc WHERE {
      VALUES ?occ { ${occVals} }
      ?p wdt:P106 ?occ .
      ?p wdt:P569 ?birth .
      ?p wdt:P19 ?birthPlace .
      ?birthPlace wdt:P625 ?birthPlaceCoord .
      OPTIONAL { ?p schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?birth
    LIMIT ${limit}`;
  const rows = await sparql(q);
  console.log(`  raw: ${rows.length}`);

  const cols = ["id","lat","lon","timestamp","source_url","license","name","kind","description"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  let kept = 0;

  for (const b of rows) {
    const ts = b.birth?.value;
    if (!ts || ts.startsWith("-")) continue; // skip BCE for v0 timestamp parser
    const { lat, lon } = parseCoord(b.birthPlaceCoord?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const qid = b.p!.value.split("/").pop()!;
    const name = b.pLabel?.value ?? qid;
    const desc = b.desc?.value ?? "";
    const id = `wd-${qid}-${slug(name)}`.slice(0, 90);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, lat, lon, ts, url, "CC-BY-SA-4.0", name, cfg.topicLabel, desc].map(csvEscape).join(","));
    if (desc.length > 15) {
      chunks.push(JSON.stringify({
        chunk_id: `${id}#c0`,
        source_id: `${cfg.providerName}:${id}`,
        text: `${name} (${cfg.topicLabel}, b. ${ts.slice(0,10)}). ${desc}`,
        canonical_url: url,
        license: "CC-BY-SA-4.0",
      }));
    }
    kept++;
  }

  writeFileSync(join(cfg.outDir, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(cfg.outDir, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(cfg.outDir, "manifest.yaml"),
`name: ${cfg.providerName}
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://${cfg.providerName}.feed402.dev/schema.json
`);
  writeFileSync(join(cfg.outDir, "ingest.stats.json"), JSON.stringify({
    fetched: rows.length, kept, chunks: chunks.length,
    occupations: cfg.occupationQids,
    generated_at: new Date().toISOString(),
  }, null, 2));
  console.log(`✓ ${kept} ${cfg.topicLabel}s + ${chunks.length} chunks`);
}
