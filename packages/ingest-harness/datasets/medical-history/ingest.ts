// Medical history v0.2 — epidemics + pandemics + outbreaks + famines, w/ country-centroid
// fallback when Wikidata lacks a precise coord. Plus a "diseases-first-described" slice.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sparql, parseCoord, csvEscape, slug, sleep } from "../_lib/wikidata.js";
import { fallbackCoord, qidToIso } from "../_lib/country-centroid.js";

const OUT = "./datasets/medical-history";

const EVENT_SLICES: Array<{ kind: string; qid: string }> = [
  { kind: "epidemic",      qid: "Q44512"   },
  { kind: "pandemic",      qid: "Q12184"   },
  { kind: "outbreak",      qid: "Q3241045" },
  { kind: "famine",        qid: "Q168247"  },
];

async function eventSlice(qid: string, limit: number) {
  // Get coord if available, OR country (P17) for centroid fallback.
  const q = `
    SELECT ?item ?itemLabel ?date ?coord ?country ?desc WHERE {
      ?item wdt:P31/wdt:P279* wd:${qid} .
      ?item wdt:P585|wdt:P580|wdt:P571 ?date .
      OPTIONAL { ?item wdt:P625 ?coord . }
      OPTIONAL { ?item wdt:P17 ?country . }
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?date
    LIMIT ${limit}`;
  return sparql(q);
}

// "Diseases first described" — disease items with point-in-time of discovery/description.
// Uses date of discovery (P575) or earliest description (P1191).
async function diseaseSlice(limit: number) {
  const q = `
    SELECT ?item ?itemLabel ?date ?country ?desc WHERE {
      ?item wdt:P31/wdt:P279* wd:Q12136 .   # disease
      ?item wdt:P575|wdt:P1191 ?date .
      OPTIONAL { ?item wdt:P495 ?country . } # country of origin
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?date
    LIMIT ${limit}`;
  return sparql(q);
}

async function main() {
  console.log("medical-history ingest v0.2 (with country-centroid fallback)");
  mkdirSync(OUT, { recursive: true });
  const all: Array<{ b: any; kind: string }> = [];

  for (const s of EVENT_SLICES) {
    process.stdout.write(`  ${s.kind} ... `);
    try { const r = await eventSlice(s.qid, 600); for (const b of r) all.push({ b, kind: s.kind }); console.log(r.length); }
    catch (e: any) { console.log(`SKIP (${e.message.split("\n")[0]})`); }
    await sleep(800);
  }
  process.stdout.write(`  disease ... `);
  try { const r = await diseaseSlice(800); for (const b of r) all.push({ b, kind: "disease" }); console.log(r.length); }
  catch (e: any) { console.log(`SKIP (${e.message.split("\n")[0]})`); }

  const cols = ["id","lat","lon","timestamp","source_url","license","title","kind","description","geo_resolution"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  const seen = new Set<string>();
  let kept = 0, exact = 0, fallback = 0;

  for (const { b, kind } of all) {
    const qid = b.item.value.split("/").pop();
    if (seen.has(qid)) continue;
    seen.add(qid);
    const ts = b.date?.value;
    if (!ts) continue;
    let { lat, lon } = parseCoord(b.coord?.value);
    let geoRes: "exact" | "country-centroid" = "exact";
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const iso = qidToIso(b.country?.value);
      const fb = fallbackCoord(iso ?? undefined);
      if (!fb) continue;
      [lat, lon] = fb;
      geoRes = "country-centroid";
    }
    if (geoRes === "exact") exact++; else fallback++;
    const title = b.itemLabel?.value ?? qid;
    const desc = b.desc?.value ?? "";
    const id = `wd-${qid}-${slug(title)}`.slice(0, 90);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, lat, lon, ts, url, "CC-BY-SA-4.0", title, kind, desc, geoRes].map(csvEscape).join(","));
    if (desc.length > 15) chunks.push(JSON.stringify({
      chunk_id: `${id}#c0`,
      source_id: `medical-history:${id}`,
      text: `${title} (${kind}, ${ts.slice(0,10)}). ${desc}`,
      canonical_url: url, license: "CC-BY-SA-4.0",
    }));
    kept++;
  }
  writeFileSync(join(OUT, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: medical-history
version: 0.2.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://medical-history.feed402.dev/schema.json
`);
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    kept, exact_geo: exact, country_centroid: fallback, chunks: chunks.length,
    generated_at: new Date().toISOString(),
    slices: [...EVENT_SLICES.map(s => s.kind), "disease"],
  }, null, 2));
  console.log(`✓ ${kept} medical events (${exact} exact, ${fallback} country-centroid) + ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
