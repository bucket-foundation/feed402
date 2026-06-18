#!/bin/bash
# Gmail compose URL for feed402 status resync with Lanzafame.
#
# Context: the Apr 15 review packet (fixed-bid $600 / 10h) is STALE. Billing
# was reframed to hourly on Apr 18, and spec shipped v0.2 on Apr 19. This
# script replaces the prior `send-to-lanzafame.sh` content.
#
# This is a short status + direction ask, NOT another review packet.
# No attachments — the whole repo is <500 LOC and the text below is the update.
#
# Usage: bash send-to-lanzafame.sh
# Then click the printed URL in any browser logged into gianyrox@gmail.com
# → compose opens → review body → send.
#
# This script DOES NOT SEND — it only prints a URL.

# TODO: fill in before clicking. Not committed for obvious reasons.
TO="${LANZAFAME_EMAIL:-REPLACE_WITH_LANZAFAME_EMAIL}"

SUBJECT="feed402 status — v0.2 shipped, need direction on next hours"

BODY="Hey,

Short status pulse on feed402 so you can steer the next hours.

What changed since the last packet:

  1. Billing reframed to hourly (\$60/hr) under the existing Viatika
     engagement. No fixed bid, no separate contract. Terms are in
     CONTRACT.md, half a page, MIT code / CC0 spec, Gian-authored, no
     ownership transfer. This reverses the Apr 15 fixed-bid framing.

  2. Spec is at v0.2 (backwards-compatible with v0.1):
       §4  — optional \`index\` manifest: merchants declare retrieval scheme
             (dense/sparse/hybrid, embedding model, chunk strategy,
             corpus_sha256, built_at).
       §3.2 — optional \`chunk_id\` + \`retrieval.{model, score, rank}\` on
             source citations.
     Point: citations become reproducible, not just referenceable.
     (provider, corpus_sha256, chunk_id, model) lets a second merchant
     re-verify the retrieval that produced a hit. That's the moat vs.
     'scrape the source yourself.'

  3. Reference v0.1 impl shipped and working end-to-end:
       server.ts (Hono, 3 tiers, in-memory corpus)  —  ~280 LOC
       agent.ts  (discovery → 402 → paid envelope)  —  ~120 LOC
       demo.sh   (one command, prints full flow)

  4. Reference v0.2 impl just landed (today): server emits feed402/0.2
     manifest with the §4 index block, insight tier attaches retrieval
     provenance per §3.2. Demo visibly shows it.

What's still stubbed / deferred:

  - x402 payment verification is a presence-check on the x-payment header.
    Plugging in a real facilitator signature check is ~a half-day of work.
  - CORPUS is 3 hardcoded PubMed stubs. Real dataset swap pending.
  - No git remote yet. Repo home still undecided.

Three questions to steer the next hours:

  (A) Protocol direction — v0.2's index/provenance addition: keep, push
      back, or extend before any more protocol work?

  (B) Repo home — Viatika org, neutral, or my personal (gianyrox/feed402)?
      Every day it stays local-only is a day no one else can fork it.

  (C) Next burn target — pick one:
        (c1) Swap the stub x402 verifier for a real Base facilitator check.
        (c2) Bring ~/agfarms/x402-research-gateway (my existing Go
             implementation with 7 live Base Sepolia research endpoints —
             PubMed, Semantic Scholar, OpenAlex, ClinicalTrials, PubChem,
             Kruse corpus) up to feed402 compliance. That's the second
             real merchant and the biggest proof the protocol travels.
        (c3) First real dataset in the TS reference server (pick one
             corpus).
        (c4) Something else you care about more.

One thing I'd flag explicitly if you haven't reread the spec lately:
§3.1 keeps the forward-compat hook for citation types. VDS (Verified
Data Session) is defined as the first non-\`source\` type; DerbyFish
BHRV (my catch-verification pipeline) is the named reference. That
widens feed402 from 'paid literature' to 'paid evidence' without a
spec rewrite. Zero cost to v0.2; the value shows up when a VDS merchant
lists alongside a source merchant.

Hours burned so far: \$TBD — I'll reconcile the TIMELOG once I'm at a
terminal. Ballpark multi-session, pre-payment obviously.

One reply with (A) + (B) + (C) is enough to unblock the next session.

— Gian"

# URL-encode body for Gmail compose
python3 <<PY
import urllib.parse
print("https://mail.google.com/mail/?view=cm&fs=1" +
      "&to=" + urllib.parse.quote("""${TO}""") +
      "&su=" + urllib.parse.quote("""${SUBJECT}""") +
      "&body=" + urllib.parse.quote("""${BODY}"""))
PY
