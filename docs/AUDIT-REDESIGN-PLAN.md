# Audit redesign plan

**Supersedes [AUTOMATION-PLAN.md](AUTOMATION-PLAN.md).** That plan's slices 1–4 shipped
(in amended form — see the verified facts below for where reality diverged from its
sketches) and remain load-bearing. Its slices 5–7 are reshaped by this plan and should
not be built as written. Where the two files disagree, this one wins. The context file
[AUTOMATION-CONTEXT.md](AUTOMATION-CONTEXT.md) remains the background; nothing here
re-litigates D1–D7.

**Written 2026-08-07.** Produced from two research reports now committed at
[docs/research/audit-critique-80-check-rubric.md](research/audit-critique-80-check-rubric.md)
and [docs/research/keyword-analysis-decision-system.md](research/keyword-analysis-decision-system.md),
plus a design conversation, plus a six-agent fact-verification pass over the repo whose
findings are cited file:line throughout. Every code claim below was verified against the
tree on 2026-08-07, not inferred from earlier docs — several of which turned out stale.

## Status

| Slice | State | Commit |
|---|---|---|
| 0 · This document | ✅ **DONE** | `c659359` |
| 1 · Question taxonomy + coverage-by-question | ✅ **DONE** | `38bb3ef` + verification fixes |
| 2 · Rubric re-cut | ✅ **DONE** | |
| 3 · Geography at the station | not started | |
| 4 · Diagnoses layer | not started | |
| 5 · Keyword/demand layer v1 (GSC-only) | not started | |
| 6 · Scoring v2 | not started | |
| 7 · Vendor stations (grid + serp) | not started | |
| 8 · Synthesis + review gate | not started | |
| 9 · Client rendering, question-gated | not started | |
| 10 · Delta + cohort rendering | not started | |

## How to use this file

Update the status table as slices land. When a slice's reasoning turns out wrong, amend
it in place and say what changed — a why that no longer matches the code is worse than
no file. Same rule as the predecessor, which practiced it (its slice 1 and schema
sections were both amended after contact with reality).

---

## The decision

Rebuild the audit's **shape** without rebuilding its **plumbing**. The research verdict
(80-check critique, Part Zero) is that the instrument measures site properties when it
should measure visibility, demand capture, and outcomes — and that a checklist is not an
audit because it cannot produce a diagnosis. The response is four layers with different
cardinality: **observations** (station output, thousands), **assertions** (one per
rubric criterion, the current findings), **diagnoses** (composite rules, hard cap 5 per
run), and **recommendations** (10–20, each owned by a diagnosis). A recommendation that
cannot name its parent diagnosis does not ship; it goes to the appendix.

The run stops being organized by category (technical/onpage/local/…) and is organized by
**seven questions**, evaluated in order: 1 can we measure anything · 2 where is the
business actually visible · 3 what demand exists and what does the SERP do with it ·
4 who is beating us and by what · 5 can we convert what we get · 6 is anything about to
break (doorway/scaled-content exposure, GBP suspension risk) · 7 is hygiene below the
floor. Questions 2, 3, 4 are the critique's three Tier-1 gaps; none of them is a
Sitebulb re-run. Coverage is reported per-question ("Visibility: not measured"), never
as "N of 80".

What survives unchanged, because it is the best of the current build: the station
contract and `ok | degraded | failed`, the four-state finding model with `not_run`
distinct from `pass`, the degradation rule's single home, `ScoreInputs` persisted
verbatim, the eval harness's uncircularity, the draft gate (convention #12), and the
one-LLM-call rule. Roughly 70% of current code is untouched.

## What this plan overturns

Recorded because each was stated in the predecessor plan or in this session, and each
is now wrong or superseded.

1. **"Detector batch next" (old slice 6) is demoted to last.** The remaining ~28
   Sitebulb-backed checks are the cheapest work in the repo and the least
   decision-changing. They land after the diagnosis and keyword layers, not before.
2. **Coverage (old slice 5) is per-question, and it is greenfield.** The session that
   designed it never built it: `lib/audit/scope.ts` does not exist, and **no test
   anywhere asserts a coverage denominator of 80** (repo-verified; the only `toBe(80)`
   in tests is a client-settings completeness pct). Nothing needs rewriting — the
   per-question partition is built fresh. The principle to carry over is eval-gate's
   fixed-denominator rule: a check going `not_run` can never shrink what coverage is
   measured against.
3. **Synthesis (old slice 7) narrates diagnoses, not findings.** Same gate, same
   validators, one new validator (diagnosis cap), different input shape.
4. **The client-report cut changes from a count gate to a question gate.** The old
   plan cut the client-visible report at "14 of 80 criteria". The new gate: publishable
   when questions 1–3 are answerable for that client. A count gate can be gamed by
   adding cheap detectors; the question gate cannot.
5. **The findings table stops being the top-level object.** Diagnoses sit above it;
   the ranked plan is grouped under diagnoses, not sorted flat.
6. **The hardcoded CTR curve stops being a source of truth.** It becomes a labeled
   fallback behind a per-client curve derived from the client's own post-2025-09-10
   GSC data. The seam already exists: `opportunity-sizing.ts` takes the curve as an
   injected parameter.
7. **The category taxonomy is demoted to a tag.** Categories survive on rubric rows
   for reference; nothing is organized by them.

