/**
 * feed402 merchant conformance CLI.
 *
 *   npm run conformance -- https://merchant.example.org
 *   npm run conformance -- --fixtures
 *
 * Fetches a merchant's manifest, exercises every tier it declares, and
 * validates each response against the rules in SPEC.md. Payment is out of
 * scope: a 402 challenge is a pass for the handshake, and envelope checks
 * run only on tiers that return 200 (supply a header with `--header`).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  formatReport,
  validateEnvelope,
  validateManifest,
  type Report,
} from "./validate.js";

const MANIFEST_PATH = "/.well-known/feed402.json";

interface Args {
  base?: string;
  headers: Record<string, string>;
  fixturesOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { headers: {}, fixturesOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixtures") out.fixturesOnly = true;
    else if (a === "--header") {
      const [k, ...rest] = (argv[++i] ?? "").split(":");
      if (k && rest.length) out.headers[k.trim()] = rest.join(":").trim();
    } else if (!a.startsWith("--")) out.base = a.replace(/\/$/, "");
  }
  return out;
}

/**
 * Refuse any host listed in `.nucleus/config.json` `forbidden_urls`.
 * Patterns support a leading `*.` wildcard.
 */
function assertAllowed(url: string): void {
  let patterns: string[] = [];
  for (const candidate of [".nucleus/config.json", "../.nucleus/config.json"]) {
    try {
      patterns = JSON.parse(readFileSync(candidate, "utf8")).forbidden_urls ?? [];
      break;
    } catch {
      // no config at this path; try the next
    }
  }
  const host = new URL(url).host;
  for (const p of patterns) {
    const bare = p.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const hit = bare.startsWith("*.") ? host.endsWith(bare.slice(1)) : host === bare;
    if (hit) throw new Error(`refusing to contact forbidden host ${host} (matched "${p}")`);
  }
}

function fixtureRun(): number {
  const root = join(import.meta.dirname, "..", "fixtures");
  let failures = 0;
  for (const dir of ["v0.3", "legacy"]) {
    const legacy = dir === "legacy";
    for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(join(root, dir, name), "utf8"));
      const isManifest = name.includes("manifest");
      const version = legacy ? "feed402/0.2" : undefined;
      const r: Report = isManifest
        ? validateManifest(doc)
        : validateEnvelope(doc, { version });
      if (!r.ok) failures++;
      console.log(formatReport(`${dir}/${name}`, r));
    }
  }
  return failures;
}

async function merchantRun(base: string, headers: Record<string, string>): Promise<number> {
  assertAllowed(base);
  let failures = 0;

  const manifestUrl = base + MANIFEST_PATH;
  const res = await fetch(manifestUrl, { headers });
  if (!res.ok) {
    console.log(`FAIL  ${manifestUrl}: HTTP ${res.status}`);
    return 1;
  }
  const manifest = (await res.json()) as Record<string, unknown>;
  const mReport = validateManifest(manifest);
  if (!mReport.ok) failures++;
  console.log(formatReport(manifestUrl, mReport));

  const tiers = (manifest.tiers ?? {}) as Record<string, { path?: string }>;
  for (const [tier, spec] of Object.entries(tiers)) {
    if (!spec?.path) continue;
    const url = base + spec.path;
    let r: Response;
    try {
      r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
    } catch (e) {
      failures++;
      console.log(`FAIL  ${url}: ${(e as Error).message}`);
      continue;
    }
    if (r.status === 402) {
      const ok = Boolean(r.headers.get("x-payment-required"));
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${url}  (402 handshake, §2)`);
      continue;
    }
    if (!r.ok) {
      failures++;
      console.log(`FAIL  ${url}: HTTP ${r.status}`);
      continue;
    }
    const env = await r.json();
    const eReport = validateEnvelope(env, { version: mReport.version, tier });
    if (!eReport.ok) failures++;
    console.log(formatReport(url, eReport));
  }
  return failures;
}

const args = parseArgs(process.argv.slice(2));
const failures = args.fixturesOnly || !args.base
  ? fixtureRun()
  : await merchantRun(args.base, args.headers);

console.log(failures === 0 ? "\nconformance: PASS" : `\nconformance: ${failures} document(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
