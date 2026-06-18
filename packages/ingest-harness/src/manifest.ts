// Tiny YAML subset reader (no deps). Supports scalars, nested maps, lists of scalars.
// Sufficient for manifest.yaml; not a general parser.
import { readFileSync } from "node:fs";
import type { Manifest } from "./types.js";

export function parseYaml(src: string): any {
  const lines = src.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("#"));
  const root: any = {};
  const stack: { indent: number; obj: any; key?: string }[] = [{ indent: -1, obj: root }];
  for (const raw of lines) {
    const indent = raw.match(/^ */)![0].length;
    const line = raw.trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const top = stack[stack.length - 1];
    if (line.startsWith("- ")) {
      const val = coerce(line.slice(2).trim());
      if (top.key && Array.isArray(top.obj[top.key])) top.obj[top.key].push(val);
      else throw new Error(`unexpected list item: ${line}`);
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) throw new Error(`bad yaml line: ${line}`);
    const k = m[1].trim();
    const v = m[2].trim();
    if (v === "") {
      // child block follows; peek next line: list or map?
      // we lazily make a map; switch to array on first "- " child
      const child: any = {};
      top.obj[k] = child;
      stack.push({ indent, obj: child, key: k });
      // Pre-stage as array if parent already has [] convention via key name (heuristic): citation_types
      if (k === "citation_types") top.obj[k] = [];
      stack[stack.length - 1].obj = top.obj[k];
    } else {
      top.obj[k] = coerce(v);
    }
  }
  return root;
}

function coerce(v: string): any {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

export function loadManifest(path: string, defaults?: Partial<Manifest>): Manifest {
  const raw = parseYaml(readFileSync(path, "utf8"));
  const m: Manifest = {
    name: raw.name,
    version: raw.version ?? "0.1.0",
    spec: "feed402/0.2",
    chain: raw.chain ?? "base-sepolia",
    wallet: raw.wallet ?? "0x0000000000000000000000000000000000000000",
    tiers: raw.tiers ?? {
      raw:     { path: "/raw",     price_usd: 0.010, unit: "row" },
      query:   { path: "/query",   price_usd: 0.005, unit: "call" },
      insight: { path: "/insight", price_usd: 0.002, unit: "call" }
    },
    schema_url: raw.schema_url,
    citation_policy: raw.citation_policy ?? raw.license ?? "CC-BY-4.0",
    citation_types: Array.isArray(raw.citation_types) ? raw.citation_types : ["source"],
    contact: raw.contact ?? "ops@bucket.foundation",
    ...defaults,
  };
  if (raw.index) m.index = raw.index;
  // sanity
  if (!m.name) throw new Error("manifest.yaml: 'name' is required");
  return m;
}
