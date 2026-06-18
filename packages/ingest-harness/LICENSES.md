# feed402 dataset license audit

This document is the legal section of every paid endpoint shipped from
`@feed402/ingest-harness`. Every dataset's `manifest.yaml` declares a
`citation_policy`; this file is the per-source breakdown of what that policy
is composed of, and what we explicitly excluded.

**Decision rule for paid-query compatibility:**

| License                 | Paid query? | Notes |
|-------------------------|:-----------:|-------|
| Public domain / CC0      | ✅ | Zero restriction. |
| CC-BY (any version)      | ✅ | Attribution carried in citation envelope (`citation.canonical_url`). |
| CC-BY-SA (any version)   | ✅ | SA only constrains derived *databases*, not metered API access. We provide source URLs, not bulk SA data dumps. |
| Government open data     | ✅ | openFDA, World Bank, NHGIS — free for commercial reuse. |
| **CC-BY-NC**             | ❌ | Non-commercial only. **Excluded** from every dataset below. |
| **CC-BY-ND**             | ❌ | No derivatives — incompatible with chunking + retrieval. |
| **Proprietary/licensed** | ❌ | DrugBank academic, SWIFT BIC, ACLED commercial tier. |

When a source is excluded, its dataset's `ingest.stats.json` records
`excluded_due_to_license: [...]` for transparency.

---

## Per-dataset breakdown

### `pharma-fda`
- **citation_policy**: `openFDA-public`
- **Sources**: openFDA Drug Approvals (`api.fda.gov/drug/drugsfda`), Wikipedia HQ
  coordinate lookups (CC-BY-SA-4.0).
- **Excluded**: DrugBank (academic license), DailyMed structured product labels
  fragments (mixed; safer to link via `canonical_url`), EMA EPAR (free but rate-limited).
- **Attribution**: each row's `source_url` links to the canonical FDA accessdata page.
  No openFDA TOS line item requires an in-row attribution string.

### `world-history`, `us-history`, `constitutions`, `math-history`,
### `physics-history`, `medical-history`, `banking-history`, `world-politics`
- **citation_policy**: `CC-BY-SA-4.0`
- **Sources**: Wikidata SPARQL (Wikidata structured data is **CC0**;
  inherited Wikipedia descriptions are **CC-BY-SA-4.0**).
- **Excluded**:
  - **ACLED** (Armed Conflict Location & Event Data) — CC-BY-NC for
    non-commercial; commercial requires paid license. Explicitly **NOT** ingested
    into `world-politics` even though it would dominate the post-2000 conflict slice.
  - **Slave Voyages** — CC-BY-NC; would have been the high-quality source for
    the trans-Atlantic trade overlay in `us-history`.
  - **Constitute Project** — CC-BY-NC; we use Wikidata-only constitutional metadata
    to avoid the NC trap. Comparative Constitutions Project (CCP) variables are
    CC-BY and a planned future addition.
- **Attribution**: every row's `source_url` is a `wikidata.org/wiki/Q…`
  permalink. The `citation.canonical_url` carries this through to clients.

### `banking`
- **citation_policy**: `CC-BY-4.0`
- **Sources**: World Bank Open Data API (CC-BY-4.0). Indicator IDs:
  FB.AST.NPER.ZS, FB.BNK.CAPA.ZS, GFDD.SI.05, FS.AST.PRVT.GD.ZS, FB.CBK.DPTR.P3.
- **Excluded**: SWIFT BIC directory (commercial license), Reinhart-Rogoff
  banking-crisis dataset (Harvard repository — license unclear, requires audit).
- **Attribution**: the World Bank requires linking back to
  `data.worldbank.org/indicator/<ID>`; we do this in every row's `source_url`.

### `per-nation`
- **citation_policy**: union of upstreams (mostly CC-BY-SA-4.0)
- **Sources**: merged from the 10 datasets above. Each row carries its
  upstream `provider` field so per-row license is fully traceable via
  `source_url`.
- **No new sources** — this dataset is structural, not a new data pull.

---

## Excluded-source registry

| Source                  | License      | Would have powered          | Status |
|-------------------------|--------------|-----------------------------|--------|
| ACLED                   | CC-BY-NC     | world-politics (conflict)   | ❌ excluded |
| Slave Voyages           | CC-BY-NC     | us-history (trade)          | ❌ excluded |
| Constitute Project      | CC-BY-NC     | constitutions (clauses)     | ❌ excluded |
| DrugBank                | academic     | pharma-fda (drug-target)    | ❌ excluded |
| MacTutor (St Andrews)   | academic-share | math-history (theorems)   | ⏳ audit pending |
| Reinhart-Rogoff crises  | unclear      | banking-history (failures)  | ⏳ audit pending |
| EM-DAT                  | non-commercial-research | medical-history (disasters) | ⏳ audit pending |
| SWIFT BIC               | commercial   | banking (institution mapping) | ❌ excluded |

Anything in "audit pending" is **not yet ingested**; the dataset ships
without it until the audit clears or upstream changes terms.

---

## How to read a citation in the response envelope

Every feed402 response includes a `citation` block per spec §3:

```json
"citation": {
  "type": "source",
  "source_id": "world-history:wd-Q83533-magna-carta",
  "provider": "world-history",
  "retrieved_at": "2026-04-27T16:30:00Z",
  "license": "CC-BY-SA-4.0",
  "canonical_url": "https://www.wikidata.org/wiki/Q83533"
}
```

The `license` field is **per-row** — it overrides the manifest default when a
single row in a dataset has a different upstream. This matters for `pharma-fda`,
where most rows are openFDA-public but the geocoding cross-references
Wikipedia (CC-BY-SA-4.0).

---

*Last audit: 2026-04-27. Reviewer: bkt-h7p. License audit is a continuous bead;
re-run before each public deploy of a new dataset.*
