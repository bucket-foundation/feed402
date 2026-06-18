// Ingest openFDA Drug Approvals (drugsfda) → feed402-compliant data.csv + chunks.jsonl
//
// Source: https://api.fda.gov/drug/drugsfda.json
// License: openFDA license = public domain / no warranty. Citation policy = "openFDA-public".
// Geo: best-effort sponsor HQ lookup (sponsor_name → lat/lon table below). Ungeocoded rows
//      emit lat=NaN/lon=NaN so they're excluded from bbox queries but still appear in /raw.
//
// Usage:  npx tsx datasets/pharma-fda/ingest.ts [--limit 1000] [--out ./datasets/pharma-fda]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface Args { limit: number; out: string; }
function parseArgs(): Args {
  const a: Args = { limit: 1000, out: "./datasets/pharma-fda" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") a.limit = +argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
  }
  return a;
}

// Hand-curated HQ coords for the most common pharma sponsors in openFDA.
// Pass-1 list, ~50 entries — covers the long tail we care about for v0.
// Source: each company's Wikipedia HQ address; CC-BY-SA-4.0 traceable.
const HQ: Record<string, [number, number, string]> = {
  // [lat, lon, country]
  "PFIZER":                       [40.7484, -73.9857, "US"],
  "PFIZER INC":                   [40.7484, -73.9857, "US"],
  "MERCK":                        [40.6515, -74.4060, "US"],
  "MERCK SHARP DOHME":            [40.6515, -74.4060, "US"],
  "MERCK SHARP & DOHME":          [40.6515, -74.4060, "US"],
  "JOHNSON & JOHNSON":            [40.4862, -74.4518, "US"],
  "JANSSEN":                      [40.4862, -74.4518, "US"],
  "JANSSEN PHARMS":               [40.4862, -74.4518, "US"],
  "JANSSEN PRODUCTS":             [40.4862, -74.4518, "US"],
  "BRISTOL MYERS SQUIBB":         [40.7128, -74.0060, "US"],
  "BRISTOL MYERS":                [40.7128, -74.0060, "US"],
  "ELI LILLY":                    [39.7684, -86.1581, "US"],
  "LILLY":                        [39.7684, -86.1581, "US"],
  "ABBVIE":                       [42.1814, -87.8400, "US"],
  "ABBOTT":                       [42.1814, -87.8400, "US"],
  "AMGEN":                        [34.1808, -118.7434, "US"],
  "GILEAD":                       [37.4148, -122.0789, "US"],
  "GILEAD SCIENCES":              [37.4148, -122.0789, "US"],
  "BIOGEN":                       [42.3601, -71.0589, "US"],
  "REGENERON":                    [41.0334, -73.7629, "US"],
  "MODERNA":                      [42.3601, -71.0589, "US"],
  "MODERNATX":                    [42.3601, -71.0589, "US"],
  "VERTEX":                       [42.3601, -71.0589, "US"],
  "VERTEX PHARMS":                [42.3601, -71.0589, "US"],
  "TEVA":                         [32.0853, 34.7818, "IL"],
  "TEVA PHARMS":                  [32.0853, 34.7818, "IL"],
  "TEVA PHARMS USA":              [40.0094, -75.2380, "US"],
  "NOVARTIS":                     [47.5596, 7.5886, "CH"],
  "NOVARTIS PHARMS":              [47.5596, 7.5886, "CH"],
  "ROCHE":                        [47.5630, 7.5994, "CH"],
  "HOFFMANN LA ROCHE":            [47.5630, 7.5994, "CH"],
  "GENENTECH":                    [37.6535, -122.3987, "US"],
  "SANOFI":                       [48.8786, 2.2980, "FR"],
  "SANOFI AVENTIS":               [48.8786, 2.2980, "FR"],
  "GLAXOSMITHKLINE":              [51.4861, -0.1282, "GB"],
  "GLAXO":                        [51.4861, -0.1282, "GB"],
  "GSK":                          [51.4861, -0.1282, "GB"],
  "ASTRAZENECA":                  [52.2053, 0.1218, "GB"],
  "BAYER":                        [51.0339, 6.9919, "DE"],
  "BOEHRINGER INGELHEIM":         [49.9258, 8.1167, "DE"],
  "TAKEDA":                       [34.6937, 135.5023, "JP"],
  "ASTELLAS":                     [35.6895, 139.6917, "JP"],
  "DAIICHI SANKYO":               [35.6762, 139.7503, "JP"],
  "EISAI":                        [35.7100, 139.8107, "JP"],
  "OTSUKA":                       [34.6937, 135.5023, "JP"],
  "SUN PHARM":                    [19.0760, 72.8777, "IN"],
  "SUN PHARMA":                   [19.0760, 72.8777, "IN"],
  "DR REDDYS":                    [17.4399, 78.4983, "IN"],
  "AUROBINDO":                    [17.3850, 78.4867, "IN"],
  "CIPLA":                        [19.0760, 72.8777, "IN"],
  "LUPIN":                        [19.0760, 72.8777, "IN"],
  "MYLAN":                        [40.0890, -80.7137, "US"],
  "VIATRIS":                      [40.4406, -79.9959, "US"],
  "SANDOZ":                       [47.5596, 7.5886, "CH"],
  "FRESENIUS":                    [50.0782, 8.5667, "DE"],
  "ALLERGAN":                     [33.6189, -117.9298, "US"],
  "PURDUE PHARMA":                [41.0534, -73.5387, "US"],
  "MALLINCKRODT":                 [38.6270, -90.1994, "US"],
  "ENDO":                         [40.0094, -75.2380, "US"],
  "VALEANT":                      [40.4862, -74.4518, "US"],
  "BAUSCH":                       [40.4862, -74.4518, "US"],
};

