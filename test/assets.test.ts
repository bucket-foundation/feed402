import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatReport,
  validateAssets,
  validateEnvelope,
  type Report,
} from "../conformance/validate.js";
import {
  AVAILABILITIES,
  REPRESENTATIONS,
  assetAvailability,
  assetRights,
  isKnownRepresentation,
  permits,
  type Asset,
  type Rights,
} from "../types.js";

const V03 = join(import.meta.dirname, "..", "fixtures", "v0.3");

const load = (name: string) =>
  JSON.parse(readFileSync(join(V03, name), "utf8")) as Record<string, unknown>;

const errorsOf = (r: Report | ReturnType<typeof validateAssets>) =>
  (Array.isArray(r) ? r : r.findings).filter((f) => f.severity === "error");
const assertOk = (name: string, r: Report) =>
  assert.ok(r.ok, `${name} should be conformant:\n${formatReport(name, r)}`);

const firstCitation = (env: Record<string, unknown>) =>
  (env.citation as Array<Record<string, unknown>>)[0];
const assetsOf = (env: Record<string, unknown>) => firstCitation(env).assets as Asset[];
const byId = (env: Record<string, unknown>) =>
  new Map(assetsOf(env).map((a) => [a.asset_id, a]));

// ---------- backwards compatibility ----------

test("§3.5 a merchant emitting only canonical_url stays conformant", () => {
  const env = load("query-single.json");
  assert.equal(firstCitation(env).assets, undefined, "fixture predates assets");
  assertOk("no-assets", validateEnvelope(env, { tier: "query" }));
});

test("§3.5 record-level canonical_url survives alongside an assets array", () => {
  const env = load("query-assets-oa-and-restricted.json");
  assertOk("assets-plus-canonical", validateEnvelope(env, { tier: "query" }));
  assert.equal(
    firstCitation(env).canonical_url,
    "https://doi.org/10.1038/s41586-021-03819-2",
    "the record keeps its own stable address",
  );
});

// ---------- fixtures ----------

test("§3.5 a metadata-only record can say the full text is absent", () => {
  const env = load("query-assets-metadata-only.json");
  assertOk("metadata-only", validateEnvelope(env, { tier: "query" }));

  const assets = byId(env);
  assert.equal(assets.get("record")!.representation, "metadata");
  assert.equal(assetAvailability(assets.get("record")!), "retrievable");

  const pdf = assets.get("oa-pdf")!;
  assert.equal(assetAvailability(pdf), "absent");
  assert.equal(pdf.canonical_url, undefined, "an absent representation has nowhere to point");
});

test("§3.5 an OA copy and a restricted publisher copy are told apart", () => {
  const env = load("query-assets-oa-and-restricted.json");
  assertOk("oa-and-restricted", validateEnvelope(env, { tier: "query" }));

  const assets = byId(env);
  const oa = assets.get("oa-pdf")!;
  const publisher = assets.get("publisher-pdf")!;

  assert.equal(assetAvailability(oa), "retrievable");
  assert.equal(assetAvailability(publisher), "restricted");
  assert.notEqual(oa.canonical_url, publisher.canonical_url);
  assert.equal(oa.version, "accepted-manuscript");
  assert.equal(publisher.version, "version-of-record");

  // Same representation, opposite rights. This is the case one `license`
  // string could never carry.
  assert.ok(permits(assetRights(oa, firstCitation(env)), "redistribution"));
  assert.ok(!permits(assetRights(publisher, firstCitation(env)), "redistribution"));
});

test("§3.5 structured full text and a supplementary dataset coexist", () => {
  const env = load("query-assets-fulltext-and-dataset.json");
  assertOk("fulltext-and-dataset", validateEnvelope(env, { tier: "query" }));

  const assets = byId(env);
  assert.equal(assets.get("jats")!.content_type, "jats-1.3", "MIME type alone would say only xml");
  assert.equal(assets.get("supp-dataset-1")!.representation, "dataset");

  // The article's CC-BY does not extend to a third-party figure.
  const figure = assets.get("figure-2")!;
  const citation = firstCitation(env);
  assert.ok(permits(citation.rights as Rights, "tdm"), "the article permits mining");
  assert.ok(!permits(assetRights(figure, citation), "tdm"), "the figure does not");
});

// ---------- discovery is not a rights grant ----------

test("§3.5 a retrievable asset with no rights anywhere grants nothing", () => {
  const asset: Asset = {
    asset_id: "a1",
    representation: "pdf",
    canonical_url: "https://example.org/a1.pdf",
    availability: "retrievable",
  };
  assert.equal(assetRights(asset), undefined);
  assert.ok(!permits(assetRights(asset), "redistribution"));
  assert.ok(!permits(assetRights(asset), "tdm"));
  assert.ok(!permits(assetRights(asset), "model_training"));
  assert.ok(!permits(assetRights(asset), "retention"));
});

test("§3.5 asset rights override the citation's whole, with no field merge", () => {
  const citation = { rights: { tdm: "allowed", model_training: "allowed" } as Rights };
  const asset: Asset = {
    asset_id: "a1",
    representation: "pdf",
    rights: { redistribution: "denied" },
  };
  const resolved = assetRights(asset, citation)!;
  assert.deepEqual(resolved, asset.rights);
  assert.ok(!permits(resolved, "tdm"), "the citation's grant must not leak into the asset");
});

test("§3.5 an asset falls back to the citation, then the manifest", () => {
  const manifest = { rights: { tdm: "allowed" } as Rights };
  const citation = { rights: { retention: "allowed" } as Rights };
  const bare: Asset = { asset_id: "a1", representation: "pdf" };

  assert.deepEqual(assetRights(bare, citation, manifest), citation.rights);
  assert.deepEqual(assetRights(bare, undefined, manifest), manifest.rights);
});

