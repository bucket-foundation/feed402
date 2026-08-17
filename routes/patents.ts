/**
 * feed402 — /patents/* routes (bkt-zx6)
 *
 * Six endpoints across three tiers:
 *   GET /patents/search?q&class&from&to&jurisdiction&lat&lng&radius&limit  → query  $0.005
 *   GET /patents/{id}                                                      → raw    $0.010
 *   GET /patents/by-coord?lat&lng&radius&from&to&class                     → query  $0.005
 *   GET /patents/family/{id}                                               → query  $0.005
 *   GET /patents/citations/{id}?direction=forward|backward                 → query  $0.005
 *   GET /patents/insight?question                                          → insight $0.002
 *
 * Schema source of truth: /home/gian/agfarms/bucket-foundation/data/patents/uspto/schema/uspto.sql
 * Licensing: /home/gian/agfarms/bucket-foundation/docs/PATENT_LICENSING.md
 *
 * v1 corpus: USPTO + Google Patents BigQuery (CC-BY 4.0) + EPO OPS bibliographic.
 * WIPO content is allowed only on the insight tier (derivative-license clause).
 *
 * The DB layer is abstracted behind `PatentsRepo` so the mock can be swapped
 * for real Postgres in bkt-5qg's load step. This module exports `mountPatents`
 * which attaches routes to a Hono app and accepts an injectable repo + a
 * payment guard provided by server.ts.
 */
import type { Hono, Context } from "hono";
import type {
  Citation,
  CitationSource,
  Envelope,
  ErrorBody,
  TierName,
} from "../types.js";

// ---------- Domain types (mirror uspto.sql) ----------

export type Jurisdiction = "US" | "EP" | "WO" | "JP" | "KR" | "CN" | string;

export interface PatentGrant {
  patent_id: string;            // uspto_grant.patent_id
  patent_kind: string | null;
  patent_type: string | null;   // utility | design | plant | reissue
  patent_title: string | null;
  patent_abstract: string | null;
  application_id: string | null;
  filing_date: string | null;   // ISO date
  grant_date: string | null;
  publication_date: string | null;
  priority_date: string | null;
  num_claims: number | null;
  num_figures: number | null;
  cpc_codes: string[];
  ipc_codes: string[];
  examiner_name: string | null;
  art_unit: string | null;
  jurisdiction: Jurisdiction;   // synthesized: "US" for uspto_grant rows
}

export interface PatentClaim {
  patent_id: string;
  claim_number: number;
  claim_text: string;
  is_independent: boolean | null;
  parent_claim_number: number | null;
}

export interface PatentCitation {
  citing_patent_id: string;
  cited_patent_id: string;
  cited_country: string | null;
  cited_kind: string | null;
  citation_category: string | null;  // examiner | applicant | other
  citation_sequence: number | null;
}