And one claim from this session's design conversation, corrected by verification:
"`audit_findings` stays roughly as-is" — **there is no `audit_findings` table.**
Findings ride inside `audit_runs.result` jsonb, and the migration that created
`audit_runs` documents the deferral explicitly (normalize when a cross-finding query
exists). This plan keeps that deferral.

## Verified facts that move the plan

All verified 2026-08-07 by direct code reads.

1. **`CHECKS` has exactly 8 members** — TECH-001, ONPAGE-003, TECH-011, MEAS-001,
   ONPAGE-006, LOCAL-016, LOCAL-003 inline plus ONPAGE-012 via `DERIVED_CHECKS`
   (`lib/findings/checks.ts:601-613`, `lib/findings/detectors/index.ts:29`). None of
   the rubric rows this plan retires is registered, so the re-cut touches **zero
   detectors**.
2. **`evaluate` is synchronous by design** — `(stations: StationBundle) => Finding`
   (`lib/findings/types.ts:64`), with a comment relying on it: "synchronous, so it
   cannot geocode" (`checks.ts:362-363`). Geography therefore moves into the stations,
   which are already async; the engine signature never changes.
3. **`lib/audit/scope.ts` does not exist; no denominator-80 test exists.** Old slice 5
   was never started. `lib/findings/coverage.ts` is field-level measurement coverage
   (pages measured per check), not check-count coverage, and contains no numeric
   literal besides 0.
4. **No `audit_findings` table exists.** `audit_runs.result` jsonb holds
   `{version: 1, run: AuditRunResult minus stations, export: attribution}`
   (`lib/audit/store.ts:97-101`); the stations bundle is deliberately destructured away
   because `tool_runs` already records it per station (`store.ts:359`).
   `audit_runs.status` check is `('complete','partial','failed')` — no lifecycle
   states (`supabase/migrations/20260807050000_audit_runs.sql:40-41`).
5. **All four stations are wired live** into `lib/orchestrator/run.ts` (crawl, gsc,
   gbp, robots; robots merges into the crawl slot via `withSiteFiles`, run.ts:371).
   The GBP station emits `degraded: true` on every success by design, and `runStatus`
   deliberately excludes gbp from its complete-slots `['crawl','gsc','robots']`
   (`run.ts:441-451`).
6. **LOCAL-016 currently tests declared-set membership, not proximity** (its own
   comment block says so). `lib/geo/distance.ts` is built — `geocode`,
   `driveDistance`, `haversineMiles`, typed failures, precision scale — and is
   imported by **exactly one file: its test** (`tests/unit/geo-distance.test.ts:21`).
   Keyed by `GOOGLE_PLACES_API_KEY`.
7. **`lib/ingest/sitebulb/geo.ts` IS wired** — `crawl.ts:42,227-228` calls
   `deriveTargetGeo`/`deriveTemplateGroup` per ingested page, so every page record
   already carries `targetGeo` and `templateGroup`. Three stale comments claim
   otherwise (`lib/findings/checks.ts:465-466`, `tests/unit/eval-units.test.ts:250`,
   `tests/unit/gbp-station.test.ts:648`) and must not be cited; slice 3 fixes them.
8. **The `stuck_keyword` scoring basis is implemented, tested, and mapped to no
   check** — `score.ts:200-205` says the opportunity detector is not built yet and the
   basis exists because §11 specifies it. The dispatch case (`score.ts:306`), basis
   weight (`config.ts:172`), and impact function (`lib/scoring/impact.ts:37-62`) all
   exist; the `BASIS_RULES` entry itself does not and is slice 5's to add. The keyword
   layer's opportunity check lands in a slot that is already waiting for it.
9. **The CTR curve is a frozen 13-point stepwise table** in
   `lib/scoring/config.ts:68-84`, and `SCORING_CONFIG.version` is
   `'scoring-2026-08-06.1'` — the snapshot comparator treats a version change as a
   failure to force a deliberate re-baseline (`config.ts:180-186`). Slices 2, 5, and 6
   each bump it.
10. **`ScoreInputs` is persisted verbatim** (modulo documented 4-decimal rounding,
    `score.ts:46-56`), with the stated purpose "you cannot fit what you did not
    record" (`lib/scoring/types.ts:1-12`). Winnability and confidence extend this
    record; they do not replace it.
11. **The eval harness**: exactly two fixtures (`healthy`, `tornado`), manifests carry
    `must_find` (with magnitudes) / `must_not_find` / `must_pass`, eval-gate pins the
    fixture directory listing to its wired cases and asserts tornado's `must_find` has
    length 6 (`tests/unit/eval-gate.test.ts:32-61`).
12. **`lib/eval/citation.ts` has zero production consumers** — header: "No consumer
    yet — synthesis is phase 5." Slice 8 is where it finally gets one.
13. **`openai@^6.25.0` is already a dependency**, used in exactly one file for image
    generation. **No embedding or cosine code exists anywhere in lib/ or app/.**
    Embeddings for clustering are a new use of an existing dependency, not a new
    package.
14. **`clients.service_context` exists and is read by no station, check, scorer, or
    tool** — writers are onboarding promotion and settings save; the only readers are
    the settings UI (`app/(dashboard)/clients/[id]/page.tsx`,
    `ClientSettingsForm.tsx:192`). Slice 5 gives it its first pipeline consumer.
15. **Connector reality**: Semrush portal connector already returns keyword rankings
    with volume (`fetchSemrushDomainOrganic`) and backlink overview; Keywords
    Everywhere returns volume/cpc/trend. **No GSC BigQuery integration exists** — all
    GSC data is API (`google.searchconsole v1`), cached 6h under a dateless key, a
    recorded quirk (`lib/stations/gsc.ts:50`).
