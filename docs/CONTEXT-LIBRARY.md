# Client context library — findings and decisions

Working document. Records what was **verified** about the onboarding→audit seam on
2026-08-07, what was decided, and what is still open. Companion to
`AUTOMATION-CONTEXT.md` (why the audit exists) and `AUTOMATION-PLAN.md` (the slice
order). Where this document and those disagree, they were written at different
times — check the code.

Every claim below carries a file:line. Two independent agent sweeps produced
them; a third adversarial pass refuted several, and the refutations are recorded
alongside rather than deleted, because the refuted version is the one a reader
will otherwise re-derive.

---

## 1. What the audit actually knows about a client

**Two columns. Both are fetch targets, neither changes an interpretation.**

| Input | Where | What it changes |
|---|---|---|
| `clients.gsc_site_url` | `lib/orchestrator/run.ts:153` | Whether the GSC station runs. Null ⇒ ONPAGE-006 and ONPAGE-012 become `not_run`. |
| `clients.website_url` | `lib/orchestrator/run.ts:259` | The origin robots.txt/llms.txt are fetched from. |

Everything else arrives out-of-band as a Sitebulb export
(`lib/orchestrator/types.ts:70` — the only non-optional field), which is the
substrate for 6 of the 8 registered checks.

**`clients.service_context` is read by no file** under `lib/stations`,
`lib/orchestrator`, `lib/findings`, `lib/scoring` or `lib/ingest`. That is where
`lib/onboarding/promote.ts:137` writes all ten business-context slots.

### This is structural, not unfinished wiring

A check's signature is `evaluate(stations: StationBundle)` (`lib/findings/engine.ts:78`)
and the scorer's whole context is `{ gsc?, crawl? }` (`lib/scoring/types.ts:86-89`).
**No check can read a client fact even in principle** — there is no parameter for
it. Making the audit client-aware is an interface change, not a wiring change.
Budget accordingly.

### The audit is not reachable from the portal

`runAudit` has exactly two call sites outside its own definition:
`scripts/audit-dry-run.ts:161` and `tests/unit/orchestrator.test.ts`. There is no
`app/api/audit`, no `app/actions/audit.ts`, no `app/(dashboard)/tools/audit`. The
only way to run one is:

```
node --import ./scripts/ts-alias-hook.mjs scripts/audit-dry-run.ts <exportDir> --client <uuid>
```

**Nothing validates that the export belongs to that client.** `options.clientId`
is not an attribution key either — `lib/orchestrator/recorder.ts:54-70` hardcodes
`client_id: null`.

> Onboarding does not, and cannot currently, "kick off" an audit. Synthesis — the
> intended consumer of onboarding context per `AUTOMATION-PLAN.md:196-200` — is
> slice **7 of 7**. Slices 1–2 are done.

### Every threshold is a global constant

50 impressions for cannibalisation (`checks.ts:277`), 50% untagged for MEAS-001
(`checks.ts:238`), 5 pages / 50% unique for ONPAGE-012
(`content-template-ratio.ts:107,125`), Googlebot as the only user-agent
(`checks.ts:82-83`), a US-only 52-entry state set (`lib/ingest/sitebulb/geo.ts:18-22`),
a 90-day GSC window (`run.ts:42`). Scoring has one CTR curve, one category-weight
table, and no client dimension in `ScoringConfig` at all (`lib/scoring/config.ts:68,129,236`).

The pipeline assumes every client is a US local home-services business.

---

## 2. The onboarding slots

**19 slots. 18 are read by no part of the audit** — only `gsc_site_url` reaches
it, and then only as a fetch target.

### The required/optional split is backwards

The interview prompt is built from **required slots only**
(`lib/onboarding/completeness.ts:57`). So:

- The 9 slots with **no** `promotesTo` — prose that nothing reads — are `required`
  and gate `ready_for_review`.
- `brand_terms`, `competitors`, `key_event_names`, `gbp_account_id`,
  `gbp_location_group`, `google_sheet_id` — every one of which writes a column
  code reads — are `required: false` and **are never asked**.

Measured consequence (2026-08-07): 4 onboarding sessions exist, **all
`in_progress`**, best one 4 slots answered of 12 required. **0 clients have
`service_context`.** No session has ever been approved.

