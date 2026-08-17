/**
 * feed402 conformance validator.
 *
 * Pure functions over parsed JSON. No network, no filesystem — the CLI in
 * `conformance/cli.ts` supplies the bytes. Every rule cites the SPEC.md
 * section it enforces so a failure points at the normative text.
 */

import {
  KNOWN_SPEC_VERSIONS,
  RIGHTS_FACETS,
  SPEC_VERSION,
  isKnownCapability,
  type Citation,
  type Envelope,
  type LegacyEnvelope,
} from "../types.js";

/** §1.2 pagination models defined by this revision. */
const PAGINATION_MODELS = ["none", "offset", "page", "cursor", "token"];

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  /** SPEC.md section this rule comes from, e.g. "3.3". */
  section: string;
  /** JSON pointer-ish path into the document. */
  path: string;
  message: string;
}

export interface Report {
  ok: boolean;
  /** Protocol version the document was validated against. */
  version: string;
  findings: Finding[];
}

const ISO_8601 =
  /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function err(section: string, path: string, message: string): Finding {
  return { severity: "error", section, path, message };
}

function warn(section: string, path: string, message: string): Finding {
  return { severity: "warning", section, path, message };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Compare two `feed402/X.Y` strings. Returns <0, 0, >0. */
export function compareSpecVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [maj, min] = v.replace(/^feed402\//, "").split(".").map(Number);
    return [maj || 0, min || 0];
  };
  const [am, an] = parse(a);
  const [bm, bn] = parse(b);
  return am !== bm ? am - bm : an - bn;
}

/** True when `version` predates the 0.3 citation-array break. */
export function isLegacyVersion(version: string): boolean {
  return compareSpecVersions(version, "feed402/0.3") < 0;
}

// ---------- §1 manifest ----------

export function validateManifest(doc: unknown): Report {
  const f: Finding[] = [];
  let version = SPEC_VERSION as string;

  if (!isObject(doc)) {
    return {
      ok: false,
      version,
      findings: [err("1", "$", "manifest must be a JSON object")],
    };
  }

  for (const key of ["name", "version", "spec", "chain", "wallet"]) {
    if (typeof doc[key] !== "string") {
      f.push(err("1", `$.${key}`, `required string field \`${key}\` is missing`));
    }
  }

  if (typeof doc.spec === "string") {
    version = doc.spec;
    if (!doc.spec.startsWith("feed402/")) {
      f.push(err("1", "$.spec", `\`spec\` must start with "feed402/", got "${doc.spec}"`));
    } else if (!(KNOWN_SPEC_VERSIONS as readonly string[]).includes(doc.spec)) {
      f.push(
        warn("2.3", "$.spec", `unknown protocol version "${doc.spec}"; validating as ${SPEC_VERSION}`),
      );
    }
  }

  if (typeof doc.wallet === "string" && !/^0x[0-9a-fA-F]{40}$/.test(doc.wallet)) {
    f.push(err("1", "$.wallet", "`wallet` must be a 0x-prefixed 20-byte address"));
  }

  if (!isObject(doc.tiers)) {
    f.push(err("1", "$.tiers", "`tiers` is required and must be an object"));
  } else {
    const names = Object.keys(doc.tiers);
    if (names.length === 0) {
      f.push(err("1", "$.tiers", "`tiers` must declare at least one tier"));
    }
    for (const name of names) {
      if (!["raw", "query", "insight"].includes(name)) {
        f.push(warn("5", `$.tiers.${name}`, `unknown tier name "${name}"`));
      }
      const spec = (doc.tiers as Record<string, unknown>)[name];
      if (!isObject(spec)) {
        f.push(err("1", `$.tiers.${name}`, "tier spec must be an object"));
        continue;
      }
      if (typeof spec.path !== "string") {
        f.push(err("1", `$.tiers.${name}.path`, "tier `path` must be a string"));
      }
      if (typeof spec.price_usd !== "number" || spec.price_usd < 0) {
        f.push(err("1", `$.tiers.${name}.price_usd`, "tier `price_usd` must be a non-negative number"));
      }
      if (spec.unit !== "row" && spec.unit !== "call") {
        f.push(err("1", `$.tiers.${name}.unit`, '`unit` must be "row" or "call"'));
      }
    }
  }

  if (doc.citation_types !== undefined && !Array.isArray(doc.citation_types)) {
    f.push(err("1", "$.citation_types", "`citation_types` must be an array when present"));
  }

  if (doc.index !== undefined) f.push(...validateIndexManifest(doc.index));
  if (doc.rights !== undefined) f.push(...validateRights(doc.rights, "$.rights"));

  f.push(...validateCapabilities(doc));
  f.push(...validateOperations(doc));

  return { ok: !f.some((x) => x.severity === "error"), version, findings: f };
}

