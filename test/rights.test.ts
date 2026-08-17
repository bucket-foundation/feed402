import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatReport,
  validateEnvelope,
  validateManifest,
  validateRights,
  type Report,
} from "../conformance/validate.js";
import {
  RIGHTS_FACETS,
  effectiveRights,
  permits,
  rightsFacet,
  type Rights,
} from "../types.js";

const V03 = join(import.meta.dirname, "..", "fixtures", "v0.3");

const load = (name: string) =>
  JSON.parse(readFileSync(join(V03, name), "utf8")) as Record<string, unknown>;

const errorsOf = (r: Report) => r.findings.filter((f) => f.severity === "error");
const assertOk = (name: string, r: Report) =>
  assert.ok(r.ok, `${name} should be conformant:\n${formatReport(name, r)}`);

const citationsOf = (env: Record<string, unknown>) =>
  env.citation as Array<Record<string, unknown>>;

// ---------- the unknown rule ----------

test("§3.4 unknown, absent, and no block are all not-granted", () => {
  for (const facet of RIGHTS_FACETS) {
    assert.equal(permits(undefined, facet), false, "no block grants nothing");
    assert.equal(permits({}, facet), false, "an empty block grants nothing");
    assert.equal(permits({ [facet]: "unknown" }, facet), false);
    assert.equal(permits({ [facet]: "denied" }, facet), false);
    assert.equal(permits({ [facet]: "allowed" }, facet), true);
  }
});

test("§3.4 an unknown facet is distinguishable from an absent one", () => {
  assert.equal(rightsFacet({ tdm: "unknown" }, "tdm"), "unknown");
  assert.equal(rightsFacet({}, "tdm"), "unknown");
  // Both read as not-granted, and neither reads as denied.
  assert.notEqual(rightsFacet({ tdm: "unknown" }, "tdm"), "denied");
});

test("§3.4 permits() never grants on a facet the merchant did not name", () => {
  const rights: Rights = { redistribution: "allowed" };
  assert.ok(permits(rights, "redistribution"));
  assert.ok(!permits(rights, "tdm"));
  assert.ok(!permits(rights, "model_training"));
  assert.ok(!permits(rights, "retention"));
});

// ---------- citation_only shorthand ----------

test("§3.4 citation_only denies redistribution and retention", () => {
  const rights: Rights = { citation_only: true };
  assert.equal(rightsFacet(rights, "redistribution"), "denied");
  assert.equal(rightsFacet(rights, "retention"), "denied");
  // It says nothing about mining or training.
  assert.equal(rightsFacet(rights, "tdm"), "unknown");
  assert.equal(rightsFacet(rights, "model_training"), "unknown");
});

test("§3.4 an explicit facet contradicting citation_only is fatal", () => {
  const errs = validateRights(
    { citation_only: true, redistribution: "allowed" },
    "$.rights",
  ).filter((f) => f.severity === "error");
  assert.ok(errs.some((e) => /cannot also be "allowed"/.test(e.message)));
});

test("§3.4 citation_only false leaves the shorthand out of the way", () => {
  const rights: Rights = { citation_only: false, redistribution: "allowed" };
  assert.equal(rightsFacet(rights, "redistribution"), "allowed");
  assert.equal(rightsFacet(rights, "retention"), "unknown");
});

// ---------- resolution ----------

test("§3.4 nearest block wins whole, with no field-level merge", () => {
  const manifest: Rights = { tdm: "allowed", model_training: "allowed" };
  const citation: Rights = { redistribution: "denied" };

  assert.deepEqual(effectiveRights(citation, manifest), citation);
  assert.deepEqual(effectiveRights(undefined, manifest), manifest);
  assert.equal(effectiveRights(undefined, undefined), undefined);

  // The manifest's tdm grant must not leak into a citation that overrode it.
  assert.ok(!permits(effectiveRights(citation, manifest), "tdm"));
});

// ---------- fixtures ----------

test("a merchant emitting only `license` stays conformant", () => {
  const env = load("query-rights-license-only.json");
  assertOk("license-only", validateEnvelope(env, { tier: "query" }));
  assert.equal(citationsOf(env)[0].rights, undefined, "fixture carries no rights block");
  assert.equal(citationsOf(env)[0].license, "CC-BY-4.0");
});

