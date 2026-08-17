import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  compareSpecVersions,
  formatReport,
  isLegacyVersion,
  normalizeEnvelope,
  resultList,
  validateEnvelope,
  validateManifest,
  type Report,
} from "../conformance/validate.js";
import { SPEC_VERSION, citationResultIndices, toCanonicalEnvelope } from "../types.js";

const V03 = join(import.meta.dirname, "..", "fixtures", "v0.3");
const LEGACY = join(import.meta.dirname, "..", "fixtures", "legacy");

const load = (dir: string, name: string) =>
  JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;

const errorsOf = (r: Report) => r.findings.filter((f) => f.severity === "error");
const assertOk = (name: string, r: Report) =>
  assert.ok(r.ok, `${name} should be conformant:\n${formatReport(name, r)}`);

// ---------- version arithmetic ----------

test("spec version comparison and legacy detection", () => {
  assert.equal(SPEC_VERSION, "feed402/0.3");
  assert.ok(compareSpecVersions("feed402/0.2", "feed402/0.3") < 0);
  assert.ok(compareSpecVersions("feed402/0.3", "feed402/0.3") === 0);
  assert.ok(compareSpecVersions("feed402/0.10", "feed402/0.3") > 0);
  assert.ok(isLegacyVersion("feed402/0.1"));
  assert.ok(isLegacyVersion("feed402/0.2"));
  assert.ok(!isLegacyVersion("feed402/0.3"));
});

// ---------- canonical fixtures, every tier, single and multi ----------

const ENVELOPE_FIXTURES: Array<[string, string]> = [
  ["raw-single.json", "raw"],
  ["raw-multi.json", "raw"],
  ["query-single.json", "query"],
  ["query-multi.json", "query"],
  ["insight-single.json", "insight"],
  ["insight-multi.json", "insight"],
  ["query-multi-deduplicated.json", "query"],
  ["query-multi-shared-canonical-url.json", "query"],
  ["query-zero-results.json", "query"],
  ["insight-vds.json", "insight"],
  ["query-rights-license-only.json", "query"],
  ["query-rights-split-scopes.json", "query"],
  ["query-rights-citation-only.json", "query"],
  ["query-rights-unknown-tdm.json", "query"],
  ["insight-rights-patents-jurisdiction.json", "insight"],
];

for (const [name, tier] of ENVELOPE_FIXTURES) {
  test(`canonical fixture ${name} validates as ${SPEC_VERSION}`, () => {
    const r = validateEnvelope(load(V03, name), { tier });
    assertOk(name, r);
  });
}

test("every canonical fixture is covered by a test case", () => {
  const onDisk = readdirSync(V03).filter((f) => !f.startsWith("manifest-"));
  const covered = new Set(ENVELOPE_FIXTURES.map(([n]) => n));
  for (const f of onDisk) assert.ok(covered.has(f), `fixture ${f} has no test case`);
});

test("canonical manifests validate", () => {
  assertOk("manifest-single-dataset", validateManifest(load(V03, "manifest-single-dataset.json")));
  assertOk("manifest-with-index", validateManifest(load(V03, "manifest-with-index.json")));
  assertOk("manifest-rights-default", validateManifest(load(V03, "manifest-rights-default.json")));
});

// ---------- §3.3 correspondence rules ----------

test("§3.3 rule 1: a single-record response returns exactly one citation", () => {
  const env = load(V03, "raw-single.json") as Record<string, unknown>;
  assert.equal(resultList(env.data), null, "fixture is single-record");
  const broken = { ...env, citation: [...(env.citation as unknown[]), (env.citation as unknown[])[0]] };
  const errs = errorsOf(validateEnvelope(broken));
  assert.ok(errs.some((e) => e.section === "3.3" && /exactly 1 citation/.test(e.message)));
});

test("§3.3 rule 2: ordinal alignment requires one citation per result", () => {
  const env = load(V03, "raw-multi.json") as Record<string, unknown>;
  const short = { ...env, citation: (env.citation as unknown[]).slice(0, 1) };
  const errs = errorsOf(validateEnvelope(short));
  assert.ok(errs.some((e) => e.section === "3.3" && /ordinal alignment/.test(e.message)));
});