// ---------- §1.1 capabilities ----------

function validateCapabilities(doc: Record<string, unknown>): Finding[] {
  const f: Finding[] = [];
  if (doc.capabilities === undefined) return f;
  if (!Array.isArray(doc.capabilities)) {
    return [err("1.1", "$.capabilities", "`capabilities` must be an array when present")];
  }
  doc.capabilities.forEach((cap, i) => {
    if (typeof cap !== "string" || cap.length === 0) {
      f.push(err("1.1", `$.capabilities[${i}]`, "capability must be a non-empty string"));
      return;
    }
    // Open extension point: an unrecognized name degrades, never errors.
    if (!isKnownCapability(cap)) {
      f.push(
        warn(
          "1.1",
          `$.capabilities[${i}]`,
          `capability "${cap}" is not in the v0.3 vocabulary; treat as an operation the agent cannot drive`,
        ),
      );
    }
  });
  return f;
}

// ---------- §1.2 operations ----------

function validateOperations(doc: Record<string, unknown>): Finding[] {
  const f: Finding[] = [];
  if (doc.operations === undefined) {
    // A merchant may still be emitting the pre-0.3 gateway enumeration.
    if (Array.isArray(doc.routes) && doc.routes.length > 0) {
      f.push(
        warn(
          "7.2",
          "$.routes",
          "`routes` is deprecated; emit `operations` instead (consumers should read it via manifestOperations())",
        ),
      );
    }
    return f;
  }
  if (!Array.isArray(doc.operations)) {
    return [err("1.2", "$.operations", "`operations` must be an array when present")];
  }

  const tierNames = isObject(doc.tiers) ? Object.keys(doc.tiers) : [];
  const declared = Array.isArray(doc.capabilities)
    ? doc.capabilities.filter((c): c is string => typeof c === "string")
    : null;
  const seenIds = new Set<string>();
  const seenCaps = new Set<string>();

  doc.operations.forEach((raw, i) => {
    const at = `$.operations[${i}]`;
    if (!isObject(raw)) {
      f.push(err("1.2", at, "operation must be an object"));
      return;
    }

    for (const key of ["operation_id", "capability", "path"]) {
      if (typeof raw[key] !== "string" || (raw[key] as string).length === 0) {
        f.push(err("1.2", `${at}.${key}`, `required string field \`${key}\` is missing`));
      }
    }

    if (typeof raw.operation_id === "string") {
      if (seenIds.has(raw.operation_id)) {
        f.push(err("1.2", `${at}.operation_id`, `duplicate operation_id "${raw.operation_id}"`));
      }
      seenIds.add(raw.operation_id);
    }

    if (typeof raw.capability === "string") {
      seenCaps.add(raw.capability);
      if (!isKnownCapability(raw.capability)) {
        f.push(
          warn("1.1", `${at}.capability`, `capability "${raw.capability}" is not in the v0.3 vocabulary`),
        );
      }
    }

    if (typeof raw.path === "string" && !raw.path.startsWith("/")) {
      f.push(err("1.2", `${at}.path`, "`path` must be an absolute path beginning with \"/\""));
    }

    // `tier` is a reference into the pricing view; a dangling one leaves an
    // agent unable to price the call.
    if (raw.tier !== undefined) {
      if (typeof raw.tier !== "string") {
        f.push(err("1.2", `${at}.tier`, "`tier` must be a string when present"));
      } else if (tierNames.length > 0 && !tierNames.includes(raw.tier)) {
        f.push(err("1.2", `${at}.tier`, `\`tier\` "${raw.tier}" is not declared in \`tiers\``));
      }
    }

    if (
      raw.pagination_model !== undefined &&
      !PAGINATION_MODELS.includes(raw.pagination_model as string)
    ) {
      f.push(
        err(
          "1.2",
          `${at}.pagination_model`,
          `\`pagination_model\` must be one of ${PAGINATION_MODELS.join(", ")}`,
        ),
      );
    }

    if (raw.identifier_schemes !== undefined && !Array.isArray(raw.identifier_schemes)) {
      f.push(err("1.2", `${at}.identifier_schemes`, "`identifier_schemes` must be an array"));
    }

    // A canonical identifier that is not among the accepted schemes gives an
    // agent no way to produce it.
    if (typeof raw.canonical_identifier === "string" && Array.isArray(raw.identifier_schemes)) {
      if (!raw.identifier_schemes.includes(raw.canonical_identifier)) {
        f.push(
          warn(
            "1.2",
            `${at}.canonical_identifier`,
            `"${raw.canonical_identifier}" is not listed in \`identifier_schemes\``,
          ),
        );
      }
    }

    if (raw.content_types !== undefined && !Array.isArray(raw.content_types)) {
      f.push(err("1.2", `${at}.content_types`, "`content_types` must be an array"));
    }
  });

  // §1.1: the summary should not under-report what operations actually offer.
  if (declared) {
    for (const cap of seenCaps) {
      if (!declared.includes(cap)) {
        f.push(
          warn(
            "1.1",
            "$.capabilities",
            `operations declare capability "${cap}" which is absent from \`capabilities\`; \`operations\` is authoritative`,
          ),
        );
      }
    }
  }

  return f;
}