test("split metadata and content rights validate and read separately", () => {
  const env = load("query-rights-split-scopes.json");
  assertOk("split-scopes", validateEnvelope(env, { tier: "query" }));

  const rights = citationsOf(env)[0].rights as Rights;
  assert.equal(rights.metadata?.license, "CC0-1.0");
  assert.equal(rights.metadata?.status, "allowed");
  assert.equal(rights.content?.status, "denied");
  // Public-domain metadata does not make the article redistributable.
  assert.ok(!permits(rights, "redistribution"));
  assert.ok(permits(rights, "tdm"));
  assert.ok(!permits(rights, "model_training"), "unknown training is not granted");
});

test("a citation-only fixture denies redistribution and retention", () => {
  const env = load("query-rights-citation-only.json");
  assertOk("citation-only", validateEnvelope(env, { tier: "query" }));

  const rights = citationsOf(env)[0].rights as Rights;
  assert.ok(!permits(rights, "redistribution"));
  assert.ok(!permits(rights, "retention"));
  assert.equal(rightsFacet(rights, "model_training"), "denied");
});

test("an unknown-TDM fixture grants everything it names and nothing it does not", () => {
  const env = load("query-rights-unknown-tdm.json");
  assertOk("unknown-tdm", validateEnvelope(env, { tier: "query" }));

  const rights = citationsOf(env)[0].rights as Rights;
  assert.equal(rightsFacet(rights, "tdm"), "unknown");
  assert.ok(!permits(rights, "tdm"), "a CC-BY body does not imply a mining grant");
  assert.ok(permits(rights, "redistribution"));
});

test("a manifest may carry a default rights determination", () => {
  const m = load("manifest-rights-default.json");
  assertOk("manifest-rights-default", validateManifest(m));
  assert.equal(m.citation_policy, "mixed", "the prose summary survives");
  assert.ok(permits(m.rights as Rights, "tdm"));
});

// ---------- §6.1 worked example ----------

test("§6.1.1 the patents jurisdiction rules round-trip through the block", () => {
  const env = load("insight-rights-patents-jurisdiction.json");
  assertOk("patents-jurisdiction", validateEnvelope(env, { tier: "insight" }));

  const byJurisdiction = new Map(
    citationsOf(env).map((c) => [(c.rights as Rights).jurisdiction, c.rights as Rights]),
  );

  const us = byJurisdiction.get("US")!;
  assert.ok(permits(us, "redistribution") && permits(us, "tdm") && permits(us, "model_training"));

  const ep = byJurisdiction.get("EP")!;
  assert.equal(ep.content?.status, "denied", "EPO OPS serves bibliographic data only");
  assert.ok(!permits(ep, "redistribution") && !permits(ep, "retention"));
  assert.equal(rightsFacet(ep, "tdm"), "denied");

  const wo = byJurisdiction.get("WO")!;
  assert.deepEqual(wo.content?.tiers, ["insight"], "PATENTSCOPE content is insight-tier only");
  assert.equal(rightsFacet(wo, "tdm"), "unknown");
  assert.ok(!permits(wo, "model_training"));
});

// ---------- validator rules ----------

test("§3.4 a permission outside the enum is fatal", () => {
  const errs = validateRights({ tdm: "maybe" }, "$.rights").filter((f) => f.severity === "error");
  assert.ok(errs.some((e) => /must be one of allowed, denied, unknown/.test(e.message)));
});

test("§3.4 terms_url without retrieved_at is a warning", () => {
  const f = validateRights({ tdm: "allowed", terms_url: "https://example.org/terms" }, "$.rights");
  assert.ok(f.some((x) => x.severity === "warning" && /not auditable later/.test(x.message)));
  assert.ok(!f.some((x) => x.severity === "error"));
});

test("§3.4 a bad retrieved_at is fatal", () => {
  const errs = validateRights({ tdm: "allowed", retrieved_at: "August 2026" }, "$.rights")
    .filter((f) => f.severity === "error");
  assert.ok(errs.some((e) => /ISO-8601/.test(e.message)));
});