### Proposed disposition — NOT YET RATIFIED

Test for a slot: *does it write a column that code reads today?* Prose belongs in
the library, where a model retrieves it on demand.

**Keep (10):** `client_type` `ga4_property_id` `gsc_site_url` `gbp_account_id`
`gbp_location_group` `competitors` `brand_terms` `key_event_names`
`google_sheet_id` `service_radius`

Required should mean *code breaks without it*: `gsc_site_url`, `ga4_property_id`,
`client_type`.

**Move to the library (6):** `seasonality` `lead_handling` `prior_vendor_work`
`cms_hosting` `brand_constraints` `approval_authority`

**Hold (2)** — real, but `sizeOpportunity` has no production caller and
`stuck_keyword` has no row in `BASIS_RULES` (`lib/scoring/score.ts:94-103`):
`avg_job_value` `services_by_revenue`

**Delete or redesign (1):** `gbp_service_areas_confirmed` — see §3.

**Do not add `business_city`** despite it being LOCAL-016's real input: GBP
discovery already returns it (`lib/onboarding/discover.ts:366`,
`lib/connectors/gbp.ts:98`). Derive, don't ask.

---

## 3. LOCAL-016 — the trap

**DECIDED 2026-08-07: do not feed LOCAL-016 declared service areas.**

One sweep called it "the highest-leverage single change" — the slot
`gbp_service_areas_confirmed` names LOCAL-016 by id, LOCAL-016 is
`verticalCritical: true`, and it is permanently `not_run` because the GBP station
is pinned `unavailable` (`lib/orchestrator/run.ts:101-105`, with `needsGbp: false`
at `:120-124` as a deliberate lockout).

An adversarial pass refuted it. LOCAL-016 does **set membership** against declared
areas (`lib/findings/checks.ts:342-346`), but the rubric row's own note says *an
SAB ranks by proximity to its REAL address, not declared areas*. So a client who
declared Orange County gets a **PASS** on Orange County pages served from Sherman
Oaks — one of the five documented §9 P1s, turned green.

That is TECH-009's "fabricated pass wearing a detector costume", which
`AUTOMATION-PLAN.md` declines to build for exactly this reason. **Converting
`not_run` into a wrong pass is strictly worse than the status quo.**

Making LOCAL-016 useful requires redesigning it to measure **distance from the
real business address** — a rubric decision, not a coding one. `service_radius`
encodes the pilot failure better than `gbp_service_areas_confirmed` does.

---

## 4. Brand terms are already derived, twice, and thrown away

`lib/tools/callable/ai-visibility.ts:106-112` falls back to
`[client.slug, brandTokenFromSite(siteUrl), client.name]` when `brand_terms` is
empty and tags it `termsSource: 'heuristic'`. `lib/google-search-console.ts:328`
does the same independently with `defaultBrandToken()`.

Two implementations, computed at read time, never persisted, never reviewable —
the same duplication-buys-a-disagreement pattern as the four `slugify` copies.

**Derive once at onboarding, persist as `source: 'auto'`, let a human correct it.**

Two failure modes that make human confirmation load-bearing rather than optional:

- **Over-capture on generic-word brands.** The matcher is substring
  (`ai-visibility.ts:55`), so `q.includes('tornado')` marks "tornado damage repair"
  branded. For Apex / Summit / Tornado names this inflates branded share and
  *understates* non-branded opportunity — backwards from the audit's purpose.
- **Misspellings, former and acquired names.** For a roll-up, customers search the
  acquired brand for years. No derivation from the current slug finds it.

Better source than the name: **GSC itself.** Branded queries cluster at position
1–2 with very high CTR. Propose candidates from the client's real query set.

---

## 5. Context library — design direction

The library is **append-only and authoritative**; facts are a **derived projection**
over it. Today it is inverted: extraction writes facts and the transcript's job is
done.

Why invert, and why now:

- **Re-derivable.** The extractor is known-miscalibrated (§6). Re-running a better
  one over stored artifacts improves every client retroactively.
