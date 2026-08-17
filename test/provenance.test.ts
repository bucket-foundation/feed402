import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatReport,
  validateEnvelope,
  validateExecution,
  validateLineage,
  validateManifest,
  type Report,
} from "../conformance/validate.js";
import type { Citation, ExecutionProvenance, LineageEntry } from "../types.js";

const V03 = join(import.meta.dirname, "..", "fixtures", "v0.3");

const load = (name: string) =>
  JSON.parse(readFileSync(join(V03, name), "utf8")) as Record<string, unknown>;

const errorsOf = (r: Report) => r.findings.filter((f) => f.severity === "error");
const assertOk = (name: string, r: Report) =>
  assert.ok(r.ok, `${name} should be conformant:\n${formatReport(name, r)}`);

const firstCitation = (env: Record<string, unknown>) =>
  (env.citation as Array<Record<string, unknown>>)[0];

// ---------- §3.6 backwards compatibility / levels ----------

test("§3.6 a level-0 merchant with no execution block stays conformant", () => {
  const env = load("query-execution-level0.json");
  assertOk("level-0", validateEnvelope(env, { tier: "query" }));
  assert.equal(firstCitation(env).execution, undefined);
});

test("§3.6 a level-2 proxying merchant reports what it ran without a local index", () => {
  const env = load("query-execution-level2-proxy.json");
  assertOk("level-2-proxy", validateEnvelope(env, { tier: "query" }));

  const exec = firstCitation(env).execution as ExecutionProvenance;
  assert.equal(exec.level, 2);
  assert.equal(exec.software, "x402-research-gateway");
  assert.equal(exec.retrieval_pipeline, "gateway.pubmed.search");
  // No local index: §3.2's retrieval.model/score/rank stay absent, and that
  // is a valid, distinct signal from "would not say."
  assert.equal(firstCitation(env).retrieval, undefined);
});

test("§3.6 a level-3 local-index merchant carries both §3.2 retrieval and §3.6 execution", () => {
  const env = load("insight-execution-level3-local-index.json");
  assertOk("level-3-local-index", validateEnvelope(env, { tier: "insight" }));

  const cit = firstCitation(env);
  assert.ok(cit.retrieval, "§3.2 retrieval fields keep their meaning unchanged");
  const exec = cit.execution as ExecutionProvenance;
  assert.equal(exec.level, 3);
  assert.ok(exec.response_sha256, "level 3 requires response_sha256");
  assert.ok(exec.corpus_sha256);
});

test("§3.6 a manifest may advertise its provenance_level", () => {
  const m = {
    name: "example-local-index-merchant",
    version: "1.0.0",
    spec: "feed402/0.3",
    chain: "base",
    wallet: "0x1234567890123456789012345678901234567890",
    tiers: { query: { path: "/query", price_usd: 0.01, unit: "call" } },
    citation_types: ["source"],
    provenance_level: 3,
  };
  assertOk("manifest-provenance-level", validateManifest(m));
});

test("§3.6 an out-of-enum provenance_level is fatal", () => {
  const m = {
    name: "x",
    version: "1.0.0",
    spec: "feed402/0.3",
    chain: "base",
    wallet: "0x1234567890123456789012345678901234567890",
    tiers: { query: { path: "/query", price_usd: 0.01, unit: "call" } },
    citation_types: ["source"],
    provenance_level: 7,
  };
  const errs = errorsOf(validateManifest(m));
  assert.ok(errs.some((e) => /provenance_level.*must be one of/.test(e.message)));
});

// ---------- §3.6 privacy ----------

test("§3.6 a plaintext query in query_fingerprint is fatal", () => {
  const errs = validateExecution(
    { query_fingerprint: "what warms the gulf stream" },
    "$.execution",
  ).filter((f) => f.severity === "error");
  assert.ok(errs.some((e) => /digest-shaped/.test(e.message)));
});

test("§3.6 a properly hashed query_fingerprint passes", () => {
  const errs = validateExecution(
    { query_fingerprint: "sha256:9c1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f" },
    "$.execution",
  ).filter((f) => f.severity === "error");
  assert.equal(errs.length, 0);
});

test("§3.6 a credential in provider_request_fingerprint is fatal", () => {
  const errs = validateExecution(
    { provider_request_fingerprint: "https://eutils.ncbi.nlm.nih.gov/?email=gian@example.org" },
    "$.execution",
  ).filter((f) => f.severity === "error");
  assert.ok(errs.length > 0);
});

