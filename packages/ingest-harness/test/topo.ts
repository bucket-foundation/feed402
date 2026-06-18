import { pointToCountry } from "../datasets/_lib/topojson.js";

const cases: Array<[string, number, number, string]> = [
  ["NYC",        40.7128, -74.0060, "US"],
  ["London",     51.5074,  -0.1278, "GB"],
  ["Tokyo",      35.6762, 139.6503, "JP"],
  ["São Paulo", -23.5505, -46.6333, "BR"],
  ["Lagos",       6.5244,   3.3792, "NG"],
  ["Sydney",    -33.8688, 151.2093, "AU"],
  ["Cairo",      30.0444,  31.2357, "EG"],
  ["Reykjavik",  64.1466, -21.9426, "IS"],
  ["Wellington",-41.2865, 174.7762, "NZ"],
  ["mid-ocean (Pacific, no country)", 0, -150, ""],
];

let pass = 0, fail = 0;
for (const [name, lat, lon, expect] of cases) {
  const got = pointToCountry(lat, lon) ?? "";
  if (got === expect) { pass++; console.log(`  ✓ ${name.padEnd(36)} → ${got || "(none)"}`); }
  else { fail++; console.log(`  ✗ ${name.padEnd(36)} → ${got || "(none)"} (expected ${expect || "(none)"})`); }
}
console.log(`\n${pass}/${pass+fail} polygon tests passed`);
process.exit(fail ? 1 : 0);