function validateIndexManifest(idx: unknown): Finding[] {
  const f: Finding[] = [];
  if (!isObject(idx)) return [err("4.1", "$.index", "`index` must be an object")];
  for (const key of ["type", "model", "corpus_sha256", "built_at"]) {
    if (typeof idx[key] !== "string") {
      f.push(err("4.1", `$.index.${key}`, `\`${key}\` is required and must be a string`));
    }
  }
  if (typeof idx.chunks !== "number") {
    f.push(err("4.1", "$.index.chunks", "`chunks` is required and must be a number"));
  }
  if (!isObject(idx.chunk_strategy)) {
    f.push(err("4.1", "$.index.chunk_strategy", "`chunk_strategy` is required and must be an object"));
  } else if (idx.chunk_strategy.kind === "token-window") {
    for (const key of ["size", "overlap"]) {
      if (typeof idx.chunk_strategy[key] !== "number") {
        f.push(
          err("4.1", `$.index.chunk_strategy.${key}`, `\`${key}\` is required when kind is "token-window"`),
        );
      }
    }
  }
  if (idx.type === "dense" || idx.type === "hybrid") {
    if (typeof idx.dim !== "number") {
      f.push(err("4.1", "$.index.dim", '`dim` is required when type is "dense" or "hybrid"'));
    }
    if (!["cosine", "dot", "l2"].includes(idx.distance as string)) {
      f.push(err("4.1", "$.index.distance", '`distance` must be "cosine", "dot", or "l2"'));
    }
  } else if (typeof idx.type === "string" && idx.type !== "sparse") {
    f.push(warn("4.1", "$.index.type", `unknown index type "${idx.type}"; treat retrieval as opaque`));
  }
  if (typeof idx.built_at === "string" && !ISO_8601.test(idx.built_at)) {
    f.push(err("4.1", "$.index.built_at", "`built_at` must be an ISO-8601 timestamp"));
  }
  return f;
}

// ---------- §3.4 rights ----------

const PERMISSIONS = ["allowed", "denied", "unknown"];
const TIER_NAMES = ["raw", "query", "insight"];

/**
 * Query parameter names that carry a credential or a personal identifier.
 * A URL in a citation or a manifest is published to every paying agent, so a
 * merchant that pastes an upstream URL in verbatim leaks whatever it used to
 * authenticate. `email`/`mailto` are here because the polite-pool convention
 * at NCBI and Crossref puts a real address in the query string.
 */