- **Provenance survives.** A fact points at an artifact that still exists.
- **Zero migration cost today** — 0 clients have `service_context`, and the audit
  reads none of it. The cost grows with every slice built on the current shape.

### Three epistemic kinds

| Kind | Example | Trust |
|---|---|---|
| `said` | Zoom transcript, email, note | A claim. Needs confirming. |
| `observed` | GSC export, crawl, CWV | Measured. A snapshot. |
| `derived` | Audit run, our own report | Only as good as its inputs. |

The current `kind` check constraint has four values and no notion of this. There
is also no `document` kind, so a prior vendor's PDF cannot be stored at all.

### Known blockers on the month-2 re-run

1. Both extraction callers require an active `in_progress`/`ready_for_review`
   session (`app/actions/zoom-context.ts:183-192`, `app/actions/onboarding.ts:326-335`)
   and target only unanswered slots. After approval a re-import attaches to
   nothing and reports `noActiveSession`.
2. **There is no accept path for 10 of the 19 slots.** Provenance and manual
   override exist only for slots with `promotesTo` — `SHARED_SLOTS` at
   `app/actions/clients.ts:95-97`, `<Prov>` rendered for exactly nine ids in
   `ClientSettingsForm.tsx`. A suggestion for `avg_job_value` has nowhere to land.

### Retention conflicts with all of this — OPEN

`supabase/migrations/20260807000000_client_context_retention.sql` purges unpinned
rows at 60 days, justified on the grounds that *"the answers extracted from it
live in `clients.service_context.answers`"* — i.e. **the projection is durable and
the library is disposable.** That is the exact inverse of the direction above.

Recommended: keep for the life of the client, make deletion the deliberate act,
repurpose `pinned` as a retrieval-priority signal. Reversal cost is zero — the
purge has never run (`pg_cron` is not installed) and 2 rows exist.

**Not yet decided. It reverses a decision made the same day.**

### Retrieval — defer vectors

`vector` 0.8.0, `pg_trgm` and `pg_cron` are all *available, not installed* on
project `zoeaifsxnaenlcdkavzf`.

Volume does not justify embeddings yet: 5 active clients, ~100 artifacts/client/year.
Postgres FTS plus recency and `kind` filters will find things. The higher-value
layer is a **rolling client brief** — a `derived` artifact regenerated on write and
injected into Ask LVL3 and the tools. Ask LVL3 currently builds its whole client
context from one five-column select (`app/api/ask-lvl3/route.ts:113-117`).

Add pgvector when FTS demonstrably misses.

---

## 6. Extraction is miscalibrated for transcripts

Measured directly against `evidenceQuotesSource` with VTT-shaped text:

| Case | Result |
|---|---|
| Exact verbatim substring | passes |
| Quote spanning speaker turns, label included | passes |
| Quote spanning turns **without** the label | **fails** |
| Model writes `30`, transcript says "thirty" | **fails** |
| Model appends a trailing `…` | **fails** |
| Light paraphrase | fails *(correct — by design)* |
| Smart quotes, whitespace | normalised fine |

Spoken English says "about a thirty mile radius"; a model extracting a number
writes `30`. The check then rejects its own correct answer. The strictness is
right in principle and calibrated for prose.

The quote check runs **before** evidence truncation
(`lib/onboarding/extract.ts:224` vs `:253`), so truncation is not a cause.

**`validateExtractions` returns `rejected[]` with a reason and detail per
candidate. Nothing surfaces it.** Both `addClientContext` and `importClientCalls`
discard it and report "nothing could be tied to an open question". Fix this first
— it is the cheapest change here and everything else is guesswork without it.

---

## 7. Open decisions

1. **Retention** — flip to life-of-client, or keep 60-day/pinned? (§5)
2. **Slot cut** — adopt the 10/6/2/1 disposition? (§2)
3. **LOCAL-016 redesign** — is distance-from-real-address the right test? Rubric
   decision. (§3)
4. **Interview UX** — nothing above says what the chat asks, in what order, or
   what a month-2 session is.
5. **Other modalities** — Granola, Gmail, Gong, Slack, prior-vendor PDFs, client
   website copy. The migration names Granola and Gmail as "the connectors that
   come next"; none are designed.