export interface PatentLocation {
  location_id: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Bundled raw response — full grant + claims + citations in one envelope. */
export interface PatentRawBundle {
  grant: PatentGrant;
  claims: PatentClaim[];
  citations_backward: PatentCitation[];
  inventors: Array<{ inventor_id: string; name_first: string | null; name_last: string | null; location_id: string | null }>;
  assignees: Array<{ assignee_id: string; organization: string | null; assignee_type: string | null; location_id: string | null }>;
  locations: PatentLocation[];
}

export interface SearchFilters {
  q?: string;
  class?: string;            // CPC or IPC prefix, e.g. "A61K"
  from?: string;             // ISO date — grant_date >=
  to?: string;               // ISO date — grant_date <=
  jurisdiction?: Jurisdiction;
  lat?: number;
  lng?: number;
  radius?: number;           // km
  limit?: number;
}

export interface CoordFilters {
  lat: number;
  lng: number;
  radius: number;            // km
  from?: string;
  to?: string;
  class?: string;
}

export type CitationDirection = "forward" | "backward";

// ---------- Repo interface (swappable mock → Postgres) ----------

export interface PatentsRepo {
  search(filters: SearchFilters): Promise<PatentGrant[]>;
  getById(patentId: string): Promise<PatentRawBundle | null>;
  byCoord(filters: CoordFilters): Promise<PatentGrant[]>;
  /** Returns the INPADOC-style family of equivalents across jurisdictions. */
  family(patentId: string): Promise<PatentGrant[]>;
  /** direction=forward → patents that cite `patentId`. backward → patents `patentId` cites. */
  citations(patentId: string, direction: CitationDirection): Promise<PatentCitation[]>;
  /** Insight backing — return up to k relevant grants for a free-form question. */
  insightSearch(question: string, k: number): Promise<Array<{ grant: PatentGrant; score: number }>>;
  /** Resolve a canonical_url back to its grant (powers /citation lookups). */
  getByCanonicalUrl(canonicalUrl: string): Promise<PatentGrant | null>;
}

// ---------- Mock impl (so demo.sh works without Postgres) ----------

const MOCK_GRANT_A: PatentGrant = {
  patent_id: "11000000",
  patent_kind: "B2",
  patent_type: "utility",
  patent_title: "Method for caloric-restriction-mimetic small molecule delivery",
  patent_abstract:
    "A pharmaceutical composition and method for delivering caloric-restriction-mimetic compounds to mammalian subjects via a controlled-release matrix...",
  application_id: "16/123456",
  filing_date: "2019-03-04",
  grant_date: "2021-05-11",
  publication_date: "2020-09-10",
  priority_date: "2018-03-04",
  num_claims: 22,
  num_figures: 7,
  cpc_codes: ["A61K9/0019", "A61P3/00"],
  ipc_codes: ["A61K9/00"],
  examiner_name: "Doe, Jane",
  art_unit: "1611",
  jurisdiction: "US",
};

const MOCK_GRANT_B: PatentGrant = {
  patent_id: "10987654",
  patent_kind: "B1",
  patent_type: "utility",
  patent_title: "Wearable mitochondrial uncoupling stimulator",
  patent_abstract:
    "A wearable device delivering localized cold exposure to brown adipose tissue depots to stimulate UCP1-mediated thermogenesis...",
  application_id: "16/098765",
  filing_date: "2018-11-02",
  grant_date: "2021-01-19",
  publication_date: "2020-05-21",
  priority_date: "2017-11-02",
  num_claims: 18,
  num_figures: 12,
  cpc_codes: ["A61F7/00", "A61N1/40"],
  ipc_codes: ["A61F7/00"],
  examiner_name: "Smith, John",
  art_unit: "3771",
  jurisdiction: "US",
};

export class MockPatentsRepo implements PatentsRepo {
  private grants: PatentGrant[] = [MOCK_GRANT_A, MOCK_GRANT_B];

  async search(f: SearchFilters): Promise<PatentGrant[]> {
    let rows = this.grants.slice();
    if (f.q) {
      const q = f.q.toLowerCase();
      rows = rows.filter(
        (g) =>
          (g.patent_title ?? "").toLowerCase().includes(q) ||
          (g.patent_abstract ?? "").toLowerCase().includes(q),
      );
    }
    if (f.class) rows = rows.filter((g) => g.cpc_codes.some((c) => c.startsWith(f.class!)) || g.ipc_codes.some((c) => c.startsWith(f.class!)));
    if (f.from) rows = rows.filter((g) => (g.grant_date ?? "") >= f.from!);
    if (f.to) rows = rows.filter((g) => (g.grant_date ?? "") <= f.to!);
    if (f.jurisdiction) rows = rows.filter((g) => g.jurisdiction === f.jurisdiction);
    return rows.slice(0, f.limit ?? 25);
  }

