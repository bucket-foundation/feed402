// Shared Wikidata SPARQL helper for dataset ingest scripts.
// License: Wikidata data = CC0; descriptions inherited from linked Wikipedia = CC-BY-SA-4.0.
const SPARQL = "https://query.wikidata.org/sparql";
const UA = "feed402-ingest/0.1 (https://bucket.foundation; ops@bucket.foundation)";

export interface SparqlBinding { [k: string]: { value: string } | undefined; }

export async function sparql(query: string): Promise<SparqlBinding[]> {
  const url = `${SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`SPARQL ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json() as { results: { bindings: SparqlBinding[] } };
  return j.results.bindings;
}

export function parseCoord(wkt?: string): { lat: number; lon: number } {
  if (!wkt) return { lat: NaN, lon: NaN };
  const m = wkt.match(/^Point\(([-\d.]+)\s+([-\d.]+)\)$/);
  if (!m) return { lat: NaN, lon: NaN };
  return { lon: +m[1], lat: +m[2] };
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