function geocode(sponsor: string): { lat: number; lon: number; country: string } {
  const s = sponsor.toUpperCase().replace(/[.,&]/g, "").replace(/\s+/g, " ").trim();
  // try direct, then progressive prefix shorten
  const tries = [s];
  const parts = s.split(" ");
  for (let i = parts.length - 1; i > 0; i--) tries.push(parts.slice(0, i).join(" "));
  for (const k of tries) {
    if (HQ[k]) return { lat: HQ[k][0], lon: HQ[k][1], country: HQ[k][2] };
  }
  return { lat: NaN, lon: NaN, country: "??" };
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

interface FdaResult {
  application_number: string;
  sponsor_name: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    pharm_class_epc?: string[];
    pharm_class_moa?: string[];
    route?: string[];
    substance_name?: string[];
  };
  products?: Array<{
    brand_name?: string;
    active_ingredients?: Array<{ name?: string; strength?: string }>;
    dosage_form?: string;
    route?: string;
    marketing_status?: string;
  }>;
  submissions?: Array<{
    submission_status?: string;
    submission_status_date?: string;
    submission_type?: string;
  }>;
}

async function fetchPage(skip: number, limit: number): Promise<FdaResult[]> {
  const url = `https://api.fda.gov/drug/drugsfda.json?limit=${limit}&skip=${skip}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`openFDA ${r.status} at skip=${skip}`);
  const j = await r.json() as { results?: FdaResult[] };
  return j.results ?? [];
}

function pickApprovalDate(r: FdaResult): string | null {
  // First "AP" (approval) submission's status_date is canonical. Else earliest submission.
  const subs = r.submissions ?? [];
  const ap = subs.find(s => s.submission_status === "AP" && s.submission_status_date);
  const pick = ap ?? subs.find(s => s.submission_status_date);
  if (!pick?.submission_status_date) return null;
  const d = pick.submission_status_date; // YYYYMMDD
  if (/^\d{8}$/.test(d)) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T00:00:00Z`;
  return null;
}

