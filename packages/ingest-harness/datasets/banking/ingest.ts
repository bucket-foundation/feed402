// Live banking + financial-system metrics from the World Bank Open Data API.
// License: CC-BY-4.0. Endpoint is unauthenticated, public.
//
// Indicators chosen for relevance to systemic banking health + comparability across nations:
//   FB.AST.NPER.ZS  Bank non-performing loans / total gross loans (%)
//   FB.BNK.CAPA.ZS  Bank capital to assets ratio (%)
//   GFDD.SI.05      Bank Z-score (proximity to insolvency, higher=safer)
//   FS.AST.PRVT.GD.ZS  Domestic credit to private sector (% GDP)
//   FB.CBK.DPTR.P3  Depositors with commercial banks per 1000 adults
//
// Each (country, indicator, year) becomes a row. Geo = country centroid.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { csvEscape, sleep } from "../_lib/wikidata.js";

const OUT = "./datasets/banking";

const INDICATORS = [
  { id: "FB.AST.NPER.ZS",      label: "Bank non-performing loans (%)" },
  { id: "FB.BNK.CAPA.ZS",      label: "Bank capital to assets (%)" },
  { id: "GFDD.SI.05",          label: "Bank Z-score" },
  { id: "FS.AST.PRVT.GD.ZS",   label: "Domestic credit to private sector (%GDP)" },
  { id: "FB.CBK.DPTR.P3",      label: "Depositors per 1000 adults" },
];

// Hardcoded ISO3→(lat,lon) centroid table for the 195 nations. Source: world.geojson centroids,
// approximated. CC0. We only emit rows for countries we can geocode; aggregates ("Africa Eastern
// and Southern", "World", etc.) are intentionally dropped.
const CENTROID: Record<string, [number, number]> = {
  USA: [39.8, -98.6], CAN: [56.1, -106.3], MEX: [23.6, -102.6], BRA: [-14.2, -51.9], ARG: [-38.4, -63.6],
  CHL: [-35.7, -71.5], COL: [4.6, -74.3], PER: [-9.2, -75.0], VEN: [6.4, -66.6], BOL: [-16.3, -63.6],
  ECU: [-1.8, -78.2], URY: [-32.5, -55.8], PRY: [-23.4, -58.4], GUY: [4.9, -58.9], SUR: [3.9, -56.0],
  GBR: [55.4, -3.4], IRL: [53.4, -8.2], FRA: [46.2, 2.2], DEU: [51.2, 10.4], ITA: [41.9, 12.6],
  ESP: [40.5, -3.7], PRT: [39.4, -8.2], NLD: [52.1, 5.3], BEL: [50.5, 4.5], LUX: [49.8, 6.1],
  CHE: [46.8, 8.2], AUT: [47.5, 14.6], DNK: [56.3, 9.5], SWE: [60.1, 18.6], NOR: [60.5, 8.5],
  FIN: [61.9, 25.7], ISL: [64.9, -19.0], POL: [51.9, 19.1], CZE: [49.8, 15.5], SVK: [48.7, 19.7],
  HUN: [47.2, 19.5], ROU: [45.9, 24.9], BGR: [42.7, 25.5], GRC: [39.1, 21.8], TUR: [38.9, 35.2],
  RUS: [61.5, 105.3], UKR: [48.4, 31.2], BLR: [53.7, 27.9], MDA: [47.4, 28.4], LTU: [55.2, 23.9],
  LVA: [56.9, 24.6], EST: [58.6, 25.0], HRV: [45.1, 15.2], SRB: [44.0, 21.0], BIH: [43.9, 17.7],
  MKD: [41.6, 21.7], MNE: [42.7, 19.4], ALB: [41.2, 20.2], SVN: [46.2, 14.9], CYP: [35.1, 33.4],
  MLT: [35.9, 14.4], ISR: [31.0, 34.9], JOR: [30.6, 36.2], LBN: [33.9, 35.9], SYR: [34.8, 38.0],
  IRQ: [33.2, 43.7], IRN: [32.4, 53.7], SAU: [23.9, 45.1], YEM: [15.6, 48.5], OMN: [21.5, 55.9],
  ARE: [23.4, 53.8], QAT: [25.4, 51.2], BHR: [25.9, 50.6], KWT: [29.3, 47.5],
  EGY: [26.8, 30.8], LBY: [26.3, 17.2], TUN: [33.9, 9.5], DZA: [28.0, 1.7], MAR: [31.8, -7.1],
  ESH: [24.2, -12.9], MRT: [21.0, -10.9], SEN: [14.5, -14.4], GMB: [13.4, -15.5], GIN: [9.9, -9.7],
  SLE: [8.5, -11.8], LBR: [6.4, -9.4], CIV: [7.5, -5.5], GHA: [7.9, -1.0], TGO: [8.6, 0.8],
  BEN: [9.3, 2.3], NGA: [9.1, 8.7], NER: [17.6, 8.1], MLI: [17.6, -4.0], BFA: [12.2, -1.6],
  TCD: [15.5, 18.7], CMR: [7.4, 12.4], CAF: [6.6, 20.9], COD: [-4.0, 21.8], COG: [-0.8, 15.8],
  GAB: [-0.8, 11.6], GNQ: [1.7, 10.3], STP: [0.2, 6.6], AGO: [-11.2, 17.9], NAM: [-22.9, 18.5],
  BWA: [-22.3, 24.7], ZAF: [-30.6, 22.9], LSO: [-29.6, 28.2], SWZ: [-26.5, 31.5], ZWE: [-19.0, 29.2],
  MOZ: [-18.7, 35.5], MWI: [-13.3, 34.3], ZMB: [-13.1, 27.8], TZA: [-6.4, 34.9], KEN: [-0.0, 37.9],
  UGA: [1.4, 32.3], RWA: [-1.9, 29.9], BDI: [-3.4, 29.9], ETH: [9.2, 40.5], ERI: [15.2, 39.8],
  DJI: [11.8, 42.6], SOM: [5.2, 46.2], SDN: [12.9, 30.2], SSD: [6.9, 31.3], MDG: [-18.8, 47.0],
  MUS: [-20.3, 57.6], COM: [-11.9, 43.9], SYC: [-4.7, 55.5],
  IND: [20.6, 78.6], PAK: [30.4, 69.3], BGD: [23.7, 90.4], LKA: [7.9, 80.8], NPL: [28.4, 84.1],
  BTN: [27.5, 90.4], MDV: [3.2, 73.2], AFG: [33.9, 67.7], CHN: [35.9, 104.2], MNG: [46.9, 103.8],
  JPN: [36.2, 138.3], KOR: [35.9, 127.8], PRK: [40.3, 127.5], TWN: [23.7, 120.9],
  VNM: [14.1, 108.3], LAO: [19.9, 102.5], KHM: [12.6, 104.9], THA: [15.9, 100.9], MMR: [21.9, 95.9],
  MYS: [4.2, 101.9], SGP: [1.4, 103.8], IDN: [-0.8, 113.9], PHL: [12.9, 121.8], BRN: [4.5, 114.7],
  TLS: [-8.9, 125.7], PNG: [-6.3, 143.9], FJI: [-17.7, 178.0], SLB: [-9.6, 160.2], VUT: [-15.4, 166.9],
  NCL: [-20.9, 165.6], NZL: [-40.9, 174.9], AUS: [-25.3, 133.8],
  KAZ: [48.0, 66.9], UZB: [41.4, 64.6], TKM: [38.97, 59.6], TJK: [38.9, 71.3], KGZ: [41.2, 74.8],
  GEO: [42.3, 43.4], ARM: [40.1, 45.0], AZE: [40.1, 47.6],
};