const CREDENTIAL_PARAMS =
  /[?&](api[_-]?key|apikey|key|token|access[_-]?token|auth|signature|sig|password|secret|email|mailto|tool)=/i;

/**
 * A URL field is a public address. Reject one carrying a credential or a
 * personal identifier before it reaches a published document.
 */
function validatePublicUrl(value: unknown, section: string, path: string): Finding[] {
  if (typeof value !== "string") return [];
  if (CREDENTIAL_PARAMS.test(value)) {
    return [
      err(
        section,
        path,
        "URL carries a credential-shaped or personally identifying query parameter; strip it before publishing",
      ),
    ];
  }
  return [];
}

function validateRightsScope(scope: unknown, path: string): Finding[] {
  const f: Finding[] = [];
  if (!isObject(scope)) return [err("3.4", path, "rights scope must be an object")];
  for (const key of ["license", "license_url"]) {
    if (scope[key] !== undefined && typeof scope[key] !== "string") {
      f.push(err("3.4", `${path}.${key}`, `\`${key}\` must be a string when present`));
    }
  }
  f.push(...validatePublicUrl(scope.license_url, "3.4", `${path}.license_url`));
  if (scope.status !== undefined && !PERMISSIONS.includes(scope.status as string)) {
    f.push(err("3.4", `${path}.status`, `\`status\` must be one of ${PERMISSIONS.join(", ")}`));
  }
  if (scope.tiers !== undefined) {
    if (!Array.isArray(scope.tiers)) {
      f.push(err("3.4", `${path}.tiers`, "`tiers` must be an array when present"));
    } else {
      scope.tiers.forEach((t, i) => {
        if (typeof t !== "string") {
          f.push(err("3.4", `${path}.tiers[${i}]`, "tier name must be a string"));
        } else if (!TIER_NAMES.includes(t)) {
          f.push(warn("3.4", `${path}.tiers[${i}]`, `unknown tier name "${t}"`));
        }
      });
    }
  }
  return f;
}

/**
 * §3.4. Rights are optional, but a rights block that says nothing is worse
 * than no block: it looks like a determination and is not one.
 */
export function validateRights(rights: unknown, path: string): Finding[] {
  const f: Finding[] = [];
  if (!isObject(rights)) return [err("3.4", path, "`rights` must be an object")];

  for (const scope of ["metadata", "content"]) {
    if (rights[scope] !== undefined) {
      f.push(...validateRightsScope(rights[scope], `${path}.${scope}`));
    }
  }

  for (const facet of RIGHTS_FACETS) {
    const v = rights[facet];
    if (v !== undefined && !PERMISSIONS.includes(v as string)) {
      f.push(err("3.4", `${path}.${facet}`, `\`${facet}\` must be one of ${PERMISSIONS.join(", ")}`));
    }
  }

  if (rights.citation_only !== undefined) {
    if (typeof rights.citation_only !== "boolean") {
      f.push(err("3.4", `${path}.citation_only`, "`citation_only` must be a boolean when present"));
    } else if (rights.citation_only === true) {
      // The shorthand and the explicit facets must state the same thing.
      for (const facet of ["redistribution", "retention"] as const) {
        if (rights[facet] !== undefined && rights[facet] !== "denied") {
          f.push(
            err(
              "3.4",
              `${path}.${facet}`,
              `\`citation_only: true\` denies \`${facet}\`; it cannot also be "${rights[facet]}"`,
            ),
          );
        }
      }
    }
  }

  for (const key of ["terms_url", "provider_release", "jurisdiction", "notes"]) {
    if (rights[key] !== undefined && typeof rights[key] !== "string") {
      f.push(err("3.4", `${path}.${key}`, `\`${key}\` must be a string when present`));
    }
  }
  f.push(...validatePublicUrl(rights.terms_url, "3.4", `${path}.terms_url`));

  if (rights.retrieved_at !== undefined) {
    if (typeof rights.retrieved_at !== "string" || !ISO_8601.test(rights.retrieved_at)) {
      f.push(err("3.4", `${path}.retrieved_at`, "`retrieved_at` must be an ISO-8601 timestamp"));
    }
  } else if (typeof rights.terms_url === "string") {
    // Terms change. A determination with no read date cannot be audited.
    f.push(
      warn("3.4", `${path}.retrieved_at`, "`terms_url` without `retrieved_at` is not auditable later"),
    );
  }

  const said =
    RIGHTS_FACETS.some((k) => rights[k] !== undefined) ||
    rights.citation_only !== undefined ||
    rights.metadata !== undefined ||
    rights.content !== undefined;
  if (!said) {
    f.push(warn("3.4", path, "`rights` states no scope and no facet; every action stays unknown"));
  }

  return f;
}

