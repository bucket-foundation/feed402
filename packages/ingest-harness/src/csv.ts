// Minimal RFC 4180-ish CSV reader. Streaming-friendly, no deps.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Row } from "./types.js";

const REQUIRED = ["id", "lat", "lon", "timestamp", "source_url", "license"] as const;

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') { inQ = true; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export async function readCsv(path: string): Promise<Row[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  const rows: Row[] = [];
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    const cells = parseCsvLine(raw);
    if (!header) {
      header = cells.map(c => c.trim());
      for (const r of REQUIRED) {
        if (!header.includes(r)) {
          throw new Error(`csv missing required column: ${r} (have: ${header.join(",")})`);
        }
      }
      continue;
    }
    const obj: Record<string, unknown> = {};
    header.forEach((k, i) => { obj[k] = cells[i] ?? ""; });
    obj.lat = Number(obj.lat);
    obj.lon = Number(obj.lon);
    rows.push(obj as Row);
  }
  return rows;
}
