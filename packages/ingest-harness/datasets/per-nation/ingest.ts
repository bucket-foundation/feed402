// Per-nation feed: union of all existing geo+time-coded datasets, then partition by which
// country bbox each row falls in. Output is one merged data.csv with a `country_iso2` column,
// plus a per-country index.json that the server can use to short-circuit /query?country=US.
//
// This is the simplest expression of bkt-pwv: rather than 195 separate endpoints, one feed
// with country sharding. A future v0.3 can add /country/:iso2 sub-endpoints.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { COUNTRY_CENTROID } from "../_lib/country-centroid.js";
import { pointToCountry } from "../_lib/topojson.js";

const OUT = "./datasets/per-nation";
const SRC_ROOT = "./datasets";
const SRC_DATASETS = [
  "world-history", "constitutions", "us-history", "math-history", "physics-history",
  "medical-history", "banking-history", "world-politics", "banking", "pharma-fda",
];

// Country assignment strategy:
//  1. Polygon test (Natural Earth 1:110m) — exact answer if point is on land.
//  2. Centroid fallback — for ocean / disputed / micro-territory points.
const CENTROIDS = Object.entries(COUNTRY_CENTROID) as Array<[string, [number, number]]>;
function haversine(a: [number, number], b: [number, number]): number {
  const toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]), lat2 = toRad(b[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return Math.asin(Math.sqrt(h));
}
function nearestCentroid(lat: number, lon: number): string {
  let best = "??", bestD = Infinity;
  for (const [iso, c] of CENTROIDS) {
    const d = haversine([lat, lon], c);
    if (d < bestD) { bestD = d; best = iso; }
  }
  return best;
}
function assignCountry(lat: number, lon: number): { iso: string; method: "polygon" | "centroid" } {
  const poly = pointToCountry(lat, lon);
  if (poly) return { iso: poly, method: "polygon" };
  return { iso: nearestCentroid(lat, lon), method: "centroid" };
}

interface Row {
  id: string; lat: number; lon: number; timestamp: string;
  source_url: string; license: string; provider: string;
  country_iso2: string; geo_method: "polygon" | "centroid";
  kind?: string; title?: string;
  [k: string]: unknown;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function main() {
  console.log("per-nation ingest: merging + sharding by country");
  mkdirSync(OUT, { recursive: true });
  const allRows: Row[] = [];

  for (const ds of SRC_DATASETS) {
    const csvPath = join(SRC_ROOT, ds, "data.csv");
    if (!existsSync(csvPath)) { console.log(`  ${ds}: skip (missing)`); continue; }
    const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
    const header = parseCsvLine(lines[0]);
    const idx = (k: string) => header.indexOf(k);
    let added = 0;
    for (const ln of lines.slice(1)) {
      const cells = parseCsvLine(ln);
      const lat = +cells[idx("lat")];
      const lon = +cells[idx("lon")];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const { iso, method } = assignCountry(lat, lon);
      const obj: Row = {
        id: `${ds}:${cells[idx("id")]}`,
        lat, lon,
        timestamp: cells[idx("timestamp")],
        source_url: cells[idx("source_url")],
        license: cells[idx("license")],
        provider: ds,
        country_iso2: iso,
        geo_method: method,
        kind: idx("kind") >= 0 ? cells[idx("kind")] : undefined,
        title: idx("title") >= 0 ? cells[idx("title")] : (idx("name") >= 0 ? cells[idx("name")] : undefined),
      };
      allRows.push(obj);
      added++;
    }
    console.log(`  ${ds}: ${added}`);
  }

  // Sharding stats
  const shard: Record<string, number> = {};
  let polyCount = 0, centroidCount = 0;
  for (const r of allRows) {
    shard[r.country_iso2] = (shard[r.country_iso2] ?? 0) + 1;
    if (r.geo_method === "polygon") polyCount++; else centroidCount++;
  }

  // Emit merged CSV
  const cols = ["id","lat","lon","timestamp","source_url","license","provider","country_iso2","geo_method","kind","title"];
  const out = [cols.join(",")];
  for (const r of allRows) {
    const cells = cols.map(k => {
      const v = (r as any)[k];
      if (v === undefined || v === null) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    });
    out.push(cells.join(","));
  }
  writeFileSync(join(OUT, "data.csv"), out.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: per-nation
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-SA-4.0
contact: ops@bucket.foundation
schema_url: https://per-nation.feed402.dev/schema.json
`);
  // No chunks here — agents should hit per-domain insight tier; this feed is structure-only.
  writeFileSync(join(OUT, "chunks.jsonl"), "");
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    total_rows: allRows.length,
    countries: Object.keys(shard).length,
    geo_polygon: polyCount,
    geo_centroid_fallback: centroidCount,
    polygon_rate: allRows.length ? +(polyCount / allRows.length).toFixed(3) : 0,
    rows_per_country: Object.fromEntries(
      Object.entries(shard).sort((a, b) => b[1] - a[1])
    ),
    generated_at: new Date().toISOString(),
  }, null, 2));
  console.log(`✓ ${allRows.length} rows across ${Object.keys(shard).length} countries`);
  console.log(`  polygon=${polyCount} centroid=${centroidCount} (${(polyCount*100/allRows.length).toFixed(1)}% exact)`);
}
main();