// ---------- §3 envelope ----------

export interface EnvelopeOptions {
  /**
   * Protocol version to validate against, normally the merchant's
   * `manifest.spec`. Versions before 0.3 accept a singular `citation`.
   */
  version?: string;
  /** Tier the envelope came from, checked against `receipt.tier`. */
  tier?: string;
}

/**
 * Extract the result list per §3.3: `data.rows`, else `data.top_k`, else
 * `data` when it is an array. `null` means the response is single-record.
 */
export function resultList(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!isObject(data)) return null;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.top_k)) return data.top_k;
  return null;
}

export function validateEnvelope(doc: unknown, opts: EnvelopeOptions = {}): Report {
  const version = opts.version ?? SPEC_VERSION;
  const legacy = isLegacyVersion(version);
  const f: Finding[] = [];

  if (!isObject(doc)) {
    return { ok: false, version, findings: [err("3", "$", "envelope must be a JSON object")] };
  }
  if (!("data" in doc)) f.push(err("3", "$.data", "`data` is required"));

  // --- citation shape
  let citations: Citation[] = [];
  if (doc.citation === undefined) {
    f.push(err("3", "$.citation", "`citation` is mandatory. No citation, not feed402."));
  } else if (Array.isArray(doc.citation)) {
    citations = doc.citation as Citation[];
    if (citations.length === 0) {
      f.push(err("3", "$.citation", "`citation` must have at least one entry on success"));
    }
  } else if (legacy) {
    citations = [doc.citation as Citation];
    f.push(
      warn("7.1", "$.citation", `singular \`citation\` accepted for ${version}; 0.3 requires an array`),
    );
  } else {
    f.push(
      err("3", "$.citation", `\`citation\` must be an array in ${version} (see SPEC §7.1 for migration)`),
    );
  }

  citations.forEach((cit, i) => f.push(...validateCitation(cit, `$.citation[${i}]`)));

  // --- §7.2 deprecated aliases must agree with the array
  if (doc.citation_legacy !== undefined) {
    f.push(warn("7.2", "$.citation_legacy", "deprecated alias; sunset at feed402/0.5"));
    if (citations.length > 0 &&
        JSON.stringify(doc.citation_legacy) !== JSON.stringify(citations[0])) {
      f.push(err("7.2", "$.citation_legacy", "`citation_legacy` must equal `citation[0]`"));
    }
  }
  if (isObject(doc.data) && Array.isArray(doc.data.hits)) {
    f.push(warn("7.2", "$.data.hits", "deprecated alias for the citation array; sunset at feed402/0.5"));
    if (!legacy && doc.data.hits.length !== citations.length) {
      f.push(
        err("7.2", "$.data.hits", "`data.hits` must map one-to-one onto `citation` (SPEC §7.2 table)"),
      );
    }
  }

  // --- §3.3 correspondence
  if (citations.length > 0) f.push(...validateCorrespondence(doc.data, citations, legacy));

  // --- receipt
  if (!isObject(doc.receipt)) {
    f.push(err("3", "$.receipt", "`receipt` is required and must be an object"));
  } else {
    const r = doc.receipt;
    if (typeof r.tier !== "string") {
      f.push(err("3", "$.receipt.tier", "`tier` is required and must be a string"));
    } else if (opts.tier && r.tier !== opts.tier) {
      f.push(err("3", "$.receipt.tier", `expected tier "${opts.tier}", got "${r.tier}"`));
    }
    if (typeof r.price_usd !== "number") {
      f.push(err("3", "$.receipt.price_usd", "`price_usd` is required and must be a number"));
    }
    if (typeof r.tx !== "string") {
      f.push(err("3", "$.receipt.tx", "`tx` is required and must be a string"));
    }
    if (r.paid_at !== undefined && (typeof r.paid_at !== "string" || !ISO_8601.test(r.paid_at))) {
      f.push(err("3", "$.receipt.paid_at", "`paid_at` must be an ISO-8601 timestamp"));
    }
  }

  return { ok: !f.some((x) => x.severity === "error"), version, findings: f };
}