test("§3.3 rule 3: result_index is all-or-nothing across the array", () => {
  const env = load(V03, "query-multi-deduplicated.json") as Record<string, unknown>;
  const cits = (env.citation as Array<Record<string, unknown>>).map((c) => ({ ...c }));
  delete cits[1].result_index;
  const errs = errorsOf(validateEnvelope({ ...env, citation: cits }));
  assert.ok(errs.some((e) => /every citation must carry it/.test(e.message)));
});

test("§3.3 rule 4: deduplicated citations bind explicitly and cover every result", () => {
  const env = load(V03, "query-multi-deduplicated.json") as Record<string, unknown>;
  assertOk("deduplicated", validateEnvelope(env));

  const cits = (env.citation as Array<Record<string, unknown>>).map((c) => ({ ...c }));
  cits[0].result_index = [0]; // leaves result 1 ungrounded
  const errs = errorsOf(validateEnvelope({ ...env, citation: cits }));
  assert.ok(errs.some((e) => /result 1 is not grounded/.test(e.message)));

  const oob = (env.citation as Array<Record<string, unknown>>).map((c) => ({ ...c }));
  oob[1].result_index = [9];
  assert.ok(errorsOf(validateEnvelope({ ...env, citation: oob })).some((e) => /out of range/.test(e.message)));
});

test("§3.3 rule 5: a shared canonical_url does not merge distinct records", () => {
  const env = load(V03, "query-multi-shared-canonical-url.json") as Record<string, unknown>;
  const cits = env.citation as Array<Record<string, unknown>>;
  assert.equal(cits[0].canonical_url, cits[1].canonical_url, "fixture shares a landing page");
  assert.notEqual(cits[0].source_id, cits[1].source_id);
  assertOk("shared-canonical-url", validateEnvelope(env));
});

test("§3.3 rule 5: a repeated dedup key is an error", () => {
  const env = load(V03, "query-multi.json") as Record<string, unknown>;
  const cits = env.citation as Array<Record<string, unknown>>;
  const dup = [cits[0], { ...cits[1], source_id: cits[0].source_id }];
  const errs = errorsOf(validateEnvelope({ ...env, citation: dup }));
  assert.ok(errs.some((e) => /duplicate dedup key/.test(e.message)));
});

test("§3.3 rule 6: a zero-result response carries one citation with result_index []", () => {
  const env = load(V03, "query-zero-results.json") as Record<string, unknown>;
  assertOk("zero-results", validateEnvelope(env));
  const cits = (env.citation as Array<Record<string, unknown>>).map((c) => ({ ...c }));
  delete cits[0].result_index;
  assert.ok(errorsOf(validateEnvelope({ ...env, citation: cits })).some((e) => /result_index: \[\]/.test(e.message)));
});

test("retrieval rank and result_index are separate coordinates", () => {
  const env = load(V03, "insight-multi.json") as Record<string, unknown>;
  const cits = env.citation as Array<Record<string, unknown>>;
  cits.forEach((c, i) => {
    assert.equal((c.retrieval as { rank: number }).rank, i, "fixture returns results in retrieval order");
    assert.deepEqual(citationResultIndices(c as never, i), [i], "ordinal alignment when result_index is absent");
  });
});

// ---------- §7 migration and legacy readability ----------

test("§7.1 a 0.3 envelope must not ship a singular citation", () => {
  const env = load(V03, "query-multi.json") as Record<string, unknown>;
  const singular = { ...env, citation: (env.citation as unknown[])[0] };
  const errs = errorsOf(validateEnvelope(singular));
  assert.ok(errs.some((e) => /must be an array/.test(e.message)));
});

test("§7.3 historical v0.1 and v0.2 envelopes still parse under legacy rules", () => {
  for (const name of ["v0.1-query.json", "v0.2-insight.json", "v0.2-gateway-hits.json"]) {
    const doc = load(LEGACY, name) as Record<string, unknown>;
    assert.ok(!Array.isArray(doc.citation), `${name} is a historical singular-citation envelope`);
    const r = validateEnvelope(doc, { version: "feed402/0.2" });
    assertOk(name, r);
    assert.ok(
      r.findings.some((f) => f.severity === "warning" && f.section === "7.1"),
      `${name} should warn that the singular shape is legacy`,
    );
  }
});

