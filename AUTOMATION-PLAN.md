# Automation build plan

Execution plan against `AUTOMATION-CONTEXT.md` §14. That document is the source of
truth for *why*; this one tracks *where we are* and *what's left*.

Last updated: 2026-08-06.

---

## Where things actually stand

| | |
|---|---|
| **Production** (`main` = `b0a77b5`) | Rebrand stages 1–6 complete · phase 1 onboarding · callable-tool foundation |
| **Branch** `phase2/callable-tools` (3 commits, unmerged) | Phase 2 complete: 8 callable tools · the 80-check rubric archived as data |
| **Branch** `phase6/eval-harness` (off phase2, unmerged) | Eval harness slice 1: findings engine, 7 detectors, 2 fixtures, loader, scorer, hard gate |
| **Phase progress** | 1, 2 complete · 3 started (the 7 detectors ARE the first derived analyses) · 6 slice 1 built |

**The golden set is no longer requested.** The eval harness was redesigned around
substitutes (seeded fixtures, the documented Tornado audit, the future review-gate
flywheel, a deferred outcome loop), adversarially critiqued by three independent
reviewers, and slice 1 is built and verified. What §14 called the long pole is off
Matt's plate.

---

## Phase 2 — make the tools callable

*The blocker. Nothing in phases 3–5 can be built until this lands.*

**Done:** `lib/tools/contract.ts` (`CallableTool`, `ToolResult`, `ToolContext`,
`runGuarded`, `fromConnector`), `lib/tools/run-recorder.ts` (`startRun`,
`finishRun`, `failRun`), `lib/connectors/gsc.ts` (the query primitive).

**Left:**

1. **Rewire the three flexible GSC paths** onto the primitive — `lib/tools-gsc.ts`,
   `lib/ask-tools.ts`, `lib/ask-lvl3/tools/gsc.ts`. Each keeps its current output
   shape exactly; only the mechanics move. `lib/google-search-console.ts` is
   deliberately excluded (six bespoke queries in one `Promise.allSettled` batch —
   live-dashboard risk out of proportion to the gain).
2. **Convert the audit tools to `CallableTool`.** 16 tool directories exist; only
   4 have anything under `app/api/tools/`, and those are HTTP routes rather than
   composable functions. Two tranches: the cheap read-only ones first, then the
   heavier crawl-backed ones. The three generators — `seo-content-engine`,
   `tfk-generator`, `blog-image-generator` — are content production, not audit
   inputs, and stay out of the orchestration path.
3. **Wire `lib/tools/registry.ts`** (19 entries, currently UI metadata only) to
   the callable functions, so one registry describes both the UI and the
   orchestrator's surface.
4. **Point Ask LVL3's 13 headless tools at the same callables**, so there is one
   implementation per capability rather than two.

**Design rule for this phase:** a tool's return type is what an orchestrator
consumes, not what a page renders. Where those differ, the tool returns the data
and the page formats it.

---

## Phase 3 — data model + Sitebulb ingester

1. **Findings and recommendations schema.** One row per check per run, with
   `pass | fail | degraded | not_run` as four distinct states. `not_run` must be
   modelled explicitly — a missing data source producing a `pass` is §17's
   most-important failure to prevent.
2. **Seed the 78-check rubric as data**, not inline SQL. **Blocked: the rubric
   artifact isn't in the repo yet** (§7 says so explicitly). Nothing here can be
   built without it.
3. **Sitebulb ingester.** `summary.xlsx` is the backbone; reading only the hints
   folder makes `pass` indistinguishable from `not_run`, because hint CSVs exist
   only for triggered hints.

---

## Phases 4–9

| # | Phase | Notes |
|---|---|---|
| 4 | Station framework + derived analyses | Cannibalization, visibility cohort, opportunity sizing, content-to-template ratio, template grouping — the analyses that produced the real Tornado findings |
| 5 | Findings, scoring, synthesis, review | Impact computed from data, effort from a rubric lookup, exactly one LLM call. Needs the effort rubric |
| 6 | Eval harness | Arguably before 5. Needs the golden set. Currently only the completeness tests exist |
| 7 | Tracker surface | Mostly surfacing the recommendation lifecycle built in 3–5 |
| 8 | WordPress plugin + tier-1 execution | Highest risk. Change log, rollback, blast-radius limits and a kill switch before the first write |
| 9 | Scheduling + fleet-wide runs | Only after the pipeline is trustworthy on one client |

---

## Blocked on Matt

Ordered by what unblocks the most work.

| # | Item | Blocks |
|---|---|---|
| 1 | **One login to the portal** | Verifying all of phase 1, plus the three rebrand screens never seen |
| 2 | **The 78-check rubric artifact** | All of phase 3, therefore 4–5 |
| 3 | **Golden set** — 3–5 past audits, what shipped, what moved results | Phase 6. The long pole, entirely manual |
| 4 | **Effort rubric** — task type → effort tier | Phase 5 scoring |
| 5 | **Repo is public** | Nothing technically, but it's a client portal with client content in `docs/review-handoff/` |
| 6 | **Tapps Electric GBP container** — `get_search_appearances` returns 50 locations aggregated across every client, unidentified | Any automated GBP reporting. A live cross-client leak |
| 7 | **`gbp_account_id` values** for Tornado and Tapps — at least one is likely wrong | GBP accuracy |
| 8 | **PageSpeed API quota increase** | Any fleet-wide run |
| 9 | **Sitebulb re-run** with the correct template (Chrome Crawler on, Check Similar on, structured data on, sitemaps + GA + GSC as URL sources) | Phase 3 coverage claims |

**Still undecided** (§16): which tier-1 task types may execute without per-change
approval · whether the client-facing Sheet tracker is rendered from the portal DB
or retired · naming for the diagnostic component (not "Detect").

---

## Sequencing

Phase 2 to completion, then phase 3 as far as the rubric allows. Phase 6's eval
harness should land before phase 5 rather than after — if synthesis output looks
convincing and nothing scores it, there's no way to know when a later prompt
change makes it worse.

One phase per session (§14). Gates each slice: `npx tsc --noEmit` → `npm test` →
`npm run build`, then a fresh verification agent that did no implementation.
Three such passes have run so far and each found real defects, including two
data-loss bugs and one silent-pass bug in the discovery cache.

Note for gate builds: use `NEXT_DIST_DIR=.next-build npm run build` so a build
never clobbers a running dev server.
