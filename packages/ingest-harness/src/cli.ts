#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadManifest } from "./manifest.js";
import { readCsv } from "./csv.js";
import { Bm25 } from "./insight.js";
import { buildServer } from "./server.js";
import { paymentModeFromEnv } from "./x402.js";
import type { DatasetConfig } from "./types.js";

interface Args {
  dataset: string;
  port: number;
  enforce: boolean;
}

function parseArgs(): Args {
  const a: Args = { dataset: "", port: 4402, enforce: true };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--dataset") a.dataset = argv[++i];
    else if (k === "--port") a.port = +argv[++i];
    else if (k === "--no-payment") a.enforce = false;
    else if (k === "--help" || k === "-h") { help(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); help(); process.exit(2); }
  }
  if (!a.dataset) { help(); process.exit(2); }
  return a;
}

function help() {
  console.log(`feed402-serve --dataset <dir> [--port 4402] [--no-payment]

  --dataset    path to a dataset folder containing manifest.yaml, data.csv, [chunks.jsonl]
  --port       HTTP port (default 4402)
  --no-payment dev mode: skip 402 challenge, fabricate dev tx in receipt
`);
}

async function main() {
  const args = parseArgs();
  const dir = args.dataset;
  const manifestPath = join(dir, "manifest.yaml");
  const csvPath = join(dir, "data.csv");
  const chunksPath = join(dir, "chunks.jsonl");
  if (!existsSync(manifestPath)) throw new Error(`missing ${manifestPath}`);
  if (!existsSync(csvPath)) throw new Error(`missing ${csvPath}`);

  const manifest = loadManifest(manifestPath);
  const rows = await readCsv(csvPath);
  const bm25 = Bm25.fromJsonl(chunksPath);

  const dataset: DatasetConfig = {
    provider: manifest.name,
    defaultLicense: manifest.citation_policy,
    rows,
    chunks: [],
    manifest,
  };

  const payment = paymentModeFromEnv(args.enforce, manifest.chain);
  const app = await buildServer({ dataset, bm25, payment });
  console.log(`feed402-serve listening on :${args.port}`);
  console.log(`  provider: ${manifest.name}`);
  console.log(`  rows:     ${rows.length}`);
  console.log(`  chunks:   ${bm25.size}`);
  console.log(`  payment:  ${args.enforce ? `ENFORCED (verifier=${payment.verifier}${payment.facilitatorUrl ? " → " + payment.facilitatorUrl : ""})` : "BYPASSED (dev)"}`);
  console.log(`  manifest: http://localhost:${args.port}/.well-known/feed402.json`);

  serve({ fetch: app.fetch, port: args.port });
}

main().catch(e => { console.error(e); process.exit(1); });