  async getById(patentId: string): Promise<PatentRawBundle | null> {
    const grant = this.grants.find((g) => g.patent_id === patentId);
    if (!grant) return null;
    return {
      grant,
      claims: [
        {
          patent_id: grant.patent_id,
          claim_number: 1,
          claim_text:
            "1. A pharmaceutical composition comprising: a caloric-restriction-mimetic compound; and a controlled-release matrix...",
          is_independent: true,
          parent_claim_number: null,
        },
        {
          patent_id: grant.patent_id,
          claim_number: 2,
          claim_text: "2. The composition of claim 1, wherein the compound is rapamycin or an analog thereof.",
          is_independent: false,
          parent_claim_number: 1,
        },
      ],
      citations_backward: [
        {
          citing_patent_id: grant.patent_id,
          cited_patent_id: "9000000",
          cited_country: "US",
          cited_kind: "B2",
          citation_category: "examiner",
          citation_sequence: 1,
        },
      ],
      inventors: [
        { inventor_id: "inv-1", name_first: "Ada", name_last: "Lovelace", location_id: "loc-cambridge" },
      ],
      assignees: [
        { assignee_id: "asg-1", organization: "Mock Therapeutics Inc.", assignee_type: "US_company", location_id: "loc-cambridge" },
      ],
      locations: [
        {
          location_id: "loc-cambridge",
          city: "Cambridge",
          state: "US-MA",
          country: "US",
          latitude: 42.3736,
          longitude: -71.1097,
        },
      ],
    };
  }

  async byCoord(f: CoordFilters): Promise<PatentGrant[]> {
    // Mock: ignore actual geom math, return both grants if radius > 0.
    return f.radius > 0 ? this.grants.slice() : [];
  }

  async family(_patentId: string): Promise<PatentGrant[]> {
    // Mock: family of one (the patent itself + a fake EP equivalent).
    return [
      MOCK_GRANT_A,
      { ...MOCK_GRANT_A, patent_id: "EP3500000", jurisdiction: "EP" },
    ];
  }

  async citations(patentId: string, direction: CitationDirection): Promise<PatentCitation[]> {
    if (direction === "backward") {
      return [
        {
          citing_patent_id: patentId,
          cited_patent_id: "9000000",
          cited_country: "US",
          cited_kind: "B2",
          citation_category: "examiner",
          citation_sequence: 1,
        },
      ];
    }
    return [
      {
        citing_patent_id: "11500000",
        cited_patent_id: patentId,
        cited_country: "US",
        cited_kind: "B2",
        citation_category: "applicant",
        citation_sequence: 1,
      },
    ];
  }