test("§7.3 the historical v0.2 manifest still validates", () => {
  assertOk("v0.2-manifest", validateManifest(load(LEGACY, "v0.2-manifest.json")));
});

test("normalizing a legacy envelope yields a readable 0.3 envelope", () => {
  const legacy = load(LEGACY, "v0.2-insight.json") as never;
  for (const norm of [normalizeEnvelope(legacy), toCanonicalEnvelope(legacy)]) {
    assert.ok(Array.isArray(norm.citation));
    assert.equal(norm.citation.length, 1);
    assert.equal((norm.citation[0] as { chunk_id: string }).chunk_id, "example:doc-3#c17");
  }
});

test("§7.2 citation_legacy must equal citation[0]", () => {
  const env = load(V03, "query-multi.json") as Record<string, unknown>;
  const cits = env.citation as unknown[];

  const good = validateEnvelope({ ...env, citation_legacy: cits[0] });
  assertOk("citation_legacy matching", good);
  assert.ok(good.findings.some((f) => f.section === "7.2" && f.severity === "warning"));

  const bad = validateEnvelope({ ...env, citation_legacy: cits[1] });
  assert.ok(errorsOf(bad).some((e) => /must equal `citation\[0\]`/.test(e.message)));
});

test("§7.2 a 0.3 hits alias must map one-to-one onto the citation array", () => {
  const env = load(V03, "insight-multi.json") as Record<string, unknown>;
  const data = env.data as Record<string, unknown>;
  const hits = (data.top_k as Array<Record<string, unknown>>).map((h) => ({
    source_id: h.source_id,
    rank: h.rank,
  }));

  const aligned = validateEnvelope({ ...env, data: { ...data, hits } });
  assertOk("hits aligned", aligned);
  assert.ok(aligned.findings.some((f) => f.section === "7.2" && /deprecated alias/.test(f.message)));

  const short = validateEnvelope({ ...env, data: { ...data, hits: hits.slice(0, 1) } });
  assert.ok(errorsOf(short).some((e) => /one-to-one/.test(e.message)));
});

// ---------- manifest rules ----------

test("manifest rejects a missing wallet, a bad tier unit, and a non-feed402 spec", () => {
  const base = load(V03, "manifest-single-dataset.json") as Record<string, unknown>;

  assert.ok(errorsOf(validateManifest({ ...base, wallet: "nope" })).some((e) => /0x-prefixed/.test(e.message)));
  assert.ok(
    errorsOf(validateManifest({ ...base, tiers: { raw: { path: "/raw", price_usd: 1, unit: "kg" } } }))
      .some((e) => /"row" or "call"/.test(e.message)),
  );
  assert.ok(errorsOf(validateManifest({ ...base, spec: "openapi/3.0" })).some((e) => /must start with/.test(e.message)));
});

test("an unknown but well-formed spec version is a warning, not an error", () => {
  const base = load(V03, "manifest-single-dataset.json") as Record<string, unknown>;
  const r = validateManifest({ ...base, spec: "feed402/9.9" });
  assert.ok(r.ok);
  assert.ok(r.findings.some((f) => f.section === "2.3" && f.severity === "warning"));
});

test("§2.3 unknown fields and unknown citation types never error", () => {
  const env = load(V03, "query-single.json") as Record<string, unknown>;
  const cits = (env.citation as Array<Record<string, unknown>>).map((c) => ({
    ...c,
    type: "measurement",
    instrument: "ctd-rosette",
  }));
  const r = validateEnvelope({ ...env, citation: cits, future_field: { anything: true } });
  assert.ok(r.ok, formatReport("unknown-fields", r));
  assert.ok(r.findings.some((f) => f.section === "3.1" && /degrading to source/.test(f.message)));
});

test("a missing citation block is fatal", () => {
  const env = load(V03, "query-single.json") as Record<string, unknown>;
  const { citation, ...noCitation } = env;
  void citation;
  assert.ok(errorsOf(validateEnvelope(noCitation)).some((e) => /No citation, not feed402/.test(e.message)));
});
