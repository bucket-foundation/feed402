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

test("no envelope leaks the payment header or any secret-looking value", async () => {
  for (const [, , run] of TIER_CALLS) {
    const { body } = await run();
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("0xdeadbeefcafebabe"), "raw payment header must not appear in the envelope");
    assert.ok(!/x-payment/i.test(serialized), "header names must not appear in the envelope");
  }
});
