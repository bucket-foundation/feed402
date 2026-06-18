#!/usr/bin/env node
// Multi-provider HTTP entrypoint. Loads every dataset under --datasets-root and
// exposes them on a single port, routing by Host header (production) or
// /p/<name>/ path prefix (dev).
import { serve } from "@hono/node-server";
import { loadAllProviders, buildMultiHost } from "./multi.js";

interface Args {
  root: string;
  port: number;
  enforce: boolean;
  hostSuffix?: string;
}

function parseArgs(): Args {
  const a: Args = { root: "./datasets", port: 4400, enforce: true };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--datasets-root") a.root = argv[++i];
    else if (k === "--port") a.port = +argv[++i];
    else if (k === "--no-payment") a.enforce = false;
    else if (k === "--host-suffix") a.hostSuffix = argv[++i];
    else if (k === "--help" || k === "-h") { help(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); help(); process.exit(2); }
  }
  return a;
}

function help() {
  console.log(`feed402-serve-all --datasets-root <dir> [--port 4400] [--no-payment] [--host-suffix feed402.dev]

  --datasets-root  directory of dataset folders (each w/ manifest.yaml + data.csv)
  --port           HTTP port (default 4400)
  --no-payment     dev mode: skip 402, fabricate dev tx in receipt
  --host-suffix    e.g. feed402.dev → expose <provider>.feed402.dev as canonical host
`);
}

async function main() {
  const args = parseArgs();
  console.log(`feed402-serve-all loading datasets from ${args.root}...`);
  const providers = await loadAllProviders({
    datasetsRoot: args.root,
    enforce: args.enforce,
    hostSuffix: args.hostSuffix,
  });
  console.log(`  loaded ${providers.length} providers:`);
  for (const p of providers) {
    console.log(`    ${p.name.padEnd(20)} ${String(p.rows).padStart(7)} rows · ${String(p.chunks).padStart(7)} chunks${p.host ? ` · ${p.host}` : ""}`);
  }
  const total = providers.reduce((s, p) => s + p.rows, 0);
  console.log(`  total: ${total.toLocaleString()} rows`);

  const app = buildMultiHost(providers, {
    datasetsRoot: args.root,
    enforce: args.enforce,
    hostSuffix: args.hostSuffix,
  });
  console.log(`feed402-serve-all listening on :${args.port}`);
  console.log(`  payment: ${args.enforce ? "ENFORCED" : "BYPASSED (dev)"}`);
  console.log(`  routes:`);
  console.log(`    /                        index`);
  console.log(`    /health/global           combined health`);
  console.log(`    /p/<provider>/...        path-prefix routing (dev)`);
  if (args.hostSuffix) console.log(`    Host: <provider>.${args.hostSuffix}   host routing (prod)`);

  serve({ fetch: app.fetch, port: args.port });
}

main().catch(e => { console.error(e); process.exit(1); });
