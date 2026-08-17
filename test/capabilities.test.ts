/**
 * feed402 §1.1 capability vocabulary and §1.2 operation metadata,
 * plus the §1.3 / §7.2 migration off the pre-0.3 `routes` enumeration.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatReport, validateManifest, type Report } from "../conformance/validate.js";
import {
  CAPABILITIES,
  isKnownCapability,
  manifestOperations,
  operationsFromLegacyRoutes,
} from "../types.js";

const V03 = join(import.meta.dirname, "..", "fixtures", "v0.3");
const LEGACY = join(import.meta.dirname, "..", "fixtures", "legacy");

const load = (dir: string, name: string) =>
  JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;

const errorsOf = (r: Report) => r.findings.filter((f) => f.severity === "error");
const assertOk = (name: string, r: Report) =>
  assert.ok(r.ok, `${name} should be conformant:\n${formatReport(name, r)}`);

// ---------- §1.1 capabilities / §1.2 operations ----------

test("capability-bearing manifests validate cleanly", () => {
  assertOk(
    "manifest-capabilities-single-dataset",
    validateManifest(load(V03, "manifest-capabilities-single-dataset.json")),
  );
  assertOk(
    "manifest-capabilities-multi-operation",
    validateManifest(load(V03, "manifest-capabilities-multi-operation.json")),
  );
});

test("every manifest fixture is covered by a test case", () => {
  const covered = new Set([
    "manifest-single-dataset.json",
    "manifest-with-index.json",
    "manifest-capabilities-single-dataset.json",
    "manifest-capabilities-multi-operation.json",
    "manifest-unknown-capability.json",
    "manifest-rights-default.json",
  ]);
  for (const f of readdirSync(V03).filter((n) => n.startsWith("manifest-"))) {
    assert.ok(covered.has(f), `manifest fixture ${f} has no test case`);
  }
});

test("§1.1+§1.2 are optional: a tier-only manifest stays conformant", () => {
  const m = load(V03, "manifest-single-dataset.json");
  assert.equal(m.capabilities, undefined);
  assert.equal(m.operations, undefined);
  assertOk("tier-only", validateManifest(m));
  assert.deepEqual(manifestOperations(m as never), []);
});

test("§1.2 the multi-operation fixture exercises every pagination model", () => {
  const m = load(V03, "manifest-capabilities-multi-operation.json") as unknown as {
    operations: Array<{ pagination_model?: string }>;
  };
  const seen = new Set(m.operations.map((o) => o.pagination_model));
  for (const model of ["none", "offset", "page", "cursor", "token"]) {
    assert.ok(seen.has(model), `no operation uses pagination_model "${model}"`);
  }
});

test("§1.1 an unknown capability warns and degrades, never errors", () => {
  const r = validateManifest(load(V03, "manifest-unknown-capability.json"));
  assert.ok(r.ok, formatReport("unknown-capability", r));
  assert.ok(
    r.findings.some((f) => f.severity === "warning" && /spectral_alignment/.test(f.message)),
    "expected a degradation warning for the unrecognized capability",
  );
  assert.equal(errorsOf(r).length, 0);
});

test("§1.2 operation_id must be unique within a manifest", () => {
  const m = load(V03, "manifest-capabilities-single-dataset.json");
  const ops = m.operations as unknown[];
  assert.ok(
    errorsOf(validateManifest({ ...m, operations: [...ops, ops[0]] })).some((e) =>
      /duplicate operation_id/.test(e.message),
    ),
  );
});

test("§1.2 an operation referencing an undeclared tier is fatal", () => {
  const m = load(V03, "manifest-capabilities-single-dataset.json");
  const ops = (m.operations as Array<Record<string, unknown>>).map((o) => ({
    ...o,
    tier: "premium",
  }));
  assert.ok(
    errorsOf(validateManifest({ ...m, operations: ops })).some((e) =>
      /is not declared in `tiers`/.test(e.message),
    ),
  );
});

test("§1.2 an unrecognized pagination_model is fatal", () => {
  const m = load(V03, "manifest-capabilities-single-dataset.json");
  const ops = (m.operations as Array<Record<string, unknown>>).slice();
  ops[0] = { ...ops[0], pagination_model: "keyset" };
  assert.ok(
    errorsOf(validateManifest({ ...m, operations: ops })).some((e) =>
      /`pagination_model` must be one of/.test(e.message),
    ),
  );
});

test("§1.2 required operation fields are enforced", () => {
  const m = load(V03, "manifest-capabilities-single-dataset.json");
  const errs = errorsOf(validateManifest({ ...m, operations: [{ path: "/x" }] }));
  assert.ok(errs.some((e) => /`operation_id` is missing/.test(e.message)));
  assert.ok(errs.some((e) => /`capability` is missing/.test(e.message)));
});

test("§1.2 a relative operation path is fatal", () => {
  const m = load(V03, "manifest-capabilities-single-dataset.json");
  const ops = (m.operations as Array<Record<string, unknown>>).slice();
  ops[0] = { ...ops[0], path: "raw" };
  assert.ok(
    errorsOf(validateManifest({ ...m, operations: ops })).some((e) =>
      /must be an absolute path/.test(e.message),
    ),
  );
});

// ---------- §1.3 / §7.2 legacy `routes` migration ----------

test("§7.2 a legacy gateway manifest still validates and warns about `routes`", () => {
  const r = validateManifest(load(LEGACY, "v0.2-gateway-routes-manifest.json"));
  assert.ok(r.ok, formatReport("legacy-gateway-routes", r));
  assert.ok(r.findings.some((f) => f.section === "7.2" && /`routes` is deprecated/.test(f.message)));
});

test("§1.3 legacy `routes` migrate into operations without losing a route", () => {
  const m = load(LEGACY, "v0.2-gateway-routes-manifest.json") as unknown as {
    routes: Array<{ id: string; path: string; tier?: string }>;
  };
  const ops = manifestOperations(m as never);

  assert.equal(ops.length, m.routes.length, "every legacy route must survive migration");
  assert.deepEqual(ops.map((o) => o.operation_id), m.routes.map((r) => r.id));
  assert.deepEqual(ops.map((o) => o.path), m.routes.map((r) => r.path));
  assert.deepEqual(ops.map((o) => o.tier), m.routes.map((r) => r.tier));

  // Search intent is recoverable from the path; everything else is `fetch`.
  const byId = Object.fromEntries(ops.map((o) => [o.operation_id, o.capability]));
  assert.equal(byId["pubmed.fetch"], "fetch");
  assert.equal(byId["pubmed.search"], "search");
  assert.equal(byId["openalex.works.search"], "search");

  // The migrated manifest is itself conformant.
  const migrated: Record<string, unknown> = { ...m, operations: ops };
  delete migrated.routes;
  delete migrated.tier_routes;
  assertOk("migrated-gateway", validateManifest(migrated));
});

test("§1.3 an explicit `operations` list wins over deprecated `routes`", () => {
  const m = load(LEGACY, "v0.2-gateway-routes-manifest.json");
  const explicit = [{ operation_id: "only", capability: "search", path: "/only" }];
  assert.deepEqual(manifestOperations({ ...m, operations: explicit } as never), explicit);
});

test("§1.3 a route with an unrecognized tier stays callable", () => {
  const ops = operationsFromLegacyRoutes([{ id: "x.fetch", path: "/x/fetch", tier: "premium" }]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].path, "/x/fetch");
  assert.equal(ops[0].tier, undefined, "an unknown tier is dropped, the operation is not");
});

test("§1.1 capability vocabulary membership and neutrality", () => {
  assert.ok(isKnownCapability("incremental_sync"));
  assert.ok(isKnownCapability("structured_full_text"));
  assert.ok(!isKnownCapability("spectral_alignment"));
  assert.equal(new Set(CAPABILITIES).size, CAPABILITIES.length, "vocabulary has no duplicates");

  // A capability names what an operation does, never its upstream or domain.
  for (const cap of CAPABILITIES) {
    assert.ok(
      !/pubmed|openalex|crossref|arxiv|orcid|quantum|biolog|chem|physic/i.test(cap),
      `capability "${cap}" leaks a specific upstream or discipline`,
    );
  }
});