test("§3.5 availability defaults to unknown rather than to a grant", () => {
  const asset: Asset = { asset_id: "a1", representation: "pdf" };
  assert.equal(assetAvailability(asset), "unknown");
  assert.ok(!permits(assetRights(asset), "redistribution"));
});

// ---------- vocabulary ----------

test("§3.5 the representation vocabulary is open and domain-neutral", () => {
  assert.ok(isKnownRepresentation("jats"));
  assert.ok(isKnownRepresentation("dataset"));
  assert.ok(!isKnownRepresentation("crystallographic-cif"));
  assert.equal(new Set(REPRESENTATIONS).size, REPRESENTATIONS.length, "no duplicates");

  for (const r of REPRESENTATIONS) {
    assert.ok(
      !/pubmed|openalex|crossref|arxiv|zenodo|quantum|biolog|chem|physic/i.test(r),
      `representation "${r}" leaks a specific upstream or discipline`,
    );
  }
});

test("§2.3 an unknown representation warns rather than errors", () => {
  const f = validateAssets(
    [{ asset_id: "a1", representation: "crystallographic-cif", canonical_url: "https://example.org/a.cif" }],
    "$.assets",
  );
  assert.equal(errorsOf(f).length, 0);
  assert.ok(f.some((x) => x.severity === "warning" && /not in the v0.3 vocabulary/.test(x.message)));
});

// ---------- validator rules ----------

test("§3.5 asset_id and representation are required", () => {
  const errs = errorsOf(validateAssets([{ canonical_url: "https://example.org/a" }], "$.assets"));
  assert.ok(errs.some((e) => /`asset_id` is missing/.test(e.message)));
  assert.ok(errs.some((e) => /`representation` is missing/.test(e.message)));
});

test("§3.5 a duplicate asset_id within one citation is fatal", () => {
  const dup = [
    { asset_id: "a1", representation: "pdf", canonical_url: "https://example.org/1.pdf" },
    { asset_id: "a1", representation: "html", canonical_url: "https://example.org/1.html" },
  ];
  assert.ok(errorsOf(validateAssets(dup, "$.assets")).some((e) => /duplicate asset_id/.test(e.message)));
});

test("§3.5 an availability outside the enum is fatal", () => {
  const errs = errorsOf(
    validateAssets([{ asset_id: "a1", representation: "pdf", availability: "maybe" }], "$.assets"),
  );
  assert.ok(errs.some((e) => new RegExp(AVAILABILITIES.join(", ")).test(e.message)));
});

test("§3.5 an absent asset carrying an address warns", () => {
  const f = validateAssets(
    [{ asset_id: "a1", representation: "pdf", availability: "absent", canonical_url: "https://example.org/1.pdf" }],
    "$.assets",
  );
  assert.equal(errorsOf(f).length, 0);
  assert.ok(f.some((x) => x.severity === "warning" && /nowhere to point/.test(x.message)));
});

test("§3.5 an asset with no address and no checksum warns", () => {
  const f = validateAssets([{ asset_id: "a1", representation: "pdf" }], "$.assets");
  assert.ok(f.some((x) => x.severity === "warning" && /cannot locate or identify it/.test(x.message)));
});

test("§3.5 a malformed checksum warns and a negative size is fatal", () => {
  const f = validateAssets(
    [{ asset_id: "a1", representation: "pdf", canonical_url: "https://example.org/1.pdf", checksum: "deadbeef", size: -1 }],
    "$.assets",
  );
  assert.ok(f.some((x) => x.severity === "warning" && /<algorithm>:<hex>/.test(x.message)));
  assert.ok(errorsOf(f).some((e) => /non-negative integer/.test(e.message)));
});

test("§3.5 assets must be an array", () => {
  assert.ok(errorsOf(validateAssets({ asset_id: "a1" }, "$.assets")).some((e) => /must be an array/.test(e.message)));
});

test("§3.5 a bad per-asset rights block is reported at the asset path", () => {
  const errs = errorsOf(
    validateAssets(
      [{ asset_id: "a1", representation: "pdf", canonical_url: "https://example.org/1.pdf", rights: { tdm: "maybe" } }],
      "$.assets",
    ),
  );
  assert.ok(errs.some((e) => e.path === "$.assets[0].rights.tdm"));
});

// ---------- security ----------

test("§3.5 a credential in an asset URL is fatal", () => {
  for (const field of ["canonical_url", "provider_url"]) {
    const errs = errorsOf(
      validateAssets(
        [{ asset_id: "a1", representation: "pdf", [field]: "https://example.org/1.pdf?api_key=sk-live-abcdef" }],
        "$.assets",
      ),
    );
    assert.ok(errs.some((e) => /credential-shaped/.test(e.message)), `${field} should be rejected`);
  }
});

test("§3.5 a polite-pool email in a provider_url is fatal", () => {
  const errs = errorsOf(
    validateAssets(
      [{
        asset_id: "a1",
        representation: "pdf",
        provider_url: "https://api.unpaywall.org/v2/10.1038/x?email=gian@example.org",
      }],
      "$.assets",
    ),
  );
  assert.ok(errs.some((e) => /personally identifying/.test(e.message)));
});

test("no asset fixture leaks a secret-looking value", () => {
  const forbidden =
    /api[_-]?key|secret|bearer |authorization|private[_-]?key|x-payment|mnemonic|passphrase|\bmailto:/i;
  for (const name of [
    "query-assets-metadata-only.json",
    "query-assets-oa-and-restricted.json",
    "query-assets-fulltext-and-dataset.json",
  ]) {
    const raw = readFileSync(join(V03, name), "utf8");
    assert.ok(!forbidden.test(raw), `${name} carries a secret-looking value`);
  }
});
