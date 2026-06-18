// Query filter compiler: bbox + time range + arbitrary equality filters.
import type { Row } from "./types.js";

export interface QueryParams {
  bbox?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  from?: string;          // ISO-8601 or year string
  to?: string;
  filters?: Record<string, string>;
  limit?: number;
  offset?: number;
  order_by?: string;
  order?: "asc" | "desc";
}

export function parseQuery(qs: URLSearchParams): QueryParams {
  const out: QueryParams = {};
  const bbox = qs.get("bbox");
  if (bbox) {
    const p = bbox.split(",").map(Number);
    if (p.length === 4 && p.every(n => Number.isFinite(n))) {
      out.bbox = [p[0], p[1], p[2], p[3]];
    }
  }
  const from = qs.get("from"); if (from) out.from = from;
  const to = qs.get("to");     if (to) out.to = to;
  const limit = qs.get("limit"); if (limit) out.limit = Math.min(1000, Math.max(1, +limit));
  const offset = qs.get("offset"); if (offset) out.offset = Math.max(0, +offset);
  const ob = qs.get("order_by"); if (ob) out.order_by = ob;
  const od = qs.get("order"); if (od === "asc" || od === "desc") out.order = od;
  // any param prefixed `f.` becomes an equality filter
  const filters: Record<string, string> = {};
  for (const [k, v] of qs.entries()) {
    if (k.startsWith("f.")) filters[k.slice(2)] = v;
  }
  if (Object.keys(filters).length) out.filters = filters;
  return out;
}

// Convert any year-ish timestamp string to a "year ordinal" number that compares
// correctly across BCE/CE. Year ordinal = JS year offset from 1970, in years.
// BCE inputs accept either leading "-" (ISO-8601 extended: "-0500") or "500BC".
// We compare in *year units*, not ms, because Date.parse cannot represent BCE.
export function tsToYear(s: string): number {
  if (!s) return NaN;
  // ISO extended: -0500-01-01 or -500
  let m = s.match(/^-(\d+)/);
  if (m) return -Number(m[1]);
  // 500BC / 500BCE / 500 BC
  m = s.match(/^(\d+)\s*(?:BC|BCE)$/i);
  if (m) return -Number(m[1]);
  // Plain year "1500"
  if (/^\d{1,4}$/.test(s)) return Number(s);
  // Standard ISO with year ≥ 1
  m = s.match(/^(\d{4,})-/);
  if (m) return Number(m[1]);
  // Fallback: try Date.parse for full ISO
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).getUTCFullYear();
  return NaN;
}

// Apply same to the row.timestamp string in rows; supports negative-year ISO ("-0500-01-01...").
function rowYear(ts: string): number { return tsToYear(ts); }

export function applyQuery(rows: Row[], q: QueryParams): Row[] {
  let out = rows;
  if (q.bbox) {
    const [minLon, minLat, maxLon, maxLat] = q.bbox;
    out = out.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon)
      && r.lon >= minLon && r.lon <= maxLon && r.lat >= minLat && r.lat <= maxLat);
  }
  if (q.from) {
    const y0 = tsToYear(q.from);
    if (Number.isFinite(y0)) out = out.filter(r => rowYear(r.timestamp) >= y0);
  }
  if (q.to) {
    const y1 = tsToYear(q.to);
    if (Number.isFinite(y1)) out = out.filter(r => rowYear(r.timestamp) <= y1);
  }
  if (q.filters) {
    out = out.filter(r => Object.entries(q.filters!).every(([k, v]) => String(r[k] ?? "") === v));
  }
  if (q.order_by) {
    const k = q.order_by;
    const dir = q.order === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const av = a[k] as any, bv = b[k] as any;
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * dir;
    });
  }
  const off = q.offset ?? 0;
  const lim = q.limit ?? 100;
  return out.slice(off, off + lim);
}