  async insightSearch(question: string, k: number): Promise<Array<{ grant: PatentGrant; score: number }>> {
    const q = question.toLowerCase();
    return this.grants
      .map((g) => {
        const hay = `${g.patent_title ?? ""} ${g.patent_abstract ?? ""}`.toLowerCase();
        let score = 0;
        for (const tok of q.split(/\s+/).filter((t) => t.length > 3)) if (hay.includes(tok)) score += 0.2;
        return { grant: g, score: Math.min(1, score) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async getByCanonicalUrl(url: string): Promise<PatentGrant | null> {
    return this.grants.find((g) => canonicalUrl(g) === url) ?? null;
  }
}

// ---------- Mount helper ----------

const PROVIDER_NAME = "feed402-patents";

/** USPTO/Espacenet/Google Patents canonical URL by jurisdiction. */
function canonicalUrl(g: PatentGrant): string {
  switch (g.jurisdiction) {
    case "US":
      return `https://patents.google.com/patent/US${g.patent_id}`;
    case "EP":
      return `https://worldwide.espacenet.com/patent/search/publication/?q=${encodeURIComponent(g.patent_id)}`;
    case "WO":
      return `https://patentscope.wipo.int/search/en/detail.jsf?docId=${g.patent_id}`;
    default:
      return `https://patents.google.com/patent/${g.jurisdiction}${g.patent_id}`;
  }
}

/** §3 source citation for a grant. License differs by jurisdiction. */
function patentCitation(g: PatentGrant, retrieved_at: string): CitationSource {
  // Per docs/PATENT_LICENSING.md:
  //   US/PatentsView    → CC-BY-4.0
  //   Google Patents BQ → CC-BY-4.0
  //   EPO OPS bibliog.  → fair-use citation-only
  //   WIPO              → citation-only on raw/query, derivative on insight
  let license = "CC-BY-4.0";
  if (g.jurisdiction === "EP") license = "EPO-OPS-fair-use";
  else if (g.jurisdiction === "WO") license = "citation-only";
  else if (g.jurisdiction !== "US") license = "citation-only";
  return {
    type: "source",
    source_id: `patent:${g.jurisdiction}${g.patent_id}`,
    provider: PROVIDER_NAME,
    retrieved_at,
    license,
    canonical_url: canonicalUrl(g),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function traceId(): string {
  return `tr_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/** Payment guard contract — server.ts injects a function matching this shape. */
export type PaymentGuard = (
  c: Context,
  tier: TierName,
) => { ok: true; tx: string } | { ok: false; respond: () => Response | Promise<Response> };

export interface MountPatentsOpts {
  repo: PatentsRepo;
  guard: PaymentGuard;
  makeReceipt?: (tier: TierName, tx: string) => Envelope["receipt"];
}

/** Per-bead pricing from bkt-zx6 (raw $0.010 / query $0.005 / insight $0.002). */
export const PATENTS_TIER_PRICES: Record<TierName, number> = {
  raw: 0.010,
  query: 0.005,
  insight: 0.002,
};

function defaultMakeReceipt(tier: TierName, tx: string): Envelope["receipt"] {
  return {
    tier,
    price_usd: PATENTS_TIER_PRICES[tier],
    tx,
    paid_at: new Date().toISOString(),
  };
}

export function mountPatents(app: Hono, opts: MountPatentsOpts): void {
  const { repo, guard } = opts;
  const makeReceipt = opts.makeReceipt ?? defaultMakeReceipt;

  // GET /patents/search — query tier
  app.get("/patents/search", async (c) => {
    const g = guard(c, "query");
    if (!g.ok) return g.respond();
    const u = c.req.query();
    const filters: SearchFilters = {
      q: u.q,
      class: u.class,
      from: u.from,
      to: u.to,
      jurisdiction: u.jurisdiction as Jurisdiction | undefined,
      lat: u.lat ? Number(u.lat) : undefined,
      lng: u.lng ? Number(u.lng) : undefined,
      radius: u.radius ? Number(u.radius) : undefined,
      limit: u.limit ? Number(u.limit) : undefined,
    };
    const rows = await repo.search(filters);
    if (rows.length === 0) {
      return c.json<ErrorBody>(
        { error: { code: "citation_unavailable", message: "no patents matched" }, trace_id: traceId() },
        404,
      );
    }
    const retrieved_at = nowIso();
    // SPEC §3 (v0.3): envelope.citation is an array. Dedupe by canonical_url.
    const citations: Citation[] = dedupeCitations(rows.map((r) => patentCitation(r, retrieved_at)));
    const env: Envelope = {
      data: { rows, count: rows.length },
      citation: citations,
      receipt: makeReceipt("query", g.tx),
    };
    return c.json(env, 200);
  });

  // GET /patents/by-coord — query tier
  app.get("/patents/by-coord", async (c) => {
    const g = guard(c, "query");
    if (!g.ok) return g.respond();
    const u = c.req.query();
    if (!u.lat || !u.lng || !u.radius) {
      return c.json<ErrorBody>(
        { error: { code: "invalid_input", message: "lat, lng, radius required" }, trace_id: traceId() },
        400,
      );
    }
    const rows = await repo.byCoord({
      lat: Number(u.lat),
      lng: Number(u.lng),
      radius: Number(u.radius),
      from: u.from,
      to: u.to,
      class: u.class,
    });
    if (rows.length === 0) {
      return c.json<ErrorBody>(
        { error: { code: "citation_unavailable", message: "no patents in radius" }, trace_id: traceId() },
        404,
      );
    }
    const retrieved_at = nowIso();
    const citations = dedupeCitations(rows.map((r) => patentCitation(r, retrieved_at)));
    const env: Envelope = {
      data: { rows, count: rows.length },
      citation: citations,
      receipt: makeReceipt("query", g.tx),
    };
    return c.json(env, 200);
  });

  // GET /patents/family/:id — query tier
  app.get("/patents/family/:id", async (c) => {
    const g = guard(c, "query");
    if (!g.ok) return g.respond();
    const id = c.req.param("id");
    const fam = await repo.family(id);
    if (fam.length === 0) {
      return c.json<ErrorBody>(
        { error: { code: "citation_unavailable", message: "no family found" }, trace_id: traceId() },
        404,
      );
    }
    const retrieved_at = nowIso();
    const citations = dedupeCitations(fam.map((r) => patentCitation(r, retrieved_at)));
    const env: Envelope = {
      // SPEC §3.3 `resultList()` recognizes `data.rows` (or `data.top_k`, or
      // a top-level array) as the multi-record shape; a bespoke `family` key
      // was silently read as single-record, which is why this envelope's 2
      // citations tripped the "single-record must return exactly 1" check.
      data: { rows: fam, count: fam.length },
      citation: citations,
      receipt: makeReceipt("query", g.tx),
    };
    return c.json(env, 200);
  });

  // GET /patents/citations/:id?direction=forward|backward — query tier
  app.get("/patents/citations/:id", async (c) => {
    const g = guard(c, "query");
    if (!g.ok) return g.respond();
    const id = c.req.param("id");
    const dirRaw = c.req.query("direction") ?? "backward";
    if (dirRaw !== "forward" && dirRaw !== "backward") {
      return c.json<ErrorBody>(
        { error: { code: "invalid_input", message: "direction must be 'forward' or 'backward'" }, trace_id: traceId() },
        400,
      );
    }
    const direction: CitationDirection = dirRaw;
    const rows = await repo.citations(id, direction);
    const retrieved_at = nowIso();
    // Cite the anchor patent itself so the envelope has at least one valid citation.
    const anchor = await repo.getById(id);
    const citation: CitationSource = anchor
      ? patentCitation(anchor.grant, retrieved_at)
      : {
          type: "source",
          source_id: `patent:US${id}`,
          provider: PROVIDER_NAME,
          retrieved_at,
          license: "CC-BY-4.0",
          canonical_url: `https://patents.google.com/patent/US${id}`,
        };
    const env: Envelope = {
      data: { anchor: id, direction, edges: rows, count: rows.length },
      citation: [citation],
      receipt: makeReceipt("query", g.tx),
    };
    return c.json(env, 200);
  });

  // GET /patents/insight?question=... — insight tier
  // Registered BEFORE the /patents/:id catch-all below: Hono matches route
  // patterns in registration order, so a literal path segment must come
  // before a `:param` wildcard that would otherwise swallow it (bug found
  // in review: "insight" was being routed to /patents/:id as id="insight",
  // producing a spurious "patent insight not found" 404).
  app.get("/patents/insight", async (c) => {
    const g = guard(c, "insight");
    if (!g.ok) return g.respond();
    const question = c.req.query("question");
    if (!question) {
      return c.json<ErrorBody>(
        { error: { code: "invalid_input", message: "question required" }, trace_id: traceId() },
        400,
      );
    }
    const hits = await repo.insightSearch(question, 5);
    if (hits.length === 0) {
      return c.json<ErrorBody>(
        { error: { code: "citation_unavailable", message: "no relevant patents" }, trace_id: traceId() },
        404,
      );
    }
    const top = hits[0];
    const retrieved_at = nowIso();
    // SPEC §3.3: one citation per hit, ordinally aligned with `data.top_k`.
    const citations: CitationSource[] = hits.map((h, i) => ({
      ...patentCitation(h.grant, retrieved_at),
      chunk_id: `patent:${h.grant.jurisdiction}${h.grant.patent_id}#c0`,
      retrieval: { model: "mock-substring-v0", score: h.score, rank: i },
    }));
    const summary = `Top match: ${top.grant.patent_title} (${top.grant.jurisdiction}${top.grant.patent_id}, granted ${top.grant.grant_date}). ${(top.grant.patent_abstract ?? "").slice(0, 200)}...`;
    const env: Envelope = {
      data: {
        question,
        summary,
        top_source: `patent:${top.grant.jurisdiction}${top.grant.patent_id}`,
        top_k: hits.map((h, i) => ({
          source_id: `patent:${h.grant.jurisdiction}${h.grant.patent_id}`,
          patent_id: h.grant.patent_id,
          title: h.grant.patent_title,
          jurisdiction: h.grant.jurisdiction,
          score: h.score,
          rank: i,
          canonical_url: canonicalUrl(h.grant),
        })),
        // Deprecated since feed402/0.3 (SPEC §7.2): duplicate of `top_k`,
        // kept for 0.2 consumers. Sunset at feed402/0.5.
        hits: hits.map((h, i) => ({
          source_id: `patent:${h.grant.jurisdiction}${h.grant.patent_id}`,
          patent_id: h.grant.patent_id,
          title: h.grant.patent_title,
          jurisdiction: h.grant.jurisdiction,
          score: h.score,
          rank: i,
          canonical_url: canonicalUrl(h.grant),
        })),
      },
      citation: citations,
      receipt: makeReceipt("insight", g.tx),
    };
    return c.json(env, 200);
  });

  // GET /patents/:id — raw tier (full bundle)
  // Registered AFTER every literal /patents/* route above so Hono's routing
  // picks those first; this `:id` wildcard is the fallback.
  app.get("/patents/:id", async (c) => {
    const g = guard(c, "raw");
    if (!g.ok) return g.respond();
    const id = c.req.param("id");
    const bundle = await repo.getById(id);
    if (!bundle) {
      return c.json<ErrorBody>(
        { error: { code: "citation_unavailable", message: `patent ${id} not found` }, trace_id: traceId() },
        404,
      );
    }
    const env: Envelope = {
      data: bundle,
      citation: [patentCitation(bundle.grant, nowIso())],
      receipt: makeReceipt("raw", g.tx),
    };
    return c.json(env, 200);
  });

  // GET /citation?canonical_url=... — query tier (bkt-2yr)
  // Returns the SPEC §3 citation envelope for any canonical_url present in the corpus.
  app.get("/citation", async (c) => {
    const g = guard(c, "query");
    if (!g.ok) return g.respond();
    const url = c.req.query("canonical_url");
    if (!url) {
      return c.json<ErrorBody>(
        { error: { code: "invalid_input", message: "canonical_url required" }, trace_id: traceId() },
        400,
      );
    }
    const grant = await repo.getByCanonicalUrl(url);
    if (!grant) {
      return c.json<ErrorBody>(
        { error: { code: "citation_unavailable", message: `no patent for url ${url}` }, trace_id: traceId() },
        404,
      );
    }
    const env: Envelope = {
      data: { canonical_url: url, resolved: true },
      citation: [patentCitation(grant, nowIso())],
      receipt: makeReceipt("query", g.tx),
    };
    return c.json(env, 200);
  });
}

/** Dedupe citations by canonical_url (keep first occurrence). */
/**
 * SPEC §3.3 rule 5: merge citations that share a dedup key, where the key is
 * `chunk_id` when present and `source_id` otherwise. `canonical_url` is a
 * locator, so two distinct grants that resolve to the same landing page stay
 * separate citations.
 *
 * §3.3 rule 4: a deduplicated array binds explicitly, so every surviving
 * citation carries `result_index` naming the results it grounds.
 */
function dedupeCitations(cs: Citation[]): Citation[] {
  const byKey = new Map<string, Citation & { result_index: number[] }>();
  const out: Array<Citation & { result_index: number[] }> = [];
  cs.forEach((c, i) => {
    const src = c as { chunk_id?: string; source_id?: string };
    const key = src.chunk_id ?? src.source_id ?? JSON.stringify(c);
    const existing = byKey.get(key);
    if (existing) {
      existing.result_index.push(i);
      return;
    }
    const entry = { ...c, result_index: [i] } as Citation & { result_index: number[] };
    byKey.set(key, entry);
    out.push(entry);
  });
  return out;
}