function validateCitation(cit: unknown, path: string): Finding[] {
  const f: Finding[] = [];
  if (!isObject(cit)) return [err("3", path, "citation must be an object")];
  if (typeof cit.type !== "string") {
    f.push(err("3.1", `${path}.type`, "`type` is required and must be a string"));
  }
  if (cit.type === "vds") {
    for (const key of ["script_id", "session_id", "captured_at", "verifier", "signature"]) {
      if (typeof cit[key] !== "string") {
        f.push(err("3.1", `${path}.${key}`, `vds citation requires string \`${key}\``));
      }
    }
    if (!isObject(cit.verification)) {
      f.push(err("3.1", `${path}.verification`, "vds citation requires a `verification` object"));
    }
  } else {
    // §3.1: an unrecognized type degrades to `source`, so apply source rules.
    for (const key of ["source_id", "provider", "retrieved_at"]) {
      if (typeof cit[key] !== "string") {
        f.push(err("3", `${path}.${key}`, `\`${key}\` is required and must be a string`));
      }
    }
    if (typeof cit.retrieved_at === "string" && !ISO_8601.test(cit.retrieved_at)) {
      f.push(err("3", `${path}.retrieved_at`, "`retrieved_at` must be an ISO-8601 timestamp"));
    }
    if (typeof cit.type === "string" && cit.type !== "source") {
      f.push(warn("3.1", `${path}.type`, `unrecognized citation type "${cit.type}"; degrading to source`));
    }
  }
  if (cit.retrieval !== undefined) {
    if (!isObject(cit.retrieval)) {
      f.push(err("3.2", `${path}.retrieval`, "`retrieval` must be an object"));
    } else {
      if (typeof cit.retrieval.model !== "string") {
        f.push(err("3.2", `${path}.retrieval.model`, "`model` is required and must be a string"));
      }
      for (const key of ["score", "rank"]) {
        if (typeof cit.retrieval[key] !== "number") {
          f.push(err("3.2", `${path}.retrieval.${key}`, `\`${key}\` is required and must be a number`));
        }
      }
      if (typeof cit.retrieval.rank === "number" && cit.retrieval.rank < 0) {
        f.push(err("3.2", `${path}.retrieval.rank`, "`rank` is zero-based and must not be negative"));
      }
    }
  }
  if (cit.chunk_id !== undefined) {
    if (typeof cit.chunk_id !== "string") {
      f.push(err("3.2", `${path}.chunk_id`, "`chunk_id` must be a string"));
    } else if (typeof cit.source_id === "string" && !cit.chunk_id.startsWith(`${cit.source_id}#c`)) {
      f.push(
        warn("3.2", `${path}.chunk_id`, "`chunk_id` should have the form `<source_id>#c<n>`"),
      );
    }
  }
  f.push(...validatePublicUrl(cit.canonical_url, "3", `${path}.canonical_url`));
  if (cit.rights !== undefined) {
    f.push(...validateRights(cit.rights, `${path}.rights`));
    // The summary and the structured block must not contradict each other.
    if (
      isObject(cit.rights) &&
      cit.rights.citation_only === false &&
      typeof cit.license === "string" &&
      /citation[-_ ]only/i.test(cit.license)
    ) {
      f.push(
        warn(
          "3.4",
          `${path}.license`,
          'summary `license` says citation-only while `rights.citation_only` is false; `rights` is what a consumer acts on',
        ),
      );
    }
  }
  if (cit.result_index !== undefined) {
    if (!Array.isArray(cit.result_index) || cit.result_index.some((n) => !Number.isInteger(n) || n < 0)) {
      f.push(err("3.3", `${path}.result_index`, "`result_index` must be an array of non-negative integers"));
    }
  }
  return f;
}