16. **The audit UI is two components** — `AuditRunner.tsx` (signed-URL upload direct
    to the private `audit-exports` bucket, 4-concurrent, stop-on-first-failure) and
    `AuditResultView.tsx` (header/attribution, station strip over hardcoded
    `['crawl','gsc','gbp','robots']`, coverage card, findings table with scoring
    columns joined in, score trace). There is no separate plan table.

## The seven questions

Every **active** rubric row gets exactly one `question` value; a test asserts the
partition is exhaustive and exclusive. Retired rows keep whatever tag slice 1 gave
them but are excluded from the partition — the test is scoped to active rows.

| # | Question | key | Draws mainly from (today's categories) |
|---|---|---|---|
| 1 | Can we measure anything? | `measurement` | measurement |
| 2 | Where is the business actually visible? | `visibility` | local (grid/SoLV rows — mostly new) |
| 3 | What demand exists, and what does the SERP do with it? | `demand` | new keyword rows + parts of onpage |
| 4 | Who is beating us, and by what? | `competition` | authority + new competitor rows |
| 5 | Can we convert what we get? | `conversion` | cro |
| 6 | Is anything about to break? | `risk` | doorway/scaled-content, GBP suspension, indexability of money pages |
| 7 | Is hygiene below the floor? | `hygiene` | remaining technical + onpage |

The mapping of all 80 rows is data work in slice 1, done row by row — not a mechanical
category rename. Examples of non-obvious placements: TECH-002/003/004 (indexability and
rendering of money content) land in `risk`, not `hygiene`, per the critique's Tier 2;
LOCAL-001 (primary category) lands in `visibility`; ONPAGE-005 (intent match) lands in
`demand`.

**The rule that decided the ambiguous rows, recorded so slice 2 does not re-litigate
them.** A row is assigned by *the decision it drives*, not by the data its evaluation
needs. Three consequences worth stating, because each looks wrong at first glance:

- **Reviews (LOCAL-007/008/009/010) are `visibility`, not `competition`,** even though
  LOCAL-007's text says "versus local-pack competitors". Competitor data feeds *severity*
  everywhere; the decision reviews drive is pack presence. `competition` holds rows about
  whether we can win at all — links, authority, differentiation, aggregator dominance.
- **Content differentiation is `competition`; content structure is `demand`.** ONPAGE-004
  (first-hand experience, non-commodity), GEO-004 (fact density, pricing signals) and
  AUTH-006 (job photos, case studies) are differentiation — "what their content does that
  ours does not". ONPAGE-009 and GEO-003 (answer-first, self-contained passages) are
  query-answering structure. GEO-004 is the one a reader may push back on; the tiebreak was
  that its failure mode is commodity content, not a poorly-shaped answer.
- **TECH-011 (mobile viewport, tap targets) is `conversion`,** which is the critique's
  instruction applied literally: conversion is under-built for a phone business and "the
  category needs depth, taken from the technical category". Mobile rendering failure on an
  HVAC emergency search is a conversion failure first.

Actual distribution: measurement 7 · visibility 14 · demand 7 · competition 9 ·
conversion 10 · risk 12 · hygiene 21. After slice 2's ten retirements: measurement 6 ·
competition 8 · hygiene 13, everything else unchanged, 70 active — which lands measurement
and hygiene almost exactly on the shape the critique's §15 argues for.

## Open decision blocking slice 3: the distance threshold

`docs/CONTEXT-LIBRARY.md` open decision 3 already records this as a rubric question
("LOCAL-016 redesign — is distance-from-real-address the right test?"). Measured
distance needs a number, no number exists anywhere in code, and the number decides
whether a client's location pages are called doorway pages. **It is a rubric decision,
not an implementation detail, and it is marked as ours at its definition** (the pattern
`lib/scoring/config.ts` and `content-template-ratio.ts` both follow).

What the committed fixtures bracket, by real haversine distance from each anchor:

| Cohort | Range | Must be |
|---|---|---|
| Tornado `SERVED` (10 San Fernando Valley cities) | 2.5 – **11.1** mi | pass |
| Tornado `NOT_SERVED` (8 Orange County cities) | **35.8** – 48.1 mi | fail (`affectedUrls: 8`) |
| Healthy (3 Pasadena-area cities) | 0.0 – 3.0 mi | pass |
| The fabricated-fail reproduction in `gbp-station.test.ts` | 6.3 – 9.7 mi | not a fail |

So any threshold in **(11.1, 35.8)** preserves `affectedUrls: 8` and keeps the healthy
fixture passing — a 24-mile window. **Recommended v1: 25 straight-line miles**, the most
balanced point in it (2.25× the highest must-pass, 0.70× the lowest must-fail), with
drive time deferred until a client case needs it. Google's own guidance is that a
service-area profile should not extend beyond about two hours' drive; the research is
that the practical rankable radius in home services is far tighter than the serviceable
one, which argues for the low end of any defensible window rather than the high end.

