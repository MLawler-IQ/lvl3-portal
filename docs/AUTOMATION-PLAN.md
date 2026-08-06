# Automation wrap-up plan

The working document for finishing the pipeline described in
[AUTOMATION-CONTEXT.md](AUTOMATION-CONTEXT.md). That file is the *context* — the goal, the
rubric, the architecture, the failure modes. This file is the *plan*: what gets built, in
what order, and what deliberately does not get built.

**Written 2026-08-06.** Produced by three independent planners working from different
lenses — shortest-path-to-demo, never-ship-a-wrong-finding, and pure dependency order —
each critiqued adversarially for scope inflation and LLM creep, then synthesised into one
decision. Where they disagreed the synthesis picked and said why.

## Status

| Slice | State | Commit |
|---|---|---|
| 1 · GBP reads fail closed | ✅ **DONE** | `fa08ce6` |
| 2 · Source seam + stations + orchestrator | ✅ **DONE** | `fed359a`…`f115cf3` |
| 3 · Upload + admin screen | not started | |
| 4 · Persistence | not started | |
| 5 · Coverage report + criterion declaration | not started | |
| 6 · Detector batch (8) | not started | |
| 7 · Synthesis + review gate | not started | |

### What slice 2 learned, worth carrying into slice 3

1. **Two imports must stay lazy.** `buildToolContext` and `fetchGSCRows` both reach
   `lib/supabase/server` and therefore `next/headers`, which does not resolve outside the
   Next runtime. Imported statically they made an `--offline` run fail at *load* time,
   before the stations it was skipping were reached. Slice 3's route handler will not
   notice, but any future script will.
2. **A missing `mobile_friendly.csv` makes TECH-011 `not_run`, not `degraded`.** With zero
   measured pages `coverageStatus` returns `not_run` *before* the engine's ceiling is
   consulted, and `engine.ts` only ever rewrites a `pass`. So that case cannot demonstrate
   the degraded cap; the case that does is a missing **`indexability`** export, where
   TECH-011 still measures cleanly and the surviving `pass` is capped. The plan's gate
   ("TECH-011 never `pass`") holds either way.
3. **The station strip must not print `reason` when it equals `evidence.detail`.** The
   engine's `notRun` helper sets both to the same string, so every `not_run` row rendered
   as "gbp station not provided (gbp station not provided)". Slice 3's `FindingsTable` will
   hit this the moment it renders both fields.
4. **`AuditRunResult` carries no export label, client name or mode** — the crawl source has
   no name, the client id is not echoed back, and "mode" is a caller's concept. The text
   formatter takes them as an optional `ReportMeta`; slice 3's screen needs the same.

Slice 1 shipped ahead of the plan being written — the risk-first planner found the leak
while grounding, and it was live in the client-facing dashboard, so it went out
immediately. It landed as **fail-closed only**, exactly as the plan's fact 4 prescribes:
scoping by label was attempted and backed out, because the one value the tests anticipate
(`'Ungrouped'`) matches nothing, and adding `labels` to `LOCATION_READ_MASK` is unverified
against the live API where an invalid field is a 400 on every GBP call.