function validateCorrespondence(data: unknown, citations: Citation[], legacy: boolean): Finding[] {
  const f: Finding[] = [];
  const results = resultList(data);
  const withIndex = citations.filter(
    (c) => (c as { result_index?: number[] }).result_index !== undefined,
  );

  // Rule 3: all-or-nothing explicit binding.
  if (withIndex.length > 0 && withIndex.length !== citations.length) {
    f.push(
      err("3.3", "$.citation", "if any citation carries `result_index`, every citation must carry it"),
    );
  }
  const explicit = withIndex.length === citations.length && withIndex.length > 0;

  // §3.3 is normative from 0.3 onward. Pre-0.3 merchants emitted one
  // citation per envelope regardless of result count, so counting rules are
  // not applied to legacy documents; identity rules below still are.
  if (results === null) {
    // Rule 1: single-record.
    if (!legacy && citations.length !== 1) {
      f.push(
        err("3.3", "$.citation", `single-record response must return exactly 1 citation, got ${citations.length}`),
      );
    }
    return f;
  }

  if (results.length === 0) {
    // Rule 6: zero-result responses.
    if (!legacy && citations.length !== 1) {
      f.push(err("3.3", "$.citation", "zero-result response must carry exactly 1 collection citation"));
    } else if (!legacy) {
      const ri = (citations[0] as { result_index?: number[] }).result_index;
      if (!Array.isArray(ri) || ri.length !== 0) {
        f.push(err("3.3", "$.citation[0].result_index", "zero-result citation must carry `result_index: []`"));
      }
    }
    return f;
  }

  if (explicit) {
    const covered = new Set<number>();
    citations.forEach((c, i) => {
      for (const n of (c as { result_index: number[] }).result_index) {
        if (n >= results.length) {
          f.push(
            err("3.3", `$.citation[${i}].result_index`, `index ${n} is out of range for ${results.length} results`),
          );
        }
        covered.add(n);
      }
    });
    for (let n = 0; n < results.length; n++) {
      if (!covered.has(n)) {
        f.push(err("3.3", "$.citation", `result ${n} is not grounded by any citation`));
      }
    }
  } else if (!legacy && citations.length !== results.length) {
    // Rules 2 and 4.
    const rule = citations.length < results.length ? "4" : "2";
    f.push(
      err(
        "3.3",
        "$.citation",
        `ordinal alignment requires one citation per result (${citations.length} citations, ` +
          `${results.length} results). Emit \`result_index\` on every citation. [rule ${rule}]`,
      ),
    );
  }

  // Rule 5: dedup key uniqueness.
  const seen = new Map<string, number>();
  citations.forEach((c, i) => {
    const key = (c as { chunk_id?: string; source_id?: string }).chunk_id ??
      (c as { source_id?: string }).source_id;
    if (key === undefined) return;
    const prev = seen.get(key);
    if (prev !== undefined) {
      f.push(
        err("3.3", `$.citation[${i}]`, `duplicate dedup key "${key}" (also at citation[${prev}]); merge into one entry with a combined \`result_index\``),
      );
    } else {
      seen.set(key, i);
    }
  });

  return f;
}

/** Normalize any historical or canonical envelope to the 0.3 shape. */
export function normalizeEnvelope<D>(env: Envelope<D> | LegacyEnvelope<D>): Envelope<D> {
  return { ...env, citation: Array.isArray(env.citation) ? env.citation : [env.citation] };
}

export function formatReport(label: string, r: Report): string {
  const lines = [`${r.ok ? "PASS" : "FAIL"}  ${label}  (${r.version})`];
  for (const x of r.findings) {
    lines.push(`  ${x.severity === "error" ? "E" : "W"} §${x.section} ${x.path}: ${x.message}`);
  }
  return lines.join("\n");
}
