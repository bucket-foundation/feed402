// World politics v0.2 — heads-of-state terms (P39 = position held) for the post-1945 era,
// PLUS treaties + summits + coups + elections with country-centroid fallback.
// License-clean: ACLED (NC) explicitly excluded. V-Dem can't be auto-pulled here (login).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sparql, parseCoord, csvEscape, slug, sleep } from "../_lib/wikidata.js";
import { fallbackCoord, qidToIso } from "../_lib/country-centroid.js";

const OUT = "./datasets/world-politics";

// EVENT-shaped (instance-of X with date + maybe coord).
const EVENT_SLICES: Array<{ kind: string; qid: string; dateProp: string }> = [
  { kind: "treaty",       qid: "Q131569",   dateProp: "P585|wdt:P580" },
  { kind: "election",     qid: "Q40231",    dateProp: "P585" },
  { kind: "summit",       qid: "Q1072326",  dateProp: "P585|wdt:P580" },
  { kind: "coup",         qid: "Q45382",    dateProp: "P585" },
  { kind: "referendum",   qid: "Q43109",    dateProp: "P585" },
];

async function eventSlice(s: typeof EVENT_SLICES[number], limit: number) {
  const q = `
    SELECT ?item ?itemLabel ?date ?coord ?country ?desc WHERE {
      ?item wdt:P31/wdt:P279* wd:${s.qid} .
      ?item wdt:${s.dateProp} ?date .
      FILTER(?date >= "1945-01-01"^^xsd:dateTime)
      OPTIONAL { ?item wdt:P625 ?coord . }
      OPTIONAL { ?item wdt:P17 ?country . }
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?date)
    LIMIT ${limit}`;
  return sparql(q);
}

// Heads-of-state: persons holding a head-of-state position, with start date and country.
// Q48352 = head of state. Country bound via the position's "applies to jurisdiction" or
// the person's "country of citizenship" P27.
async function headsOfState(yearStart: number, yearEnd: number, limit: number) {
  // Decade-bounded to avoid 504s. Position narrowed to "head of state" (Q48352) directly
  // rather than via subclass*-traversal, which is the costly bit.
  const q = `
    SELECT ?p ?pLabel ?start ?country ?desc WHERE {
      ?p p:P39 ?stmt .
      ?stmt ps:P39/wdt:P279* wd:Q48352 .
      ?stmt pq:P580 ?start .
      FILTER(?start >= "${yearStart}-01-01"^^xsd:dateTime && ?start < "${yearEnd}-01-01"^^xsd:dateTime)
      OPTIONAL { ?p wdt:P27 ?country . }
      OPTIONAL { ?p schema:description ?desc . FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}`;
  return sparql(q);
}

async function main() {
  console.log("world-politics ingest v0.2");
  mkdirSync(OUT, { recursive: true });
  const all: Array<{ b: any; kind: string }> = [];

  for (const s of EVENT_SLICES) {
    process.stdout.write(`  ${s.kind} ... `);
    try { const r = await eventSlice(s, 500); for (const b of r) all.push({ b, kind: s.kind }); console.log(r.length); }
    catch (e: any) { console.log(`SKIP (${e.message.split("\n")[0]})`); }
    await sleep(900);
  }
  for (const [a, b] of [[1945,1960],[1960,1975],[1975,1990],[1990,2005],[2005,2026]] as const) {
    process.stdout.write(`  head-of-state ${a}-${b} ... `);
    try { const r = await headsOfState(a, b, 600); for (const x of r) all.push({ b: x, kind: "head-of-state" }); console.log(r.length); }
    catch (e: any) { console.log(`SKIP (${e.message.split("\n")[0]})`); }
    await sleep(900);
  }

  const cols = ["id","lat","lon","timestamp","source_url","license","title","kind","description","geo_resolution"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  const seen = new Set<string>();
  let kept = 0, exact = 0, fallback = 0;

  for (const { b, kind } of all) {
    const qid = (b.item ?? b.p).value.split("/").pop();
    if (seen.has(qid + ":" + kind)) continue;
    seen.add(qid + ":" + kind);
    const ts = (b.date ?? b.start)?.value;
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
    const title = (b.itemLabel ?? b.pLabel)?.value ?? qid;
    const position = b.positionLabel?.value ?? "";
    const desc = b.desc?.value ?? (kind === "head-of-state" && position ? `${position}` : "");
    const id = `wd-${qid}-${slug(title)}-${ts.slice(0,4)}`.slice(0, 95);
    const url = `https://www.wikidata.org/wiki/${qid}`;
    lines.push([id, lat, lon, ts, url, "CC-BY-SA-4.0", title, kind, desc, geoRes].map(csvEscape).join(","));
    if (desc.length > 10) chunks.push(JSON.stringify({
      chunk_id: `${id}#c0`,
      source_id: `world-politics:${id}`,
      text: `${title} (${kind}${position ? ", "+position : ""}, ${ts.slice(0,10)}). ${desc}`.replace(/\s+/g," "),
      canonical_url: url, license: "CC-BY-SA-4.0",
    }));
    kept++;
  }
  writeFileSync(join(OUT, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: world-politics
version: 0.2.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://world-politics.feed402.dev/schema.json
`);
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    kept, exact_geo: exact, country_centroid: fallback, chunks: chunks.length,
    generated_at: new Date().toISOString(),
    slices: [...EVENT_SLICES.map(s => s.kind), "head-of-state"],
    excluded_due_to_license: ["ACLED (CC-BY-NC)"],
  }, null, 2));
  console.log(`✓ ${kept} events (${exact} exact, ${fallback} country-centroid) + ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