test("§3.4 a rights block that states nothing warns", () => {
  const f = validateRights({ terms_url: "https://example.org/terms", retrieved_at: "2026-08-01T00:00:00Z" }, "$.rights");
  assert.ok(f.some((x) => x.severity === "warning" && /states no scope and no facet/.test(x.message)));
});

test("§3.4 an unknown tier in a scope restriction warns rather than errors", () => {
  const f = validateRights({ content: { status: "allowed", tiers: ["premium"] } }, "$.rights");
  assert.ok(f.some((x) => x.severity === "warning" && /unknown tier name/.test(x.message)));
  assert.ok(!f.some((x) => x.severity === "error"));
});

test("§3.4 a summary license contradicting the block warns", () => {
  const env = load("query-rights-citation-only.json");
  const cits = citationsOf(env).map((c) => ({
    ...c,
    rights: { ...(c.rights as Rights), citation_only: false },
  }));
  const r = validateEnvelope({ ...env, citation: cits }, { tier: "query" });
  assert.ok(r.ok, formatReport("contradicting-summary", r));
  assert.ok(r.findings.some((x) => x.severity === "warning" && /summary `license` says citation-only/.test(x.message)));
});

test("§2.3 an unknown rights facet is ignored rather than rejected", () => {
  const env = load("query-rights-split-scopes.json");
  const cits = citationsOf(env).map((c) => ({
    ...c,
    rights: { ...(c.rights as Rights), sui_generis_database: "allowed" },
  }));
  assertOk("unknown-facet", validateEnvelope({ ...env, citation: cits }, { tier: "query" }));
});

// ---------- security ----------

test("no rights fixture leaks a secret-looking value", () => {
  const names = [
    "query-rights-license-only.json",
    "query-rights-split-scopes.json",
    "query-rights-citation-only.json",
    "query-rights-unknown-tdm.json",
    "insight-rights-patents-jurisdiction.json",
    "manifest-rights-default.json",
  ];
  const forbidden =
    /api[_-]?key|secret|bearer |authorization|private[_-]?key|x-payment|mnemonic|passphrase|\bmailto:/i;
  for (const name of names) {
    const raw = readFileSync(join(V03, name), "utf8");
    assert.ok(!forbidden.test(raw), `${name} carries a secret-looking value`);
  }
});

test("a credential in a published rights URL is fatal", () => {
  for (const url of [
    "https://example.org/terms?api_key=sk-live-abcdef",
    "https://example.org/terms?access_token=eyJhbGciOi",
    "https://eutils.ncbi.nlm.nih.gov/policies?email=gian@example.org",
    "https://example.org/terms?signature=0xdeadbeef",
  ]) {
    const errs = validateRights(
      { tdm: "allowed", terms_url: url, retrieved_at: "2026-08-01T00:00:00Z" },
      "$.rights",
    ).filter((f) => f.severity === "error");
    assert.ok(errs.some((e) => /credential-shaped/.test(e.message)), `${url} should be rejected`);
  }
});

test("a credential in a license_url or a canonical_url is fatal", () => {
  const scoped = validateRights(
    { content: { status: "allowed", license_url: "https://example.org/l?token=abc123" } },
    "$.rights",
  );
  assert.ok(scoped.some((f) => f.severity === "error" && /credential-shaped/.test(f.message)));

  const env = load("query-rights-license-only.json");
  const cits = citationsOf(env).map((c) => ({
    ...c,
    canonical_url: "https://example.org/rec-7?apikey=sk-live-abcdef",
  }));
  const errs = errorsOf(validateEnvelope({ ...env, citation: cits }, { tier: "query" }));
  assert.ok(errs.some((e) => /credential-shaped/.test(e.message)));
});

test("a clean URL with ordinary query parameters still passes", () => {
  const f = validateRights(
    {
      tdm: "allowed",
      terms_url: "https://patentscope.wipo.int/search/en/help/terms.jsf?locale=en&v=2",
      retrieved_at: "2026-08-01T00:00:00Z",
    },
    "$.rights",
  );
  assert.ok(!f.some((x) => x.severity === "error"));
});
