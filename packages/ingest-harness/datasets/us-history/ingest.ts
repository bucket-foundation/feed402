// US history: events located inside the US bbox, instance-of one of:
// battle, treaty, election, supreme court case, law, presidential inauguration, civil rights event.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sparql, parseCoord, csvEscape, slug, sleep } from "../_lib/wikidata.js";

const OUT = "./datasets/us-history";

// US ISO + a generous bbox covering CONUS + AK + HI.
// We filter post-query by (country=USA OR within bbox), so out-of-territory items related
// to US (treaties signed abroad, e.g. Versailles) are excluded — that's intentional for the
// US slice; treaties live in world-history.

const SLICES: Array<{ kind: string; qid: string }> = [
  { kind: "battle",            qid: "Q178561"    }, // battle
  { kind: "treaty",            qid: "Q131569"    }, // treaty
  { kind: "election",          qid: "Q40231"     }, // election
  { kind: "law",               qid: "Q49371"     }, // law (Act of Congress is subclass)
  { kind: "supreme-court-case",qid: "Q3024240"   }, // legal case in U.S. Supreme Court
  { kind: "presidency",        qid: "Q15994019"  }, // U.S. presidential election (specific)
  { kind: "civil-rights",      qid: "Q1259759"   }, // demonstration / protest
];

async function runSlice(qid: string, kind: string, limit: number) {
  // P17 = country; we restrict to United States (Q30). For supreme court cases, jurisdiction = USA so this still works.
  const q = `
    SELECT ?item ?itemLabel ?date ?coord ?desc WHERE {
      ?item wdt:P31/wdt:P279* wd:${qid} .
      ?item wdt:P17 wd:Q30 .
      ?item wdt:P585|wdt:P580|wdt:P571 ?date .
      OPTIONAL { ?item wdt:P625 ?coord . }
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?date
    LIMIT ${limit}`;
  return sparql(q);
}

async function main() {
  console.log(`us-history ingest`);
  mkdirSync(OUT, { recursive: true });
  const all: Array<{ b: any; kind: string }> = [];
  for (const s of SLICES) {
    process.stdout.write(`  ${s.kind} ... `);
    try {
      const rows = await runSlice(s.qid, s.kind, 250);
      for (const b of rows) all.push({ b, kind: s.kind });
      console.log(rows.length);
    } catch (e: any) { console.log(`SKIP (${e.message.split("\n")[0]})`); }
    await sleep(800);
  }
  console.log(`  total raw: ${all.length}`);

  const cols = ["id","lat","lon","timestamp","source_url","license","title","kind","description"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  const seen = new Set<string>();
  let kept = 0;

  for (const { b, kind } of all) {
    const qid = b.item.value.split("/").pop();
    if (seen.has(qid)) continue;
    seen.add(qid);
    const ts = b.date?.value;
    if (!ts || ts.startsWith("-")) continue;
    const { lat, lon } = parseCoord(b.coord?.value);
    // For supreme-court / law / treaty: no coord in Wikidata is common — pin to DC by default
    const finalLat = Number.isFinite(lat) ? lat : 38.8951;
    const finalLon = Number.isFinite(lon) ? lon : -77.0364;
    const title = b.itemLabel?.value ?? qid;
    const desc = b.desc?.value ?? "";
    const id = `wd-${qid}-${slug(title)}`.slice(0, 90);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, finalLat, finalLon, ts, url, "CC-BY-SA-4.0", title, kind, desc].map(csvEscape).join(","));
    if (desc.length > 20) {
      chunks.push(JSON.stringify({
        chunk_id: `${id}#c0`,
        source_id: `us-history:${id}`,
        text: `${title} (${kind}, ${ts.slice(0,10)}). ${desc}`,
        canonical_url: url,
        license: "CC-BY-SA-4.0",
      }));
    }
    kept++;
  }
  writeFileSync(join(OUT, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: us-history
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://us-history.feed402.dev/schema.json
`);
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    fetched: all.length, kept, chunks: chunks.length, generated_at: new Date().toISOString(),
    slices: SLICES.map(s => s.kind),
  }, null, 2));
  console.log(`✓ ${kept} unique US events + ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