async function main() {
  const args = parseArgs();
  console.log(`pharma-fda ingest: limit=${args.limit} out=${args.out}`);
  mkdirSync(args.out, { recursive: true });

  const PAGE = 100;
  const results: FdaResult[] = [];
  for (let skip = 0; skip < args.limit; skip += PAGE) {
    const got = await fetchPage(skip, Math.min(PAGE, args.limit - skip));
    if (!got.length) break;
    results.push(...got);
    process.stdout.write(`  fetched ${results.length}/${args.limit}\r`);
  }
  console.log(`\n  total raw: ${results.length}`);

  const cols = [
    "id","lat","lon","timestamp","source_url","license",
    "sponsor","country","application_number","brand","generic","route","dosage_form",
    "pharm_class","marketing_status","submission_type"
  ];
  const lines: string[] = [cols.join(",")];
  const chunks: string[] = [];

  let kept = 0, geocoded = 0;
  for (const r of results) {
    const ts = pickApprovalDate(r);
    if (!ts) continue;
    const sponsor = r.sponsor_name ?? "";
    const { lat, lon, country } = geocode(sponsor);
    if (!Number.isNaN(lat)) geocoded++;
    const p0 = r.products?.[0];
    const brand = p0?.brand_name ?? r.openfda?.brand_name?.[0] ?? "";
    const generic = p0?.active_ingredients?.[0]?.name ?? r.openfda?.generic_name?.[0] ?? "";
    const route = p0?.route ?? r.openfda?.route?.[0] ?? "";
    const dosage = p0?.dosage_form ?? "";
    const pclass = r.openfda?.pharm_class_epc?.[0] ?? r.openfda?.pharm_class_moa?.[0] ?? "";
    const mstatus = p0?.marketing_status ?? "";
    const stype = r.submissions?.find(s => s.submission_type)?.submission_type ?? "";
    const id = r.application_number;
    const url = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${id.replace(/^[A-Z]+/, "")}`;
    lines.push([
      id, lat, lon, ts, url, "openFDA-public",
      sponsor, country, id, brand, generic, route, dosage, pclass, mstatus, stype
    ].map(csvEscape).join(","));

    // chunk: one per drug for the insight tier
    const text = `${brand || generic || "Drug"} (${generic || ""}, application ${id}) sponsored by ${sponsor}. Route ${route || "n/a"}, dosage form ${dosage || "n/a"}, pharmacologic class ${pclass || "n/a"}. Approved ${ts.slice(0,10)} by US FDA. Marketing status: ${mstatus || "n/a"}.`.replace(/\s+/g, " ").trim();
    if (text.length > 40) {
      chunks.push(JSON.stringify({
        chunk_id: `pharma-fda:${id}#c0`,
        source_id: `pharma-fda:${id}`,
        text,
        canonical_url: url,
        license: "openFDA-public",
      }));
    }
    kept++;
  }

  writeFileSync(join(args.out, "data.csv"), lines.join("\n") + "\n");
  writeFileSync(join(args.out, "chunks.jsonl"), chunks.join("\n") + "\n");

  const manifest = `name: pharma-fda
version: 0.1.0
chain: base-sepolia
wallet: 0x0000000000000000000000000000000000000000
citation_policy: openFDA-public
contact: ops@bucket.foundation
schema_url: https://pharma-fda.feed402.dev/schema.json
`;
  writeFileSync(join(args.out, "manifest.yaml"), manifest);

  const stats = {
    fetched: results.length,
    kept,
    skipped_no_date: results.length - kept,
    geocoded,
    geocode_rate: kept ? +(geocoded / kept).toFixed(3) : 0,
    chunks: chunks.length,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(join(args.out, "ingest.stats.json"), JSON.stringify(stats, null, 2));

  console.log(`✓ wrote ${kept} rows (${geocoded} geocoded = ${(stats.geocode_rate*100).toFixed(1)}%), ${chunks.length} chunks`);
  console.log(`  ${join(args.out, "data.csv")}`);
  console.log(`  ${join(args.out, "chunks.jsonl")}`);
  console.log(`  ${join(args.out, "manifest.yaml")}`);
}
main().catch(e => { console.error(e); process.exit(1); });
