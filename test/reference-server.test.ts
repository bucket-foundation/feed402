/**
 * Drives the reference merchant in-process and validates every response it
 * produces against the conformance rules. If the server drifts from SPEC.md,
 * this fails without anyone remembering to update a fixture.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
import { formatReport, validateEnvelope, validateManifest } from "../conformance/validate.js";
import { SPEC_VERSION } from "../types.js";

const PAID = { "x-payment": "0xdeadbeefcafebabe", "content-type": "application/json" };

async function call(path: string, init?: RequestInit) {
  const res = await app.fetch(new Request(`http://merchant.test${path}`, init));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function paidPost(path: string, body: unknown) {
  return call(path, { method: "POST", headers: PAID, body: JSON.stringify(body) });
}

async function paidGet(path: string) {
  return call(path, { headers: PAID });
}

test("the manifest declares the canonical spec version and validates", async () => {
  const { status, body } = await call("/.well-known/feed402.json");
  assert.equal(status, 200);
  assert.equal(body.spec, SPEC_VERSION);
  const r = validateManifest(body);
  assert.ok(r.ok, formatReport("manifest", r));
});

test("an unpaid request returns a 402 handshake, not an envelope", async () => {
  const { status } = await call("/query", { method: "POST", body: "{}" });
  assert.equal(status, 402);
});

const TIER_CALLS: Array<[string, string, () => Promise<{ status: number; body: Record<string, unknown> }>]> = [
  ["raw single", "raw", () => paidPost("/raw", { limit: 1 })],
  ["raw multi", "raw", () => paidPost("/raw", { limit: 3 })],
  ["query single", "query", () => paidPost("/query", { contains: "mitochondrial" })],
  ["query multi", "query", () => paidPost("/query", {})],
  ["insight", "insight", () => paidPost("/insight", { question: "does caloric restriction extend lifespan?" })],
  ["patents search", "query", () => paidGet("/patents/search?q=mitochondrial")],
  ["patents fetch", "raw", () => paidGet("/patents/11000000")],
  ["patents family", "query", () => paidGet("/patents/family/11000000")],
  ["patents citations", "query", () => paidGet("/patents/citations/11000000?direction=backward")],
  ["patents insight", "insight", () => paidGet("/patents/insight?question=caloric%20restriction")],
];

for (const [label, tier, run] of TIER_CALLS) {
  test(`${label} emits a conformant ${SPEC_VERSION} envelope`, async () => {
    const { status, body } = await run();
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(Array.isArray(body.citation), "citation must be an array");
    const r = validateEnvelope(body, { tier });
    assert.ok(r.ok, formatReport(label, r));
  });
}

test("multi-record tiers ground every result, not just the first", async () => {
  const { body } = await paidPost("/raw", { limit: 3 });
  const rows = (body.data as { rows: unknown[] }).rows;
  assert.ok(rows.length > 1, "fixture corpus should return several rows");
  assert.equal((body.citation as unknown[]).length, rows.length);
});

test("the patents search tier binds deduplicated citations explicitly", async () => {
  const { body } = await paidGet("/patents/search?q=mitochondrial");
  const rows = (body.data as { rows: unknown[] }).rows;
  const cits = body.citation as Array<{ result_index?: number[] }>;
  const covered = new Set(cits.flatMap((c) => c.result_index ?? []));
  assert.equal(covered.size, rows.length, "every result is named by some citation");
});

test("insight retrieval provenance is present and rank-ordered", async () => {
  const { body } = await paidPost("/insight", { question: "does caloric restriction extend lifespan?" });
  const cits = body.citation as Array<{ retrieval?: { rank: number; model: string } }>;
  assert.ok(cits.length >= 1);
  cits.forEach((c, i) => {
    assert.ok(c.retrieval, "insight citations carry §3.2 provenance");
    assert.equal(c.retrieval!.rank, i);
  });
});

/**
 * Build a minimal request body satisfying an operation's advertised
 * `input_schema`. Only the required properties are filled, so the call
 * exercises the contract the merchant published rather than a payload the
 * test author happened to know worked.
 */
function payloadFor(op: Record<string, unknown>): Record<string, unknown> {
  const schema = op.input_schema as
    | { required?: string[]; properties?: Record<string, { type?: string }> }
    | undefined;
  const body: Record<string, unknown> = {};
  if (!schema?.properties) return body;

  const required = schema.required ?? [];
  for (const name of required) {
    const type = schema.properties[name]?.type;
    body[name] = type === "integer" || type === "number" ? 1 : "photosynthesis";
  }
  // A schema with no required fields still needs something to select rows.
  if (required.length === 0 && schema.properties.limit) body.limit = 1;
  return body;
}

test("§1.2 every advertised operation is callable at the path it advertises", async () => {
  const { body } = await call("/.well-known/feed402.json");
  const ops = body.operations as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(ops) && ops.length > 0, "the reference merchant must advertise operations");

  const tiers = body.tiers as Record<string, { path: string }>;
  for (const op of ops) {
    // The tier reference must resolve, otherwise an agent cannot price the call.
    assert.ok(tiers[op.tier as string], `operation ${op.operation_id} names an undeclared tier`);

    // Drive the call from the operation's own advertised input_schema. If the
    // schema disagrees with what the handler accepts, this fails — which is
    // the drift this test exists to catch, alongside an unrouted path.
    const { status } = await paidPost(op.path as string, payloadFor(op));
    assert.notEqual(status, 404, `advertised path ${op.path} is not routed`);
    assert.equal(status, 200, `advertised path ${op.path} did not return an envelope`);
  }
});

test("§1.1 advertised capabilities cover every operation's capability", async () => {
  const { body } = await call("/.well-known/feed402.json");
  const declared = body.capabilities as string[];
  const ops = body.operations as Array<{ capability: string }>;
  for (const op of ops) {
    assert.ok(
      declared.includes(op.capability),
      `capability "${op.capability}" is used by an operation but not advertised`,
    );
  }
});

test("no envelope leaks the payment header or any secret-looking value", async () => {
  for (const [, , run] of TIER_CALLS) {
    const { body } = await run();
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("0xdeadbeefcafebabe"), "raw payment header must not appear in the envelope");
    assert.ok(!/x-payment/i.test(serialized), "header names must not appear in the envelope");
  }
});