**And one thing the threshold breaks that must be decided with it.**
`lib/eval/injectors/encodings.ts:328-334` registers a `geo-adjacent-county` defect
encoding whose own note says these cities are "close enough that **a mileage heuristic
would let them through**, but outside the declared service areas, so the profile cannot
rank for them." Measured from Sherman Oaks its five cities are 20.7 / 22.3 / 26.4 / 34.0
/ 41.8 mi — so at any threshold in the window the encoding *splits*, and its stated
premise becomes false. It breaks no test today, but leaving it is how a generator-built
fixture ends up asserting a magnitude its own linter recomputes differently. It must be
re-labelled or re-scoped in the same slice. **This is the real content of the decision:**
distance alone genuinely cannot separate "adjacent county the profile cannot rank for"
from "far suburb it can", which is the honest limit of a measured radius and the reason
slice 7's grid is the actual answer.

## Carried debt

Recorded when incurred rather than discovered later.

**Slice 10's delta renderer must gate on `config_version`.** The re-cut dropped
ONPAGE-003 from 85.95 to 14.325 for no site-side reason. `audit_runs.config_version` is
written and read back but compared **nowhere** outside the snapshot comparator, so a diff
of two runs across the `scoring-2026-08-06.1` → `scoring-2026-08-07.1` boundary would
render a rubric edit as a client improvement. Slice 10 must refuse to diff scores across a
version change, or label them. This is the first instance of that boundary and there will
be more — slices 5 and 6 each bump the version again.

**`lib/eval/manifest.ts` has no retired-awareness.** It validates that a manifest's check
id exists in the rubric and has a registered detector, but not that the row is still
active. Inert today (no retired row has a detector, so the detector check fires first), and
it becomes a live hole the first time a detector-backed row is retired — the manifest would
keep demanding a criterion the rubric stopped asking for. One clause in `loadManifest`; do
it when slice 6 next touches the manifests.

**`/llms.txt` is still fetched on every run, for a criterion that no longer exists.**
`lib/stations/robots.ts` requests it and carries it through `CrawlSiteRecord`; GEO-007 was
its only consumer and is now retired. One HTTP request per audit for nothing. Left in place
deliberately rather than ripped out during a data slice — removal touches the station
contract and both fixtures. Remove it when a slice next opens `robots.ts`.

**`lib/audit/questions.ts` is value-imported by a `'use client'` component.** It pulls zod
and all ~38 KB of `docs/rubric/rubric.json` — every `howToTest` and `notes` prose field —
into the `/tools/audit` browser chunk in order to read four fields per row. It also throws
at module load on a malformed rubric, which inside a client component is an unrecoverable
render error for the whole page rather than the "say so, don't blank the screen" behaviour
the file itself prefers. Accepted for now because the page is admin-only and the same throw
already happens server-side in `lib/scoring/rubric.ts` on every run, so a malformed rubric
breaks the pipeline before it reaches a browser. **The fix is to compute coverage
server-side and pass it as a prop**, which slice 4 should absorb: it already changes the
result envelope and adds diagnoses to the same view, so the props contract is open there
anyway. Do not let it drift past slice 4 — `audit_runs.result` is where a computed coverage
block belongs, and the longer the view owns the computation the more callers depend on it.

## The four breaking changes

Everything not listed here is additive.

1. **`rubric.json` gains `question` and `retired` fields and stops being the run's
   spine.** Retired rows are marked, never deleted (house rule: do not throw anything
   away), each carrying a `retiredReason` citing the research doc section. No code
   hardcodes 80 or 44 (verified), so denominators derive from the data; the re-cut
   ripples only into rubric-lookup consumers and the coverage partition.
2. **Coverage becomes per-question.** New `lib/audit/questions.ts`, pure partition
   over active rows; per-question rollup in the result envelope; panel and text report
   read questions. The old four-bucket sketch (evaluated / data-missing / no-detector /
   assisted) survives *inside* each question.