**Consequence of slice 1, outstanding:** all three clients holding a `gbp_account_id` have
`gbp_location_group` null, so their GBP tab is dark until it is set to an
`accounts/...` location group or to `*` (an explicit "this whole account is this
client's"). Nobody was exposed before the fix — those clients have zero client-role users
between them.

## Two things this plan overturns

Recorded because both were stated earlier in the session and both were wrong.

1. **Record-and-replay should NOT replace the hand-built eval fixtures.** The earlier
   position was that converting the tornado fixture to a replay of real station output was
   the next step once the Sitebulb re-run existed. The plan argues the opposite and is
   right: the manifest transcribes §9's figures, which the real export deliberately does
   not reproduce (see fact 2), so a replay would silently re-baseline ground truth that
   was written down before any pipeline code existed. That uncircularity is the harness's
   entire value. Assert against the *recorded* ingest block instead.
2. **Auto-tier coverage is 5 of 44, not 8 of 44.** Only 5 of the 8 registered detectors
   are `automation: auto`; MEAS-001, ONPAGE-006 and LOCAL-016 are `assisted`.

## How to use this file

Update the status table as slices land. When a slice's reasoning turns out wrong — as
slice 1's scoping approach did — amend the slice in place and say what changed, rather
than leaving the plan describing something nobody built. The value of the file is that it
records *why*, and a why that no longer matches the code is worse than no file.

---

## The decision

Build the audit pipeline as an **admin-only internal tool** and stop there: fail-close the live GBP leak, put a source abstraction under the Sitebulb ingester, wire a two-station orchestrator, persist runs and findings in two tables, ship one admin screen, take registered detectors from 8 to 16, then add the single synthesis call behind a review gate that writes to a draft column only. The finishing line is an admin who can upload a Sitebulb export for any client, get a ranked evidenced plan with an honest coverage statement, edit and approve it, and have that decision recorded. **No client-visible audit report is in this plan** — at 14 of 80 rubric criteria evaluated, publishing one is failure mode 1 wearing a client-facing skin, and that cut removes an entire risk class rather than mitigating it.

### Four verified facts that move the plan

1. **`CHECKS` has 8 entries, and only 5 are `auto`-tier.** `checks.ts:452-464` is seven named checks plus `...DERIVED_CHECKS`, and `DERIVED_CHECKS = [onpage012]`. MEAS-001, ONPAGE-006 and LOCAL-016 are `automation: assisted` in `rubric.json`. Real auto coverage is **5 of 44 (11%)**, not 18%. First screen is 8 rows with 2 `not_run`, not 13 with 6.
2. **The real export does not reproduce the manifest's magnitudes, by design.** `tests/unit/sitebulb-ingest.test.ts:197-218` records the actual 2026-08-06 ingest: `urls: 206`, `zeroH1Pages: 191`, `untaggedPages: **202**`, ONPAGE-003 affected **194** ("191 with none + 3 with several"), TECH-011 **101 of 202 measured**, MEAS-001 **202 of 206**. The manifest's 191/92/187 transcribe §9's documented figures against the *hand-built* fixture. **Every gate in all three proposals asserted the wrong numbers.** Gate against the recorded block, never `manifest.json`.
3. **The degradation rule is derivable today, and it is one line.** `filesMissing` can only ever contain `indexability` or `mobile_friendly` (`crawl.ts:165,167`) — both back registered checks, and an untriggered hint never lands there. Meanwhile `bump('internalLinksOut')` is unconditional (`crawl.ts:214`), so `unmeasured.internalLinksOut === pages.length` on every export forever, and the only consumer is `visibility-cohort.ts:121`, which `DERIVED_CHECKS` deliberately does not wrap. So: **`degraded` iff `filesMissing.length > 0`.** Degrading on `unmeasured` makes the crawl station permanently degraded and no crawl-backed check can ever return `pass` (`engine.ts:87-93`).
4. **`clients.gbp_location_group` cannot be used as a `parent`.** Written by `promote.ts:67`, `clients.ts:152`, `ClientSettingsForm.tsx:329`; read by **zero queries**. Its column comment says "location-group / **label** filter" and `onboarding-promote.test.ts:64` asserts the stored value `'Ungrouped'`. `LOCATION_READ_MASK` omits `labels`, so client-side filtering is impossible too. Slice 1 is therefore **fail-closed only** — scoping is real work, scheduled separately.

## Sequence

| # | Slice | Observable deliverable | Files | Verified beyond tsc/test/build | Closes |
|---|---|---|---|---|---|
| 1 | **GBP reads fail closed** | Selecting a client whose GBP scope is unconfigured renders "GBP location scope not configured" instead of 50 locations from every client. No GBP call can run unscoped. | `lib/connectors/gbp.ts` (`listGBPLocations` gains a **required** `scope`; `fetchGBPClientInsights:471` and `auditGBPAccount:586` thread it and bump cache keys `v2→v3` / `gbp:account-audit:v2:` so the existing 18h unfiltered payloads can't be served); `app/actions/dashboard-gbp.ts:66` (widen select, return `{configured:false, reason:'gbp_scope_unconfigured'}`); `components/dashboard/modules/LocationLeaderboard.tsx`, `LocationCompleteness.tsx`; `lib/ask-lvl3/tools/gbp.ts` (scope injected from `ctx`, **never** from a model-chosen `titleFilter`); `tests/unit/gbp-scope.test.ts` | Matt on production with Tapps selected: the GBP tab reads "not configured", not 50 locations. Unit test asserts an unscoped call returns an error envelope and that the v3 key differs from v2. | — |
| 2 | **Source seam + stations + orchestrator** ✅ **DONE** `f115cf3` | `node --import ./scripts/ts-alias-hook.mjs scripts/audit-dry-run.ts <dir> --offline` prints the station strip and all 8 findings with statuses, impact, rank, and each `ScoreInputs.formula`. TECH-001 returns a real verdict for the first time. | NEW `lib/ingest/sitebulb/source.ts` (`CrawlExportSource: list()/read(name)`; `LocalDirSource`, `BufferSource`); ~~EDIT `csv.ts` (expose `toTable(parseCsv(raw))`; `readCsvTable` stays for local)~~ — `parseCsv`/`toTable` were **already exported**, and `readCsvTable` was **deleted**: after the port it had zero callers and no test, and leaving a filesystem reader in `csv.ts` is how the next caller bypasses the seam; EDIT `crawl.ts` (`ingestSitebulbCrawl(source)`; `readdir`/`readFile` leave the file); NEW `lib/stations/degradation.ts` (pure, the **only** home of the rule); NEW `lib/stations/crawl.ts` (`runGuarded`+`toolOk`, absorbs the `*_internal.csv` throw, and calls `readSitebulbManifest` so `SitebulbManifest.problems` becomes the `ToolOk.notes` it was documented to become); NEW `lib/stations/gsc.ts` (~12 lines over `fetchGSCRows(site, **90**)`); NEW `lib/stations/robots.ts` (fetch `/robots.txt` + `/llms.txt`, merge into `CrawlStationData.site` — **not** a fourth slot); NEW `lib/orchestrator/run.ts`; NEW `scripts/audit-dry-run.ts`; EDIT `tests/unit/sitebulb-ingest.test.ts` | Real 206-URL export reproduces the **recorded** block: 206 / 191 zero-H1 / 202 untagged / `unmeasured {internalLinksOut:206, hasViewportMeta:4, tapTargetsOk:4, canonical:4}`, ONPAGE-003 **194**, TECH-011 **101**, MEAS-001 **202**. Delete `*_mobile_friendly.csv` from a copy → station `degraded`, file named, TECH-011 never `pass`. Delete `*_internal.csv` → `ToolErr`, not a throw. Station runs record with `client_id: null` (see schema note). | **A** |
| 3 | **Upload + admin screen** | An admin at `/tools/audit` drags a Sitebulb zip, clicks Run, and reads the station strip, all findings with `not_run` given equal visual weight, and the ranked plan with an expandable score trace. First file in `app/` to import `lib/findings`. | NEW `lib/ingest/sitebulb/zip.ts` (jszip, already a dep; rejects traversal; validates `*_internal.csv` before anything else; feeds `BufferSource` — **no storage bucket, no migration**); NEW `app/api/audit/upload/route.ts` (manual auth check, not `requireAdmin()`); NEW `app/actions/audit.ts`; NEW `app/(dashboard)/tools/audit/page.tsx`, `components/audit/{ExportUpload,StationStrip,FindingsTable,PlanTable,ScoreTrace}.tsx`; EDIT `components/sidebar.tsx` (one entry) | Same zip through the browser yields byte-identical numbers to slice 2's local run. Zip minus `internal.csv` → explanatory error, never a zero-page station. The provenance column renders `finding.source`, **not** `rubricEntry(id).dataSource` — MEAS-001's rubric row says `ga4` while its detector reads `crawl`. | **C** |
| 4 | **Persistence** | Reload the page and the run, every finding, and every rank come back from Postgres. A second run is a second history row. | NEW `supabase/migrations/*_audit_runs_and_findings.sql` (SQL shown verbatim before apply); NEW `lib/audit/persist.ts`, `lib/audit/read.ts` (list + load only, **no diff**); EDIT `app/actions/audit.ts` (persist strictly **after** `scoreFindings`); NEW `tests/unit/audit-purity.test.ts` | `npm test` green with **no Supabase env vars set** — the purity test asserts the transitive import graph of `engine.ts` and `score.ts` never reaches `@/lib/supabase`. Non-admin JWT gets zero rows from both tables. Two runs of the same **fixture bundle** (not a live station — `fetchGSCRows` caches 6h with no dates in the key) produce identical `score_inputs.terms`. All 16 findings persist including `not_run`. | **B** |
| 5 | **Coverage report + criterion declaration** | The screen leads with "14 of 80 rubric criteria evaluated" and a four-bucket breakdown, and MEAS-001's clean row carries a "2 of 3 criteria evaluated — key-event configuration not checked" badge. | NEW `lib/audit/scope.ts` (ordered, exhaustive partition of the 80 rubric rows — a row lands in exactly one bucket; all string constants, no LLM); EDIT `lib/findings/types.ts` (`CheckDefinition.criteria?: { evaluated: string[]; notEvaluated: string[] }`); EDIT `checks.ts` (declare for MEAS-001, TECH-011, TECH-001, LOCAL-003); NEW `components/audit/CoveragePanel.tsx`; `tests/unit/audit-scope.test.ts` | A test asserts the four buckets sum to exactly 80 with no row double-counted, and that removing a detector from `CHECKS` moves its id from `evaluated` to `no_detector` and lowers the numerator. The denominator is asserted to be 80 — a test fails if it is ever 44 or 16. | **E** (honesty half) |
| 6 | **Detector batch: 8, all on existing data** | Registered 8 → 16. Auto 5/44 → 13/44. Critical 3/9 → **4/9**. | NEW `lib/findings/detectors/{tech-003,tech-006,tech-016,tech-017,onpage-001,onpage-002,geo-001,geo-007}.ts`; EDIT `detectors/index.ts`; **EDIT `lib/scoring/score.ts` `BASIS_RULES` — 8 new entries** (`tests/unit/scoring.test.ts:232` makes omission a red build); EDIT `lib/eval/injectors/predicates.ts` MAGNITUDE map (`lint.ts` rejects a manifest id without one); EDIT both fixture `stations.ts` + `manifest.json`; RE-BASELINE both `scoring.snapshot.json` | The two snapshot diffs go in front of a human line by line, and every moved `terms` value is explained aloud — that is the gate. Every new `fail` on the real export is confirmed against the live URL before the snapshot is accepted. `eval-gate.test.ts:57`'s `toHaveLength(6)` and its comment are updated deliberately, never loosened. A test fails if `EVAL_SNAPSHOT_UPDATE` is set during a normal run. | **E** (coverage half) |
| 7 | **Synthesis + review gate, admin-only** | Click Synthesize on a stored run: drafted recommendations badged DRAFT, each citing check ids and quoting only numbers that exist. Edit, approve or reject with a reason; before/after recorded. | NEW `lib/synthesis/{prompt,synthesize,validate}.ts`; NEW `app/actions/audit-synthesis.ts`, `audit-review.ts`; NEW `components/audit/{SynthesisDraft,ReviewControls}.tsx`; MIGRATION `*_audit_finding_reviews.sql` (the third table) + `synthesis_draft jsonb`, `synthesized_at` on `audit_runs`; `tests/unit/synthesis-validate.test.ts` | Validator tests written **red first**. Kill the Anthropic key → the full deterministic ranked plan still renders with a visible "synthesis unavailable" marker, not an error. `grep` proves exactly one `anthropic.messages` call exists in the pipeline and zero arithmetic on impact/severity/effort in `lib/synthesis/`. Read the generated P1 list against §9's manual P1 list and confirm no "produce more service pages" recommendation. | **D** |

## The schema

**Two tables now. A third only if slice 7 ships.** That is fewer than any of the three proposals, and fewer than section 14's phase 3 implies. There is no `recommendations`, `plans`, `audit_stations`, `findings_history`, `tasks`, or `rubric_checks` table, and no storage bucket.

```sql
create table if not exists public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null check (status in ('running','complete','partial','failed')),
  trigger text not null default 'manual',
  station_status jsonb not null default '{}'::jsonb,  -- durable copy; see note
  coverage jsonb not null default '{}'::jsonb,        -- lib/audit/scope.ts output
  config_version text,                                -- ScoringResult.configVersion
  synthesis_draft jsonb,                              -- slice 7 only, never client-readable
  synthesized_at timestamptz,
  created_by uuid references public.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
```
Cannot be merged into `tool_runs`: that table's `status` CHECK is a *run* lifecycle, its payload is one opaque `output jsonb`, and `20260610000001_fix_tool_runs_rls.sql:18-32` grants SELECT to any user with `user_client_access` **with no published predicate** — so synthesis text in `tool_runs.output` would be client-readable the instant it is written. `station_status` is a snapshotted copy rather than a join because `20260610000003_tool_data_retention.sql:12-14` deletes terminal `tool_runs` after 90 days and an audit must outlive that. **Do not add an FK from here to `tool_runs`** or that sweep starts failing.

```sql
create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.audit_runs(id) on delete cascade,
  check_id text not null,
  status text not null check (status in ('pass','fail','degraded','not_run')),
  source text,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  severity text, category text, effort text,
  effort_weight numeric, severity_weight numeric,
  impact numeric, priority_score numeric, band text, basis text, rank int,
  score_inputs jsonb,                                 -- ScoreInputs verbatim
  unscored_reason text,
  review_state text not null default 'draft'
    check (review_state in ('draft','approved','edited','rejected')),
  edited_title text, edited_body text,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  unique (run_id, check_id)
);
```
Cannot be a jsonb blob on `audit_runs`: "every open critical finding across 107 brands" has to be an index scan, and per-finding review state has to be addressable. Scoring lives on the **same row** rather than a `recommendations` table because `ScoredRecommendation` is keyed on `checkId` 1:1 with a `Finding`; splitting them buys a mandatory join and a second place for the two to disagree. `score_inputs` needs no type change — `lib/scoring/types.ts:1-12` says `ScoreInputs` exists to be persisted and `lib/eval/snapshot.ts` already asserts it exactly.

```sql
alter table public.audit_runs    enable row level security;
alter table public.audit_findings enable row level security;

drop policy if exists "Admins manage audit runs" on public.audit_runs;
create policy "Admins manage audit runs" on public.audit_runs
  for all to authenticated
  using  (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
-- identical pair on audit_findings
```
`for all` with **both** `using` and `with check`, following `20260708000000_client_image_review.sql:49-59`. **There is no client SELECT policy on either table, in any slice of this plan.** Volume sanity: 16 findings × 107 brands monthly ≈ 1,700 rows/month. No partitioning, no archive table.

**Third table, slice 7 only** — `audit_finding_reviews (id, finding_id fk cascade, action check in ('approve','edit','reject'), before jsonb, after jsonb, reason text, actor uuid, created_at)` with a `reject/edit requires reason` CHECK (`20260708000000:36-38` precedent). It earns its table because it is append-only with real n:1 cardinality and §11 states it *is* the eval corpus, not an audit log — columns on `audit_findings` hold only the latest state, and the erased edit is the training signal. If slice 7 is cut, this table never exists.

**One non-obvious requirement in slice 2:** `finishRun` writes `output: { data: result.data, … }` — the whole 206-row `CrawlStationData` and the raw GSC rows. Combined with the `tool_runs` client policy above, recording station runs with a real `client_id` publishes the audit substrate to client-readable storage before any review gate exists. **Station runs must pass `clientId: null`**, keeping client attribution in `input`. Otherwise slice 4's isolation gate is cosmetic — the same numbers are readable one table over.

**Amended in slice 2, twice.** (a) This paragraph said attribution rides in `input._invocation`. It cannot: `startRun` *sets* `_invocation` itself, to `{ by, parentRunId }` for an orchestrator invoker, overwriting whatever a caller passed — so attribution has to be a sibling field, and it is `input.auditClientId`. (b) The policy reading is now verified rather than inferred: `20260610000001_fix_tool_runs_rls.sql:17-33` has three OR'd branches, and the first is `client_id is null and user_id = auth.uid()`. That branch does **not** rescue a station row — with `user_id` null it evaluates to `true AND NULL` → NULL, which RLS treats as a non-match — and the other two compare a client id against NULL, so both `EXISTS` subqueries are empty. Only the separate admin policy matches. `createStationRecorder(service, invoker)` therefore takes **no** clientId parameter at all, which makes `client_id: null` unforgeable rather than a rule someone has to remember.

## Coverage honesty

**The denominator is 80.** Not 44, not 16, not "reachable checks." A client does not care that 36 rows are assisted-tier; they care that 66 criteria had no detector. Shrinking the denominator is the exact move `eval-gate.test.ts:53-56` already exists to prevent inside the harness ("a check quietly going not_run can never inflate recall by shrinking what it is measured against"), and it must not be reintroduced one level up.

After slice 6, on a real run with crawl + gsc + robots and no GBP, the panel reads:

> **14 of 80 rubric criteria evaluated · 4 of 9 critical · NOT CLIENT-READY**

and expands to four buckets that sum to exactly 80, each row clickable to its rubric text:

| Bucket | n | UI affordance |
|---|---|---|
| **Evaluated** — detector ran, `pass`/`fail`/`degraded` | 14 | Normal findings rows. A row whose check declares `notEvaluated` criteria carries an inline badge: *"MEAS-001 — 2 of 3 criteria evaluated. Not checked: single-install verification, key-event configuration (needs the GA4 Admin API)."* |
| **Detector exists, data missing** | 2 | `not_run` rows rendered at the **same visual weight as `fail`**, never collapsed into a footnote, each naming the station: *"LOCAL-003, LOCAL-016 — GBP station not provided."* |
| **No detector, blocked on a named unlock** | 31 | Grouped by unlock with a count, so the gap reads as a roadmap: GBP API + container split **7** · Sitebulb re-run config **7** · rendered-DOM / new crawl fields **10** · GSC URL Inspection & Sitemaps **4** · PageSpeed quota **2** · GA4 Admin API **1** |
| **Human judgement (`assisted`, no detector)** | 33 | A collapsed list headed *"33 criteria require a strategist's judgement and are not automated."* Never a detector — automating these means letting a model adjudicate a status, which is failure mode 7 with a roadmap attached. |

Three concrete honesty fixes that are part of this, not aspirational:

**MEAS-001's `pass` is a partial-criterion pass on a `critical` check.** Its clean path returns `coverageStatus(cov)` → `pass` with *"Analytics tags detected on all N measured pages"*, while the rubric row requires *"installed **once**, firing correctly, key events marked"* and notes *"Config audit needs the Admin API."* Tornado conceals this because all 202 measured pages are untagged, so it fails. The first Apex brand with GA4 installed gets a green critical row for a third of the criterion. TECH-011 is the same shape — viewport and tap targets out of four sub-conditions, `howToTest` naming PageSpeed. **The fix is the `criteria` declaration in slice 5, not a status change**, because `fixtures/eval/healthy/manifest.json` puts all 8 checks in `must_pass` and `lib/eval/score.ts:157` requires `status === 'pass'` strictly — capping either at `degraded` turns the gate red and would cost a manifest schema change to buy nothing extra.

**TECH-001 can `pass` on a partial answer too.** Its rubric note is *"No Disallow on money pages, CSS **or JS** for Googlebot."* `blockedUrls(txt, pages.map(p => p.url))` runs over an HTML page list, so `Disallow: /wp-content/` blocks the theme's CSS and JS, matches no page URL, and returns `pass`. Declare the asset half as `notEvaluated`.

**Two checks stay unwritten on purpose, and the panel says so.** TECH-009 ("HTTPS enforced") would read the URL scheme off a crawl that started at the https origin — it can only ever return `pass`, which is a fabricated pass wearing a detector costume. CRO-001 is `critical`, `auto`, `low` effort and genuinely unimplementable: it needs tap-to-call position in a rendered DOM at a mobile viewport, and Playwright is a devDependency for e2e only. Approximating it from a phone number appearing anywhere in the page text would pass Tornado while its mobile CTA was broken — the ONPAGE-012 story exactly. Both sit in bucket 3 with their unlock named.

## The one LLM call

**Where.** `lib/synthesis/synthesize.ts`, one `anthropic.messages` call, invoked from `app/actions/audit-synthesis.ts` on a **stored** run. Nothing upstream of it, nothing else in the pipeline calls a model.

**Input.** The scored items (`checkId`, severity, category, effort, impact, band, rank, `evidenceDetail`, example URLs), the `unscored` list with reasons, the `lib/audit/scope.ts` coverage summary, and client context from onboarding. The prompt states which areas were not evaluated and forbids volume recommendations explicitly — Tornado's 130 generated pages produced 42 clicks against the homepage's 58, and a prompt that says "recommend improvements" will cheerfully recommend more pages (failure mode 9).

**May.** Select which findings to write about, order the narrative, and write `title`, `body`, `rationale` prose.

**May not.** Emit a `checkId` not in the input. State any number not in that finding's evidence. Omit any `severity: critical` fail. Assign severity (from `rubric.json`), effort (from `rubric.json`), impact (from `lib/scoring/impact.ts`), `priorityScore`, or `band`. **Produce `executionModel`** — §11 asks for it, so it is derived from the rubric's `effort` × `automation` and the model may only explain it; a model-chosen DFY-vs-handoff string is the field phase 8 would read to decide what an agent may touch, and a numeral guard cannot see it.

**Validators, all runtime, all degrading to the deterministic ranked list and never to an error.** Written red before `synthesize.ts` exists.

1. **Fence-tolerant parse**, reusing `app/actions/recommendations.ts:39-52`. Truncated or fenced JSON → deterministic list plus a visible marker.
2. **checkId whitelist** — an invented id drops the whole response, not just that item.
3. **Per-finding numeric whitelist** — for each recommendation, every numeric token in the body must appear in that finding's `evidence` or `score_inputs.terms`, or match a small date/ordinal allowlist. A per-finding whitelist, **not** a substring scan over the whole draft: a scan rejects "~190", "1,148" and ordinals, then gets relaxed the first time it blocks a good draft. A violation drops that item to its deterministic body. `lib/eval/citation.ts`'s vacuity guard only requires that *one* evidence number appear, so an invented number riding alongside a real one passes it today — this is the inverse assertion it lacks.
4. **Critical completeness** — every `critical`-severity fail in the input must appear in the output. Selection-by-omission is a severity decision the model made silently, and it is the one failure the citation guard is shaped wrong to catch.
5. **Vacuity** — `citationValidity()` from `lib/eval/citation.ts`, whose header already declares `DraftRecommendation` and says "No consumer yet — synthesis is phase 5." The gate predates the thing it measures; keep it that way.

**The draft gate.** Output lands in `audit_runs.synthesis_draft jsonb` and nowhere else, mirroring `clients.snapshot_insights_draft` (`20260611000004`) and CLAUDE.md convention 12. Approve/edit/reject writes an `audit_finding_reviews` row with before, after and reason, and stamps `review_state` + `reviewed_by` on the finding. **There is no `synthesis_published` column and no publish action in this plan** — publishing is the client surface, which is cut. The absent column is the enforcement: there is no place a client policy could select from even if someone wrote one. When a client surface is eventually built, it needs its own reviewed migration, its own coverage floor, and the criterion badges rendered client-side.

Also worth stating, since it is a live inconsistency the orchestrator must not inherit: `ai-visibility` declares `requires: { client, gsc }` while `registry.ts:48` lists `dataSources: ['gsc','ga4']`, so `missingRequirement` never gates it on `ga4_property_id`. `lib/orchestrator/run.ts` must build the bundle from stations and never treat a tool's `requires` as authoritative for data availability. One comment, in slice 2.

## Sequenced around the owner

**Nothing in slices 1-7 is blocked by an owner-side item.** That is deliberate: slice 1 converts the GBP container problem from a blocker into a `not_run` with a named reason, and `engine.ts` already handles that correctly with zero code. Clear them in this order so you are never the critical path:

| When | Do | Unlocks | Why this order |
|---|---|---|---|
| **Now, 2 minutes** | Set Tornado's `client_type` to `local_service` | Local dashboard modules | Otherwise after slice 1 you cannot tell "scope unconfigured" from "module never enabled" |
| **Before or during slice 3** | Sitebulb re-run with structured data, response-vs-render, Check Similar, and GA+GSC+sitemaps as URL sources (`docs/sitebulb-audit-setup.md §8`) | **7** rubric checks: TECH-004, TECH-008, TECH-013, TECH-014, TECH-019, GEO-002, GEO-006 | Slice 3's upload path is what ingests it. Highest yield per minute of your time, and it is configuration not code |
| **Any time after slice 1** | Reconcile the two disagreeing `gbp_account_id` values, then move Tapps Electric off the personal GBP container | Nothing in this plan — it unlocks the **post-plan** GBP scoping slice and its 7+2 checks | A location filter applied against the wrong account is still cross-client, so both must be true together. Slice 1 already makes the unsafe state visible rather than silent |
| **Lowest priority** | Raise the PageSpeed API quota | 2 checks (TECH-010, CRO-005), and no detector exists to block | Cheapest to defer; nothing waits on it |
| **The long pole, start now, finishes late** | §16 blocker 6: 3-5 past audits plus the plans that shipped, marked for what was implemented and what moved results | The only way to judge whether slice 7's output is *good* | `citation.ts` concedes citation-validity is not precision. Slice 7 ships without this; its **quality assessment** does not. This is also the corpus that would ever justify phase 8 |

## Deliberately not building

**The client-visible audit report.** The sharpest cut in this plan. At 14 of 80 criteria, an audit published to a client is a coverage claim the pipeline cannot back — and the danger case is not Tornado (which fails everything and looks right) but a clean Apex brand where the same 16 checks return mostly `pass` and the report reads as "your site is fine." Admin review, the review corpus, and the before/after rows are what §11 says earns autonomy; the client view is not on that path. Build it when coverage clears a floor you set deliberately, not because a screen looks empty.

**Section 14 phase 7, the tracker surface — cut entirely, not deferred.** §11 says the recommendation lifecycle *is* the project tracker and a separate one should not be built. `audit_findings.review_state` is the state machine; slice 3's screen plus slice 7's controls are the surface.

**The nav collapse from ten items to four.** §11 says decide the organizing object now and build surfaces later, and a nav redesign is literally half of the documented nine-tables-and-a-nav-redesign incident. One sidebar entry in slice 3.

**Section 14 phase 8, the WordPress plugin and tier-1 execution — deferred indefinitely.** The doc requires rollback, a change log, blast-radius limits and a kill switch before the first write. None exist, and a system that has never had a recommendation approved by a human has no basis for earning the right to execute one. Revisit when `audit_finding_reviews` has months of rows.

**Section 14 phase 9, scheduling and fleet runs.** Auth is explicitly *not* the blocker — `buildToolContext` takes no request, cookie or session, `getAdminOAuthClient` reads the shared `admin_google_token` row, and `invoker: { kind: 'orchestrator' }` is first-class with `run-recorder.ts:55` writing `user_id: null` so a pipeline cannot burn a strategist's rate limit. The blockers are that no cron infrastructure exists and that fleet-running a 17.5%-coverage pipeline across 107 brands multiplies whatever is wrong by 107. Slices 1-7 add nothing that blocks it later.

**A GBP station, and a fourth `StationBundle` slot.** `GbpProfileRecord` needs seven fields `GBPLocation` has none of; `LOCATION_READ_MASK` does not request `serviceArea`; ratings, reviews and photos are a separate API. Anyone calling LOCAL-016 and LOCAL-003 "just needs the GBP station wired" is wrong. `lib/orchestrator/run.ts` calls `buildToolContext` with `needsGbp: false` **explicitly** — a positive lockout, not an omission — so a run cannot acquire the GBP identity at all. No `ga4` slot either (MEAS-001 already reads `page.analytics.{ga4,gtm}` off the crawl) and no `psi` slot: widening the three-slot shape touches `stationState`'s `name === 'crawl'` special case, `contextFromStations`, `lib/eval/lint.ts` and both fixture files, for a capability the rubric does not need. robots.txt merges into `CrawlStationData.site`.

**`page-seo-audit` or `content-quality` as the crawl station.** `page-audits.ts:90` and `:198` set `degraded: true` **unconditionally**; either would make every crawl-backed check permanently incapable of `pass`. It is the closest thing in the repo to a crawler and it is wrong twice — wrong envelope and wrong shape (one `ParsedPage`, no `site.robotsTxt`, no content/template word split).

**Replacing the hand-built eval fixtures with record-and-replay.** `fixtures/eval/tornado/stations.ts:13-15` schedules it and slice 2 makes it tempting, but the manifest transcribes §9's documented figures — which, per fact 2 above, the real export deliberately does not reproduce. A replay would silently re-baseline ground truth that was written down before any pipeline code existed. That uncircularity is the harness's entire value. The right move is what slice 2 does instead: assert against the **recorded** ingest block, which is committed, reviewed, and reconciled to §9 with a written explanation per delta.

**A Supabase Storage bucket for exports, and a run-diff view.** Nothing in slices 2-7 re-reads an export; parse in-request and discard. A diff needs two runs on one client to mean anything, and the first working version has one. Two `audit_runs` rows already *are* the history.

**Detectors for the 36 `assisted` checks, and for any of the 23 auto checks whose data source does not exist.** A detector on unavailable data returns `not_run` correctly, which raises the check count and leaves coverage identical — the confusion the four-state model exists to destroy, reintroduced one level up.

## Honest cost

| # | Slice | Sessions | Why |
|---|---|---|---|
| 1 | GBP fail closed | 1 | Small surface but six files, two cache-key bumps, and a production verification only Matt can run |
| 2 | Source seam + stations + orchestrator | 1 | The seam is genuinely one function (`readCsvTable` plus two `readdir` calls). The robots fetcher is ~40 lines. Most of the session is the degradation module and reconciling against the recorded block |
| 3 | Upload + admin screen | 1 | jszip is already a dependency; the screen copies `tools/keyword-quick-wins/page.tsx` |
| 4 | Persistence | 1 | One migration, two mapping functions, one import-graph test. The migration goes to review before apply, which may push the apply into the next session |
| 5 | Coverage report + criterion declaration | 1 | `lib/audit/scope.ts` is pure partitioning; the `criteria` field touches four checks |
| 6 | Detector batch (8) | **2** | Per detector: module + `BASIS_RULES` entry + MAGNITUDE predicate + fixture rows + manifest edit, then two reviewed snapshot re-baselines and eight live-URL confirmations. The snapshot diff review is the expensive part and it is a feature. One session is a lowball |
| 7 | Synthesis + review gate | **2** | Five validators written red first, a prompt, a parser, the review UI, the third table's migration, and one live call read against §9's manual P1 list |
| | Owner-side | — | Not counted. The Sitebulb re-run is ~30 minutes of your time; the GBP container split is unbounded and depends on Google |

**Total: 9 sessions.** Slices 6 and 7 are the two most likely to run long — if the snapshot re-baseline in 6 surfaces a ranking distortion, or if validator 3 proves to need a real tokenizer rather than a regex, either becomes 3. Plan for **9, budget for 11.** Each session ends with the standard gates (`npx tsc --noEmit` → `npm test` → `npm run build`), a commit and push, and a fresh verification agent that did no implementation. Slice 2's numeric gate and slice 1's production gate are Matt-side: the sandbox cannot reach the live site, and the real 206-URL export is not committed.