interface Obs {
  indicator: { id: string };
  countryiso3code: string;
  country: { value: string };
  date: string;
  value: number | null;
}

async function fetchIndicator(id: string): Promise<Obs[]> {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&per_page=20000&date=2000:2024`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`worldbank ${r.status} for ${id}`);
  const j = await r.json() as [unknown, Obs[]];
  return j[1] ?? [];
}

async function main() {
  console.log("banking ingest: World Bank WDI");
  mkdirSync(OUT, { recursive: true });
  const cols = ["id","lat","lon","timestamp","source_url","license","country_iso3","country_name","indicator","indicator_label","value","year"];
  const lines = [cols.join(",")];
  const chunks: string[] = [];
  let kept = 0, skipped = 0;

  for (const ind of INDICATORS) {
    process.stdout.write(`  ${ind.id} ... `);
    try {
      const obs = await fetchIndicator(ind.id);
      let added = 0;
      for (const o of obs) {
        if (o.value === null || o.value === undefined) { skipped++; continue; }
        const c = CENTROID[o.countryiso3code];
        if (!c) { skipped++; continue; }
        const ts = `${o.date}-01-01T00:00:00Z`;
        const id = `wb-${ind.id}-${o.countryiso3code}-${o.date}`;
        const url = `https://data.worldbank.org/indicator/${ind.id}?locations=${o.countryiso3code}`;
        lines.push([id, c[0], c[1], ts, url, "CC-BY-4.0",
                    o.countryiso3code, o.country.value, ind.id, ind.label, o.value, o.date].map(csvEscape).join(","));
        added++;
        kept++;
      }
      console.log(`${added}`);
    } catch (e: any) { console.log(`SKIP (${e.message})`); }
    await sleep(400);
  }

  // chunks: per-country narrative (latest year per indicator)
  // (compact — agents can /query for the structured timeseries)
  const byCountry = new Map<string, { name: string; lat: number; lon: number; latest: Record<string, { v: number; y: string; label: string }> }>();
  for (const line of lines.slice(1)) {
    const [, lat, lon, , , , iso, name, ind_id, ind_label, v, y] = line.split(",");
    const k = iso;
    const entry = byCountry.get(k) ?? { name, lat: +lat, lon: +lon, latest: {} };
    const cur = entry.latest[ind_id];
    if (!cur || y > cur.y) entry.latest[ind_id] = { v: +v, y, label: ind_label.replace(/^"|"$/g, "") };
    byCountry.set(k, entry);
  }
  for (const [iso, e] of byCountry.entries()) {
    const parts = Object.entries(e.latest).map(([k, vk]) => `${vk.label} (${vk.y}): ${vk.v.toFixed(2)}`);
    if (!parts.length) continue;
    const text = `${e.name} (${iso}) banking system snapshot. ${parts.join(". ")}.`;
    chunks.push(JSON.stringify({
      chunk_id: `banking:${iso}#c0`,
      source_id: `banking:${iso}`,
      text,
      canonical_url: `https://data.worldbank.org/country/${iso}`,
      license: "CC-BY-4.0",
    }));
  }

  writeFileSync(join(OUT, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "chunks.jsonl"), chunks.join("\n") + "\n");
  writeFileSync(join(OUT, "manifest.yaml"),
`name: banking
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: CC-BY-4.0
contact: ops@bucket.foundation
schema_url: https://banking.feed402.dev/schema.json
`);
  writeFileSync(join(OUT, "ingest.stats.json"), JSON.stringify({
    kept, skipped, indicators: INDICATORS.map(i => i.id), countries: byCountry.size,
    chunks: chunks.length, generated_at: new Date().toISOString(),
  }, null, 2));
  console.log(`✓ ${kept} observations across ${byCountry.size} countries + ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