3. **Geography moves into the stations.** Stations are async; `evaluate` stays
   synchronous and pure. LOCAL-016 upgrades from set-membership to measured distance.

   **AMENDED 2026-08-07, before any code moved.** This said the gbp station gains
   "distances to targeted geographies" — and it cannot. `lib/orchestrator/run.ts:324`
   awaits crawl, gsc and gbp in one `Promise.all`, and running gbp concurrently rather
   than after the crawl is an explicit latency decision recorded at `run.ts:255-258`.
   `runGbpStation` therefore never sees `CrawlPageRecord.targetGeo`, so the per-target
   half of the measurement cannot live in it. The work splits:
   - **The anchor geocode stays in the station** — it needs only
     `storefrontAddress ?? businessCity`, which the station already has, and it runs
     concurrently with the two existing v4 review/media reads at no latency cost. It
     must assign a defined `geo` value on every path, because `completeRecord` refuses
     to emit *any* record when a `GBP_FIELD_SOURCES` field is `undefined` — a geocode
     failure that took LOCAL-003 down with it would be a self-inflicted outage.
   - **Per-target distances move to a new `withGeography(gbp, crawl, deps)`**, called
     from `run.ts` after the `Promise.all`, exactly mirroring `withSiteFiles` at
     `run.ts:371`. Concurrency preserved, no `StationBundle` widening (that stays
     slice 7's), and the alternative — serializing gbp after crawl — would reverse a
     documented decision to buy nothing.

   The cost of the split, stated: the gbp slot is written twice, so the target field has
   two writers. Mitigation is structural — the station can only ever produce the
   `measured: false` state, `withGeography` is the only code that can produce
   `measured: true`, and a test asserts that a bundle which never went through
   `withGeography` yields `not_run` rather than `pass`. That closes the forgot-to-wire
   hole that produced every stale comment this codebase has had to correct.

   Two further corrections to the slice as written: **per-*declared-area* distances must
   not enter the verdict** (the rubric row's own note says an SAB ranks by proximity to
   its real address, not its declared areas, and the `serviceAreas` field ledger says
   LOCAL-016 must not read it as a coverage boundary) — they are evidence, useful to
   slice 4's proximity diagnosis. And the slice **does** need a snapshot re-baseline,
   which its row omitted: LOCAL-016's `detail` string is frozen byte-for-byte because
   the snapshot stores it. The magnitude does not move (see the threshold note below),
   so that diff is one line.

   **What slice 3 delivers is a *measured* radius, not a *rankable* one.** Only the
   Local Falcon grid in slice 7 can establish rankability. The comment block slice 3
   writes must say so, or slice 7 arrives at another comment claiming the job is done.
4. **Scoring grows `winnability` and `confidence` axes** and takes the CTR curve as a
   per-client input with the config curve as labeled fallback. Rank becomes
   `impact × winnability × confidence-weight / effort`. Every axis persisted separately
   in `ScoreInputs`; each change bumps `SCORING_CONFIG.version` and forces a reviewed
   snapshot re-baseline.

## Sequence

| # | Slice | Observable deliverable | Files (main) | Verified beyond tsc/test/build | Migration |
|---|---|---|---|---|---|
| 1 | **Question taxonomy + coverage-by-question** ✅ **DONE** | The result view and text report lead with seven question rows, never "N of 80". Real shape on the tornado fixture (all 8 detectors evaluating): measurement 1/7 · visibility 2/14 · demand 1/7 · **competition not measured (9)** · conversion 1/10 · risk 2/12 · hygiene 1/21. | EDIT `docs/rubric/rubric.json` (`question` on all 80 rows, inserted after `category`); NEW `lib/audit/questions.ts` (pure partition + four-bucket coverage + `summariseQuestion`); EDIT `lib/orchestrator/report-text.ts` (`formatQuestions`, placed second, before the stations), `components/audit/AuditResultView.tsx` (`QuestionPanel`, first card after the header); NEW `tests/unit/audit-questions.test.ts`, `tests/unit/audit-question-panel.test.tsx` | Tests assert every active row lands in exactly one question, that the four buckets sum to each question's total with no id in two, that an empty run keeps every denominator, and that `competition` is empty — which is the finding, not a defect. The panel test is the repo's first `*.test.tsx`: the deliverable is a screen, and a pure coverage test cannot fail if the panel is never mounted. | none |
| 2 | **Rubric re-cut** ✅ **DONE** | 70 active + 10 retired. Per-question denominators now read measurement 6 · visibility 14 · demand 7 · competition 8 · conversion 10 · risk 12 · hygiene 13. Active criticals 9 → 12. | EDIT `docs/rubric/rubric.json` (10 × `retired` + `retiredReason`, 6 severity edits, 11 append-only notes edits); EDIT `lib/scoring/config.ts` (version → `scoring-2026-08-07.1`, and its **scope widened** to cover rubric-sourced severity/effort — see below); RE-BASELINE both `scoring.snapshot.json`; EDIT `tests/unit/{scoring,orchestrator,audit-questions,audit-question-panel}.test.*` | Snapshot diff reviewed line by line and it is **only** ONPAGE-003: severityWeight 6→1, rawImpact 1719→286.5, impact and priorityScore 85.95→14.325 (exactly ÷6), band P1 unchanged, rank 1→4, with MEAS-001/ONPAGE-006/TECH-011 each moving up one slot and no number of their own changing. `totals` byte-identical; healthy fixture only bumps its version string. The other five severity edits are on checks with no detector, so they moved nothing — as predicted. | none |
| 3 | **Geography at the station** | LOCAL-016 returns a distance-based verdict on Tornado-shaped data: Orange County pages flagged at 45–65 mi from the Sherman Oaks point, with precision and failure reasons surfaced, not fabricated zeros. | EDIT `lib/stations/gbp.ts` (geo block: geocode business address, per-declared-area and per-targeted-geo distances; typed failures → `not_run` reasons, never 0 mi); EDIT `lib/findings/checks.ts` LOCAL-016 (consume measured distances; fix stale comment at :465-466); EDIT `tests/unit/eval-units.test.ts:250`, `tests/unit/gbp-station.test.ts:648` (stale comments); EDIT fixtures' `stations.ts` (geo block) | The three stale "unwired" comments are gone (grep). A geocode failure yields `not_run` with the typed reason — asserted, because the geo module's own rule is "no failure path may look like zero miles". | none |
| 4 | **Diagnoses layer** | The result view leads with 2–5 diagnosis cards, each citing its member assertions; findings become the evidence table beneath. | NEW `lib/diagnoses/{types,composites,index}.ts` (pure functions over findings + station data; hard cap 5, enforced in code and test); envelope `version: 1 → 2` (`diagnoses` array in `audit_runs.result`; `readStoredResult` accepts both); EDIT `AuditResultView.tsx` (diagnosis cards); EDIT `report-text.ts` | Composites at launch, all buildable from existing data: **cannibalization** (ONPAGE-006 clusters + GSC), **boilerplate-dominant** (ONPAGE-012 + template groups), **proximity mismatch** (slice 3's distances + targetGeo pages), **doorway composite** (page count + template ratio + thin flags), **visibility-without-conversion / conversion-without-visibility** (deferred to slice 7 — they need SoLV; registered as named stubs that emit nothing). Tornado must produce the cannibalization + boilerplate diagnoses and must NOT produce a "more pages" shaped anything. | none (jsonb envelope bump) |
| 5 | **Keyword/demand layer v1 — GSC-only** | A `demand` block in the run: keyword universe, clusters with intent tags, per-client CTR curve, and the first `stuck_keyword`-basis check (opportunity detector) scored through the basis that has been waiting for it since 2026-08-06. | NEW `lib/keywords/{universe,clusters,intent,ctr-curve}.ts`; NEW detector `lib/findings/detectors/opportunity.ts` (maps to `stuck_keyword`; `BASIS_RULES` entry — the rule already half-exists per fact 8); EDIT `lib/stations/gsc.ts` or a derived step to expose query-level rows to the layer; wire `clients.service_context` job values into impact terms (first pipeline read of `service_context` — fact 14); EDIT rubric.json (new `demand` rows, added not retrofitted); bump `SCORING_CONFIG.version`; RE-BASELINE snapshots | CTR curve built from post-2025-09-10 GSC only (num=100 discontinuity is a hard boundary in code, with a test); branded queries stripped via client brand terms; curve falls back to config with a visible label when the client lacks data volume. Clustering v1 is deterministic (normalized-token grouping + the existing exact-query clusters); embedding/SERP-overlap upgrades wait for slice 7 — no model adjudicates anything. Job-value terms appear in `score_inputs.terms` so a revenue-weighted number can be explained. | none |
| 6 | **Scoring v2** | Rank = impact × winnability × confidence-weight / effort, every axis visible in the score trace. | EDIT `lib/scoring/{types,score,config}.ts` (axes; per-client curve param — the seam exists, fact re: `opportunity-sizing.ts`); confidence enum `established \| judgment \| untestable` sourced from rubric rows (new field, data work); winnability v1 from GSC-observable signals (position dispersion, aggregator share detectable from ranking URLs' domains), upgraded by slice 7; EDIT `AuditResultView.tsx` score trace; bump version; RE-BASELINE | The snapshot diff reviewed line by line; every moved rank explained aloud. A finding with `confidence: untestable` renders its label in the trace and the report. | none |
| 7 | **Vendor stations: `grid` + `serp`** | SoLV per location from a real Local Falcon scan; pack-vs-organic tags and competitor entities from DataForSEO; the two deferred diagnoses (visibility-without-conversion and its inverse) light up; LOCAL-016's radius becomes rankable-radius, not declared-radius. | NEW `lib/connectors/{local-falcon,dataforseo}.ts`; NEW `lib/stations/{grid,serp}.ts`; EDIT `lib/findings/types.ts` `StationBundle` (+2 slots) — touches `lib/orchestrator/{types,run}.ts` (StationSlot union, runStatus considered-slots decision), `lib/eval/lint.ts`, both fixtures' `stations.ts`, `AuditResultView.tsx` STATION_ORDER (fact 16: it is hardcoded) | Both stations follow the existing contract (this is the payoff of keeping it): unconfigured → `not_run` with reason; API failure → `failed` station, checks `not_run`, never `pass`. A grid scan for Tornado reproduces the known shape: strong near Sherman Oaks, invisible in Orange County. Cost guards: per-scan credit ceilings in config, quota exhaustion → `degraded` with a note, never a retry wall (the PageSpeed lesson). | none |
| 8 | **Synthesis + review gate** | Click Synthesize on a stored run: a drafted narrative per diagnosis, badged DRAFT; approve/edit/reject per recommendation with before/after recorded. | NEW `lib/synthesis/{prompt,synthesize,validate}.ts`; NEW `app/actions/{audit-synthesis,audit-review}.ts`; NEW `components/audit/{SynthesisDraft,ReviewControls}.tsx`; MIGRATION (the plan's first): `audit_recommendations`, `audit_recommendation_reviews`, `synthesis_draft jsonb` + `synthesized_at` + `cohort text` on `audit_runs` (cohort is the one future-proofing column, nullable, no backfill); `lib/eval/citation.ts` gets its first production consumer (fact 12) | Validators written red first: fence-tolerant parse; checkId whitelist; per-recommendation numeric whitelist against that finding's evidence/terms; critical completeness; vacuity via `citationValidity`; **diagnosis integrity** (every recommendation names a diagnosis from the run; count ≤ 5; the model may not mint diagnoses). Kill the Anthropic key → deterministic ranked plan renders with a visible marker. Grep proves one `anthropic.messages` call in the pipeline and zero arithmetic on impact/winnability/severity/effort in `lib/synthesis/`. Generated P1s read against §9's manual P1 list; no volume recommendation survives. | **yes — SQL reviewed before apply** |
| 9 | **Client rendering, question-gated** | A client-facing rendering exists behind a gate: publishable only when questions 1–3 are answerable for that client. Six sections: where you stand · what's holding you back (diagnoses) · what we'll do · what we're not doing · what we couldn't evaluate (per-question, plain language) · appendix. | NEW render path + publish action + client RLS policy (the first client policy on any audit table, reviewed on its own); reuses reviewed recommendations only | The gate is asserted in code and test: a run with 60 hygiene assertions and no demand layer is not publishable; a run answering Q1–Q3 with 20 assertions is. `tel:`-click numbers are labeled as such wherever call tracking is absent. | **yes** |
| 10 | **Delta + cohort rendering** | Second-run diff (what changed, what shipped and what it did, what we said last time and were wrong about); Apex rollup grouped by template/cohort. | NEW diff renderer over two `audit_runs` rows (they already are the history); cohort rollup reads the slice-8 column | A diff needs two real runs on one client; verify on Tornado run 1 vs run 2 after any slice ships changes. | none |

Standard gates every slice: `npx tsc --noEmit` → `npm test` → `npm run build`, commit
and push, fresh verification agent that did no implementation. Do not deploy unless
told. No new npm packages anywhere in slices 1–6 (embeddings, if adopted later, use the
existing `openai` dep — a decision for slice 7's SERP-overlap work, not before).

## The rubric re-cut (slice 2 data work, specified here)

Per the critique Part Nine §§11–13, with each edit carrying its citation in
`retiredReason`/`notes`:

**Retire** (marked `retired: true`, never deleted): TECH-014 (merge into TECH-013),
TECH-017 (keyword URLs — Mueller: minimal effect), TECH-019 (hreflang — conditional
only for US-only home services), TECH-020 (custom 404 — merge to hygiene note),
ONPAGE-002 (meta descriptions — demote to logged attribute; Google rewrites most),
GEO-006 (merge into TECH-013), GEO-007 (llms.txt — no engine consumes it), TECH-018
(faceted URLs — conditional), AUTH-004 (merge into AUTH-003 as one off-site monitoring
line), MEAS-006 (monitoring, not a scored check).

**Severity edits**: ONPAGE-003 high→low (multiple H1s are fine; heading hierarchy is
minor). LOCAL-005 →medium (NAP is real but routinely overstated; must rank below
reviews). LOCAL-007/008/010 →critical (review volume/velocity vs competitors is the
single best local lever after category and calls — Whitespark 2026). TECH-010
high→medium with a CrUX-not-PageSpeed note (field data is the signal; lab is
diagnostics). ONPAGE-008 is already `low` (verified) — notes edit only, recording that
its value is accessibility/image search, not rankings.

**Wording fixes**: GEO-002 gains the Gemini exception (AI crawlers don't execute JS —
except Google's, which inherits Googlebot rendering). MEAS-002 gains the DNI-vs-static
distinction (DNI preserves NAP; static replacement breaks it).

None of these rows is a registered check except ONPAGE-003 (severity only), so the
blast radius is data + one snapshot re-baseline.

**Landed, with two things worth recording.** (1) `SCORING_CONFIG.version`'s documented scope
was "any value in this file", and severity is not in that file — it comes from the rubric.
A severity edit therefore changed scores while the version string stayed truthful, which
would let `audit_runs.config_version` describe two different rubrics with one string and
defeat the field's whole purpose (explaining a stored number later). The scope is now "any
input to a score", and the comment says so. (2) The critical set went 9 → 12, and the test
that guarded it asserted the *count*. A count was never the thing that made the top-K rule
cheap — the derived property is: nine of the twelve criticals have no detector, so at most
three can ever be scored, which is under `topK` of 5. That test now asserts the property, so
it turns red when a critical detector is **registered** rather than when a severity is
edited, which is the moment someone should actually re-check the rule.

## Schema (slice 8, the plan's only new tables)

Findings stay in the `audit_runs.result` blob — the deferral recorded in
`20260807050000_audit_runs.sql:3-8` stands until a cross-finding query exists (the
Apex "every open critical finding across the fleet" query is that trigger, and it is
not in this plan). Diagnoses also ride in the blob (envelope v2, slice 4): they are
deterministic per-run values with no per-item state. **Recommendations get rows**
because review state is per-item and the review trail is the eval corpus:

```sql
create table if not exists public.audit_recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.audit_runs(id) on delete cascade,
  diagnosis_key text not null,          -- which diagnosis owns it; '' is invalid
  check_ids text[] not null default '{}'::text[],
  title text not null,
  body text not null,
  rationale text,
  execution_model text not null,        -- derived from rubric effort × automation, never model-authored
  rank int,
  confidence text check (confidence in ('established','judgment','untestable')),
  review_state text not null default 'draft'
    check (review_state in ('draft','approved','edited','rejected')),
  edited_title text, edited_body text,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_recommendation_reviews (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.audit_recommendations(id) on delete cascade,
  action text not null check (action in ('approve','edit','reject')),
  before jsonb, after jsonb,
  reason text,
  actor uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint reject_edit_requires_reason
    check (action = 'approve' or reason is not null)
);

alter table public.audit_runs add column if not exists synthesis_draft jsonb;
alter table public.audit_runs add column if not exists synthesized_at timestamptz;
alter table public.audit_runs add column if not exists cohort text;
```

RLS: admin-only `for all` with both `using` and `with check` on both tables, following
the `audit_runs` precedent. **No client policy in slice 8.** Slice 9 adds the first
client SELECT policy as its own reviewed migration, scoped to published recommendations
only. The recommendation lifecycle *is* the tracker (D5, §11); no separate tracker
table now or later.

## The one LLM call (slice 8)

One `anthropic.messages` call in `lib/synthesis/synthesize.ts`, invoked on a stored
run. Verified: today there are **zero** Anthropic calls anywhere in the audit pipeline
(grep across lib/audit, orchestrator, ingest, scoring, stations, findings, and the
audit routes returns nothing), and this plan keeps it that way until slice 8.

**Input**: the diagnoses (capped list), scored recommendations-in-waiting (checkId,
axes, evidence, examples), the per-question coverage summary, and client context from
`service_context`. The prompt states which questions were not evaluated and forbids
volume recommendations explicitly.

**May**: select, order, and narrate — title/body/rationale prose per diagnosis and
recommendation.

**May not**: mint a diagnosis, emit a checkId not in input, state a number absent from
that finding's evidence/terms, omit a critical fail, or author severity, effort,
impact, winnability, confidence, rank, or `execution_model`.

**Validators** (red first, all degrading to the deterministic output, never to an
error): fence-tolerant parse · checkId whitelist · per-recommendation numeric whitelist
· critical completeness · vacuity (`citationValidity`) · diagnosis integrity (every
recommendation names an input diagnosis; total diagnoses ≤ 5).

## Sequenced around the owner

Nothing in slices 1–6 is blocked by an owner-side item. Clear these in this order:

| When | Do | Unlocks |
|---|---|---|
| Before slice 3 | Confirm `GOOGLE_PLACES_API_KEY` is set in Vercel + Geocoding **and Distance Matrix** APIs enabled on the Google Cloud project | Slice 3's measured distances (the module reads that env var) |
| Before or during slice 5 | Rough job value per service line for Tornado (owner numbers, captured via onboarding into `service_context`) | Revenue-weighted impact; without it the layer runs with CPC-proxy or unweighted labels |
| Before slice 7 | **Local Falcon** account (pilot tier ~$25–50/mo) and **DataForSEO** key (pay-as-you-go) | Both vendor stations; the grid is the visibility baseline everything is relative to |
| Any time | Sitebulb re-run with the correct template (`docs/sitebulb-audit-setup.md §8`) | 7 rubric checks when the late detector batch lands |
| Any time | GBP container split + reconcile the two `gbp_account_id` values | Post-plan GBP checks; slice 1 of the old plan already fails closed |
| Client-side, whenever won | Call tracking (CallRail via DNI) | Until then every call number is a `tel:` click and is labeled as such in every rendering |
| The long pole | 3–5 past audits + shipped plans marked for what moved results | The only honest quality assessment of slice 8's output; also the corpus that could ever justify agent execution |

## Deliberately not building

- **A normalized `audit_findings` table.** Deferral stands until the cross-brand
  query exists. Revisit at Apex fleet onboarding, not before.
- **Detectors for the remaining ~28 Sitebulb-backed checks — until after slice 8.**
  Cheapest work, least decision-changing; they are the *last* batch, and the
  per-question coverage panel keeps the gap honest in the meantime.
- **Per-keyword call attribution.** The research ceiling is
  cluster → landing page → call; the pipeline models exactly that and no finer.
- **LLM-citation tracking tools** (Profound, Peec, et al.). Vendor-marketing category
  per both research docs; monitor AI-surface impressions in GSC instead. Revisit only
  if a client's LLM referral traffic exceeds ~1–2% of organic sessions.
- **GSC BigQuery export.** The API + 6h cache is sufficient at 4 clients; BigQuery is
  an Apex-scale unlock. When it lands, it fixes the dateless-cache-key quirk as a side
  effect.
- **Embeddings anywhere a status is adjudicated.** Clustering v1 is deterministic;
  if slice 7 adopts embeddings for draft clustering, they remain data acquisition,
  SERP-validated before any page decision, and never decide pass/fail (failure mode 7).
- **The WordPress plugin and tier-1 execution.** Unchanged from the predecessor:
  deferred until `audit_recommendation_reviews` has months of rows.
- **Fleet scheduling.** Unchanged: nothing here blocks it later; running an incomplete
  instrument across 107 brands multiplies whatever is wrong by 107.
- **A geo-grid build-your-own.** Local Falcon is bought, not built (D3's buy-the-crawl
  logic applied to the grid; cheap SERP APIs don't replicate proximity handling).

## Honest cost

| # | Slice | Sessions | Why |
|---|---|---|---|
| 1 | Questions + coverage | 1 | 80 rows of data work + one pure module + two renderers |
| 2 | Rubric re-cut | 1 | Data edits + one reviewed snapshot re-baseline |
| 3 | Geography at the station | 1–2 | The geo module exists and is tested; the work is station assembly, failure-path honesty, and fixture updates |
| 4 | Diagnoses layer | 2 | Four composites with tests + envelope v2 + two renderers; the cap and the Tornado must-diagnose assertions are the substance |
| 5 | Keyword layer v1 | 2 | Universe, deterministic clusters, CTR curve with the discontinuity boundary, opportunity detector, first `service_context` read |
| 6 | Scoring v2 | 1 | Axes + config + one reviewed re-baseline |
| 7 | Vendor stations | 2–3 | Two connectors, two stations, a 2-slot bundle widening that touches five files, live-scan verification |
| 8 | Synthesis + review | 2 | Six validators red-first, migration, review UI, one live call read against §9's manual P1 list |
| 9 | Client rendering | 2 | The gate, the six sections, the first client RLS policy |
| 10 | Delta + cohort | 1 | Two renderers over existing rows |

**Total: 15–17 sessions; budget 18.** Slices 4, 7, and 8 are the likely overruns. The
eval golden cases migrate incrementally: tornado's manifest gains a `must_diagnose`
list in slice 4 while `must_find` keeps running — both gates green through the whole
transition, and the old one is removed only when the new one has caught a real
regression (the same earn-your-keep rule the snapshot gate follows).