test("§3.6 execution fields never require plaintext; every field is optional", () => {
  const errs = validateExecution({}, "$.execution").filter((f) => f.severity === "error");
  assert.equal(errs.length, 0);
});

// ---------- §3.7 lineage ----------

test("§3.7 lineage never displaces mandatory citations", () => {
  const env = load("insight-lineage-gateway.json");
  assertOk("lineage-gateway", validateEnvelope(env, { tier: "insight" }));
  assert.equal((env.citation as unknown[]).length, 2, "source citations remain first-class");
  assert.equal((env.lineage as unknown[]).length, 2);
});

test("§3.7 a lineage step's sources may reference a citation index", () => {
  const env = load("insight-lineage-gateway.json");
  const step0 = (env.lineage as LineageEntry[])[0];
  assert.deepEqual(step0.sources, [0, 1]);
});

test("§3.7 a lineage step's sources may reference a prior step's derived_object", () => {
  const env = load("insight-lineage-gateway.json");
  const [step0, step1] = env.lineage as LineageEntry[];
  assert.deepEqual(step1.sources, [step0.derived_object]);
});

test("§3.7 cross-merchant composition: an unmatched string source warns, not errors", () => {
  const f = validateLineage(
    [
      {
        step: 0,
        derived_object: "agent:merge#final",
        sources: ["other-merchant:req-1#answer"],
        transformation: "merge",
      },
    ],
    0,
    "$.lineage",
  );
  assert.equal(f.filter((x) => x.severity === "error").length, 0);
  assert.ok(f.some((x) => x.severity === "warning" && /cross-merchant/.test(x.message)));
});

test("§3.7 an out-of-range citation index in sources is fatal", () => {
  const f = validateLineage(
    [{ step: 0, derived_object: "d1", sources: [5], transformation: "x" }],
    1,
    "$.lineage",
  );
  assert.ok(f.some((x) => x.severity === "error" && /out of range/.test(x.message)));
});

test("§3.7 a missing derived_object, sources, or transformation is fatal", () => {
  const f = validateLineage([{ step: 0 }], 1, "$.lineage");
  const errs = f.filter((x) => x.severity === "error");
  assert.ok(errs.some((e) => /derived_object/.test(e.message)));
  assert.ok(errs.some((e) => /transformation/.test(e.message)));
  assert.ok(errs.some((e) => /sources/.test(e.message)));
});

test("§3.7 empty sources is fatal — a step must consume something", () => {
  const f = validateLineage(
    [{ step: 0, derived_object: "d1", sources: [], transformation: "x" }],
    1,
    "$.lineage",
  );
  assert.ok(f.some((x) => x.severity === "error" && /at least one/.test(x.message)));
});

test("§3.7 multi-step composition: two merged sources across merchants", () => {
  const env = load("query-lineage-merged-multi-source.json");
  assertOk("merged-multi-source", validateEnvelope(env, { tier: "query" }));

  const citations = env.citation as Citation[];
  assert.equal(citations.length, 2, "both upstream merchants stay individually citeable");

  const lineage = env.lineage as LineageEntry[];
  assert.equal(lineage[0].transformation, "dedup");
  assert.equal(lineage[1].transformation, "rerank");
  assert.deepEqual(lineage[1].sources, [lineage[0].derived_object]);
});

// ---------- §3.6/§3.7 reconciliation ----------

test("§3.6/§3.7 software identity is spelled the same way in both blocks", () => {
  const env = load("insight-lineage-gateway.json");
  const step0 = (env.lineage as LineageEntry[])[0];
  // Same field names as ExecutionProvenance: software, software_version.
  assert.ok("software" in step0);
  assert.equal(typeof step0.software, "string");
});

// ---------- security ----------

test("no provenance fixture leaks a secret-looking value", () => {
  const names = [
    "query-execution-level0.json",
    "query-execution-level2-proxy.json",
    "insight-execution-level3-local-index.json",
    "insight-lineage-gateway.json",
    "query-lineage-merged-multi-source.json",
  ];
  const forbidden =
    /api[_-]?key|secret|bearer |authorization|private[_-]?key|x-payment|mnemonic|passphrase|\bmailto:|@example\.org|@example\.com/i;
  for (const name of names) {
    const raw = readFileSync(join(V03, name), "utf8");
    assert.ok(!forbidden.test(raw), `${name} carries a secret-looking or PII-looking value`);
  }
});
