# LVL3 Portal — Analytics UX Audit

**Date:** 2026-06-11 · **Scope:** `/dashboard` (all tabs, all modules) + all 16 active `/tools` + Ask LVL3 + supporting shell surfaces
**Evidence:** every claim cites `file:line` (repo @ `087dc4d`), a live prod-DB query (Supabase project `zoeaifsxnaenlcdkavzf`, queried 2026-06-11), or a screenshot in `docs/audit/screens/`. Scores marked ◐ are code-derived and pending visual confirmation (see §1.3).
**Status:** AUDIT ONLY — no feature code ships until the phased plan (§8) is approved.

---

## 0. Executive summary

The portal's analyst tooling is genuinely strong — Content Refresh Finder, the SEO Content Engine, and the Locations modules would survive a day-one demo to Ryan Metcalf without caveats. The dashboard's architecture (type-aware module registry, data-gated modules, period-aware fetching) is better than most agency portals. But the three things a CMO-facing reporting product is judged on are exactly where it falls short today:

1. **The "verdict-first" layer is not actually live.** The structured insight cards and LLM headline that Snapshot was built around are absent from prod data for **all four clients** — the exec band silently falls back to a generic "Sessions up/down X%" sentence and the InsightCards module never renders (§2.1).
2. **No way to hand the numbers to anyone.** There is no PDF/print/CSV export or scheduled digest of the dashboard; the monthly-reporting job dead-ends at a screenshot (§4, job a).
3. **No cross-client triage.** "What needs attention this week across clients" requires visiting each client one at a time; alerts exist only per-selected-client (§4, job c).

Those are also the three biggest gaps vs the benchmark bar (AgencyAnalytics / Triple Whale / polished Looker agency templates).

Meanwhile the dashboard carries real redundancy — sessions are rendered in six places, two tabs are cut candidates, one tab is a dead placeholder — so the plan below is net-negative UI: **2 tabs removed, 1 KPI block removed, 2 tools merged**, against 1 export button, 1 nudge, and 1 admin triage strip added.

---

## 1. Methodology & evidence

### 1.1 What was examined
- Full code read of `app/(dashboard)/dashboard/*`, `components/dashboard/**`, `components/analytics/**`, `app/(dashboard)/tools/**` (19 registry entries), `app/actions/*`, `lib/dashboard/*`, `lib/tools/registry.ts`, shell/nav/settings surfaces.
- Live prod database state (clients config, insight payloads, usage tables) via Supabase MCP — read-only queries.
- Screenshots at 1440×900 and 375×812, logged in as admin, captured read-only (manifest in Appendix C).

### 1.2 Test matrix — as it actually exists in prod (DB, 2026-06-11)

| Client | client_type | GA4 | GSC | GBP | Competitors | Key events | Brand terms | Targets | Insights refreshed |
|---|---|---|---|---|---|---|---|---|---|
| True Food Kitchen | `multi_location` | ✅ | ✅ | ✅ | 5 | 4 | 9 | **none** | 2026-06-11 |
| MantelMount | null (generic) | ✅ | ✅ | — | 0 | 0 | 0 | none | 2026-06-10 |
| Pasha Health | null (generic) | ✅ | ✅ | — | 0 | 0 | 0 | none | 2026-05-14 |
| Tapps Electric | null (generic) | ✅ | ✅ | — | 0 | 0 | 0 | none | **2026-02-20** |

Notes: (a) the brief assumed TFK had targets — it does not, so Goals & Pacing and goal-miss alerts are invisible even for the flagship client (audited as a finding, per Matt); (b) no GA4-only client exists, so partial-config state was audited by code path (modules self-gate via `lib/dashboard/registry.ts` + `AnalyticsSection.tsx:139-147` — confirmed non-fatal); (c) client-role experience audited by code trace (no client credential provided); (d) usage evidence is internal-testing only by design: `tool_runs` has 2 rows total, `client_annotations` 0, `deliverables` 1, `semrush_reports` 3, Ask LVL3 6 threads / 45 messages.

### 1.3 Evidence statuses
- **Code** — file:line in this repo.
- **DB** — live prod query result (stated inline).
- **SS** — screenshot in `docs/audit/screens/` (named `<surface>-<client|na>-<width>.png`).
- ◐ — visualization/craft score provisional until the matching screenshot is reviewed; all such rows carry their code citation regardless.

---

## 2. Headline findings

### 2.1 The structured insight layer is dead in prod (highest-impact finding)
`generateAnalyticsInsights` unconditionally writes `headline`, `cards[]`, and `generatedAt` into `clients.snapshot_insights` (`app/actions/analytics.ts:381-388`). **DB:** all four clients' `snapshot_insights` contain only the legacy `takeaways/anomalies/opportunities` keys — no `headline`, no `cards`, no `generatedAt` — including TFK, refreshed the day of this audit. Since `cards: []` and `generatedAt` are written unconditionally, the only explanation is that **prod is running a build that predates the structured-insights writer**. Downstream effect: `AnalyticsSection.tsx:158` reads `snapshotInsights?.cards ?? []` → InsightCards never renders; the exec-band headline falls back to the generic sessions sentence (`AnalyticsSection.tsx:256-265`). The CMO layer the Snapshot redesign was built around has never actually been seen by anyone in prod. Fix is ops (redeploy) + a small render-time fallback (§6, change 1).

### 2.2 Window honesty
The Website/SEO KPI tables **are** period-aware — `fetchDashboardReport` takes `{period, compare}` (`app/actions/analytics.ts:110-114`) and the lib fetches honor it (`lib/google-analytics.ts:192-197`, `lib/google-search-console.ts:143-148`). What's actually wrong:
- Tooltip copy **lies**: "last 30 days" / "28 days" is hardcoded regardless of the selected period (`components/analytics/AnalyticsKpiStrip.tsx:44,51`; same pattern in `WebsiteKpiRow`).
- The two monthly trend charts are genuinely pinned to 6 months (`lib/google-analytics.ts:206-208,256-265`; `lib/google-search-console.ts:158-160`; "Last 6 months" label `components/analytics/website/WebsiteTab.tsx:40`) while the rest of the tab follows the picker.
- Fixed-by-design modules (pacing MTD, 13-month table, Competitive) don't say so on screen.
- The AI narrative is generated from "last 30 days vs prior period" (`app/actions/analytics.ts:309,319`) while the dashboard defaults to last-full-month vs YoY (`DashboardTabs.tsx:209-210`) — two conflicting comparison frames on the same page. **DB:** TFK's stored narrative opens "Over the last 30 days … declines of 20% and 18% … compared to the prior period," directly under a YoY-framed dashboard.

### 2.3 Dead / stub UI (confirmed)
- Definitions tab: "Metric definitions and methodology notes will appear here." plus an `Admin: Edit` button **with no click handler** (`DashboardTabs.tsx:516-535`, button :524-527).
- Three `coming-soon` registry stubs (schema-generator, service-page-generator, indexation-monitor) are correctly hidden from the hub (`lib/tools/registry.ts:257-300`) — harmless.

### 2.4 Redundancy
Sessions appear in **six** places (exec band `AnalyticsSection.tsx:234`; KPI strip `DashboardTabs.tsx:363-374`; traffic trend :341-346; Website KPI row; channel chart; 13-month table). Organic clicks in four. Snapshot shows the same sessions/clicks numbers **twice on one screen** (exec band + KPI strip). `ChannelBarChart` renders on both Snapshot (`DashboardTabs.tsx:348-351`) and Website (`WebsiteTab.tsx:33`). Full map in Appendix A.

### 2.5 Empty-by-default features
- **Targets:** 0/4 clients configured → Targets module self-hides (`Targets.tsx:93-94`), goal alerts can never fire, and nothing nudges an admin to set goals.
- **Annotations:** 0 rows ever → the "what we changed" story is empty for every client (`Annotations.tsx:117-119` placeholder shows instead).
- **ActivityFeed:** driven by deliverables; 1 deliverable exists → effectively empty.
The single best retention story an agency dashboard can tell — *what we did → what happened* — currently has no data anywhere.

### 2.6 Tone & trust (client-eyes pass)
- InsightCards severity chip renders the literal word **"Critical"** to clients (`InsightCards.tsx:18-37`, label :36).
- Insight freshness varies silently — Tapps Electric's narrative is 4 months old (**DB**) with the timestamp shown only inside the Snapshot context panel (`DashboardTabs.tsx:384-391`), not in the exec band where the headline implies recency.
- Alert *wording* is good: factual templates ("Sessions down −27%", "behind goal … trending to miss this month", `lib/dashboard/alerts.ts:156-215`), proper minus signs, ranked critical→info, deduped, capped at 6 (:134), goal-miss gated to >60% month elapsed (:197-198). Not dismissible (no close affordance, `Alerts.tsx`), acceptable pre-launch.
- GSC raw error text is correctly admin-gated (`SeoTab.tsx:77-82`).

### 2.7 Theme & consistency debt
Negative/error states use ad-hoc `rose-*` while `--color-error` exists as a token; `MetricTable13` uses raw `emerald-400`/`red-400` (`MetricTable13.tsx:47`) where `DeltaChip` uses rose; stale "LVL3 dark-theme palette" comments in `Targets.tsx`, `InsightCards.tsx`, `Sparkline.tsx`. The tools directory is **clean** — no violet hex remains (DESIGN.md's "known follow-up" sweep already happened). `accent-400` is a valid token (`tailwind.config.ts:42-53`), not debt.

### 2.8 Docs drift (matters because CLAUDE.md drives future agent work)
`.claude/CLAUDE-routes.md:10-15` and `.claude/CLAUDE-seo-tools.md` list **5** tools; the registry has **19 entries (16 active)** (`lib/tools/registry.ts:25-316`). `CLAUDE-db-schema.md` lists `semrush_project_id` (doesn't exist in prod) and omits `brand_context` (does). CLAUDE.md says "No test framework" — vitest (8 unit files) + a Playwright smoke test exist. Ask LVL3 docs say `max_tokens: 1024`; code says 4096 (`app/api/ask-lvl3/route.ts:219`).

### 2.9 Benchmark bar — three biggest gaps vs AgencyAnalytics / Triple Whale / Looker templates
1. **Delivery:** no PDF/print/export/scheduled digest of any dashboard view (exports exist only inside tools, `components/tools/primitives/ExportTool.tsx`).
2. **Portfolio view:** no cross-client overview; competitors all do "all accounts at a glance with alerts."
3. **Verdict layer:** headline + insight cards dead in prod (§2.1) plus the dual comparison frame (§2.2) — the benchmark products lead with one consistent, dated verdict.

---

## 3. Scorecard & ranking

Scales 1–5: **U**sefulness · **I**nsightfulness · **D**igestibility · **V**isualization · **C**raft. 5 = changes a decision / best-in-class; 1 = nobody would miss it. Scored as-deployed (potential noted where it differs). ◐ = V/C provisional pending screenshot review.

### 3.1 Dashboard tabs

| Tab | U | I | D | V | C | Evidence (one line) |
|---|---|---|---|---|---|---|
| Snapshot | 4 | 3 | 3 | 3◐ | 4 | Right composition (alerts→exec→trend→channels, `DashboardTabs.tsx:329-427`) but verdict layer dead (§2.1) + duplicate KPI block (:358-375) + 3-paragraph AI wall in mixed frame (:378-425) |
| Locations | 4 | 3 | 4 | 3◐ | 4 | GBP tiles + sortable leaderboard + completeness (:430-447); no per-location drill-down/trend |
| Detail | 3 | 3 | 3 | 3◐ | 3 | Module grab-bag organized by data source, not by question (:450-474); 13-mo trend + admin table are its real value |
| Website | 2 | 2 | 3 | 3◐ | 3 | Duplicates Snapshot channel chart + sessions KPIs (`WebsiteTab.tsx:28-43` vs `DashboardTabs.tsx:348-351`); merge candidate |
| SEO | 3 | 3 | 3 | 3◐ | 3 | GSC KPIs/SERP distribution/queries+URLs tables (`SeoTab.tsx:40-84`); no query movers ("what changed"), 6-mo trend pinned |
| Full Dashboard (Looker) | 2 | 2 | 2 | 2◐ | 2 | iframe escape hatch with timeout message (`DashboardTabs.tsx:492-514`); competes with the native dashboard it predates |
| Definitions & Notes | 1 | 1 | 1 | 1 | 1 | Placeholder + dead button (`DashboardTabs.tsx:516-535`) — confirmed dead UI |

### 3.2 Dashboard modules / exec band

| Module | U | I | D | V | C | Evidence |
|---|---|---|---|---|---|---|
| ExecutiveSummaryBand | 4 | 3 | 4 | 3◐ | 4 | Headline+KPIs+sparklines+health+activity (`AnalyticsSection.tsx:232-267`); potential 5 once §2.1 fixed; activity feed empty (DB) |
| Alerts | 4 | 4 | 4 | –◐ | 4 | Ranked/deduped/capped, factual wording (`alerts.ts:119-296`); per-client only |
| TrendChart + ghost overlay | 4 | 4 | 4 | 4◐ | 4 | Granularity-aware, dashed comparison series, token colors (`TrendChart.tsx:124-147`) — best chart in the app |
| MetricTable13 (admin) | 5 | 4 | 4 | 3◐ | 4 | The QBR workhorse: 13 months × 5 metrics + YoY strip (`MetricTable13.tsx:96-165`); no export; raw emerald/red (:47) |
| LocationLeaderboard | 5 | 4 | 4 | 3◐ | 4 | Sortable 5-metric table, city labels (`LocationLeaderboard.tsx:115-275`); flagship for multi_location; lacks per-row deltas |
| LocationCompleteness | 4 | 4 | 4 | 3◐ | 4 | Score buckets + top issues + attention list (`LocationCompleteness.tsx:165-268`) — actionable |
| BrandedSplit (+intent) | 4 | 4 | 4 | 4◐ | 4 | Donut + local/general intent bar, period-aware (`BrandedSplit.tsx:83-194`); overlaps /tools/ai-visibility |
| GbpOverview tiles | 4 | 3 | 4 | 3◐ | 4 | Aggregate GBP actions + deltas (`DashboardTabs.tsx:127-179`) |
| Competitive | 4 | 4 | 4 | 3◐ | 3 | Authority/keywords/traffic vs named competitors, "You" row highlight (`Competitive.tsx:80-131`); static — no trend, not period-aware (`AnalyticsSection.tsx:146`) |
| ConvertingPages | 4 | 3 | 4 | –◐ | 3 | Key-event landing pages (`ConvertingPages.tsx`); exactly what lead-gen needs |
| Top-locations chart | 3 | 3 | 4 | 4◐ | 4 | RankedBarChart, top-bar accent (`RankedBarChart.tsx:62-64`) |
| ChannelBarChart (Snapshot) | 3 | 2 | 4 | 3◐ | 3 | Useful once; rendered twice (§2.4) |
| ContentPerformance | 3 | 3 | 3 | 3◐ | 3 | Inline proportional bars (`ContentPerformance.tsx:25-96`) |
| EcomFunnel / TopProducts | 3 | 3 | 4 | 3◐ | 3 | Well-built (`EcomFunnel.tsx:51-114`) but no ecommerce client exists in prod (DB) — untested in anger |
| Context panel (3 AI paragraphs) | 2 | 3 | 2 | – | 3 | Wall of AI text in the wrong comparison frame (§2.2); supersede with cards |
| KPI strip on Snapshot | 2 | 2 | 3 | 3◐ | 3 | Same numbers as exec band 200px above (`DashboardTabs.tsx:358-375`) |
| InsightCards (as shipped) | 2 | 2 | 4 | 3◐ | 3 | Well-designed cards (`InsightCards.tsx:46-114`) that have never rendered in prod (§2.1); potential 5; "Critical" chip label |
| Annotations (as used) | 1 | 1 | 3 | – | 3 | Good idea, 0 rows ever (DB); placeholder shows instead |
| Targets/pacing (as deployed) | 1 | 1 | 4 | 3◐ | 4 | Solid run-rate math (`lib/dashboard/pacing.ts`) invisible because no client has targets (DB) and no nudge exists |

### 3.3 Tools (+ hub + Ask LVL3)

| Tool | U | I | D | V/C | Evidence |
|---|---|---|---|---|---|
| Content Refresh Finder | 5 | 5 | 4 | 4◐ | Decline detection (90d vs prior 90d) → AI brief → "Send to Content Engine" handoff — a real workflow, not a report |
| SEO Content Engine | 5 | 3 | 3 | 4◐ | Full pipeline to DOCX w/ streaming progress + history + rate limits; complexity tax on first use (multi-tab) |
| Keyword Quick Wins | 4 | 4 | 4 | 4◐ | Pos 4–20 opportunity table + score + export + run history (`app/actions/tools.ts:39-80`); score formula unexplained in UI |
| Content Gap Finder | 4 | 4 | 3 | 4◐ | Three gap types with recommendations (`tools.ts:519-593`); gap-type grouping buries the unified "what do I do first" |
| Semrush Gap Analysis | 4 | 4 | 3 | 4◐ | Matrix + relevance scoring + persisted reports (`semrush_reports`, 3 rows DB); dense first paint |
| GBP Audit | 4 | 4 | 4 | 4◐ | NAP/hours/completeness per location — the onboarding tool (1 of only 2 tools ever run, DB) |
| Keyword Research | 4 | 3 | 4 | 4◐ | 100 keywords, volume/CPC/trend sparklines; clean |
| Page SEO Audit | 4 | 3 | 4 | 4◐ | Crawl + issues + metadata; overlaps content-quality |
| Ask LVL3 | 4 | 4 | 4 | 4◐ | 13 tools incl. spreadsheet artifacts, threads persisted, status streaming (`route.ts:212-219`); discoverability fine via sidebar |
| Tools hub | 4 | – | 4 | 5◐ | Search + categories + Recent (localStorage) + New badges (`ToolsHubClient.tsx`); best-crafted surface in the portal |
| Core Web Vitals | 3 | 3 | 4 | 4◐ | CrUX field data + tiers; standard |
| Vertical Benchmark | 3 | 4 | 3 | 3◐ | Novel (citation probing, GEO patterns); slow, niche (1 run ever, DB) |
| AI Visibility Check | 3 | 3 | 4 | 4◐ | Duplicates BrandedSplit module with *different* window (fixed 90d) and *different* brand terms (name/slug heuristic vs configured `brand_terms`) — two surfaces, two answers |
| Landing Page CRO Audit | 3 | 3 | 3 | 3◐ | Useful scores + prior-run comparison; outside SEO core |
| Backlink Overview | 3 | 2 | 4 | 4◐ | Five KPI cards, no trend, no list — thin |
| Content Quality | 3 | 3 | 4 | 3◐ | Readability/headings/links; second URL-audit tool |
| Blog Image Generator | 3 | 1 | 3 | 3◐ | Batch DALL-E + ZIP; only tool with **no persistence** (results lost on nav) |
| TFK Generator | 3 | 2 | 3 | 3◐ | Bespoke single-client location-page generator; fine, never generalizes |

### 3.4 Overall ranking (best → worst)

**Tier 1 — would demo to Ryan day one:** Content Refresh Finder · LocationLeaderboard · MetricTable13 · SEO Content Engine · TrendChart+ghost · BrandedSplit · Tools hub · Alerts · LocationCompleteness · GBP Audit
**Tier 2 — good, needs polish:** Ask LVL3 · Keyword Quick Wins · Snapshot tab · Content Gaps · Semrush Gap · ExecutiveSummaryBand · GbpOverview · Keyword Research · Page SEO Audit · Locations tab · Competitive · ConvertingPages
**Tier 3 — serviceable:** SEO tab · Detail tab · Core Web Vitals · Top-locations chart · ChannelBarChart · ContentPerformance · EcomFunnel/TopProducts · Vertical Benchmark · CRO Audit
**Tier 4 — cut, merge, or revive:** AI Visibility (merge) · Content Quality (merge) · Backlink Overview (thin) · Blog Image Gen (no persistence) · TFK Generator (bespoke) · Website tab (merge) · KPI strip on Snapshot (cut) · Looker tab (sunset path) · Context paragraphs (supersede) · Annotations as-used · Targets as-deployed · InsightCards as-shipped (revive — highest-leverage fix in the portal) · **Definitions tab (cut — bottom of the list)**

---

## 4. Job coverage — every surface mapped to a recurring job

Jobs: **(a)** monthly reporting / QBR prep · **(b)** new-client onboarding & setup · **(c)** weekly cross-client triage · **(d)** SEO production work · **(e)** client self-serve check-in.

| Surface | Jobs served | Verdict |
|---|---|---|
| Snapshot (exec band, alerts, trend, channels) | a, e | **Keep** — fix §2.1/§2.2, dedupe |
| KPI strip on Snapshot | a (dup) | **Cut** from Snapshot (Home keeps compact use) |
| Context panel (3 paragraphs) | a, e (dup) | **Merge** into InsightCards once live |
| InsightCards / headline | a, e | **Keep + revive** (§2.1) |
| Targets & pacing | a, e | **Keep + nudge** (invisible today) |
| Annotations | a, e | **Keep admin-side; hide from client view until used** (decision) |
| Locations tab (tiles, leaderboard, completeness) | a, d-local, e | **Keep** — flagship |
| Detail modules (funnel, products, converting, content, branded, competitive) | a, d | **Keep**, gated as-is |
| MetricTable13 | a (QBR) | **Keep + export** |
| Website tab | a (dup) | **Merge into Detail** (decision) |
| SEO tab | a, d | **Keep**; period-fix + query movers later |
| Full Dashboard (Looker) | a (legacy) | **Keep for now; flag sunset** (decision) |
| Definitions tab | — | **Cut** (dead) |
| Home (KPI strip, attention queue, narrative) | c (weak), e | **Keep; host the triage strip** |
| Quick Wins / Content Gaps / Refresh Finder / Content Engine / Keyword Research / Semrush Gap | d | **Keep** — strongest area of the portal |
| GBP Audit / Page SEO Audit / Vertical Benchmark / CWV | b, d | **Keep** |
| AI Visibility tool | d (dup of module) | **Merge** with BrandedSplit (decision) |
| Content Quality tool | d (dup) | **Merge** into Page SEO Audit (decision) |
| Backlink Overview | a, d (thin) | **Keep**, fold into Competitive surface later |
| CRO Audit / Blog Image Gen / TFK Gen | d (adjacent) | **Keep**, low priority |
| Ask LVL3 | a, c, d (ad hoc) | **Keep** |
| Client settings form (+ AI Recommend buttons, type auto-detect) | b | **Keep** — onboarding is well served (`ClientSettingsForm.tsx:345-886`) |

**Gap analysis:** job **(a)** is served up to the last step then dead-ends — no export/digest. Job **(c)** has **no surface at all** (the only true uncovered job). Jobs (b), (d) are well covered. Job (e) is covered but fails the trust pass (§2.6) until the quick wins land.

**Ryan Metcalf day-one test:** Tier 1 passes clean. Snapshot passes *only after* §2.1 + freshness stamp + "Critical"→"Attention" (otherwise the first question is "why does the text say last-30-days down 20% when the header says YoY?"). Definitions tab, dead button, and the duplicate KPI strip would each cost credibility in that meeting.

---

## 5. Top 10 changes (ranked by impact ÷ effort; all validated against the code)

| # | Problem → Change | Files | Effort | Removes / replaces | Decision? |
|---|---|---|---|---|---|
| 1 | Verdict layer dead (§2.1) → derive InsightCards **live at render** from current-period deltas (prefer live, period-correct cards; stored insights only for LLM headline/takeaways) + **redeploy prod** | `components/dashboard/AnalyticsSection.tsx` (~15 lines; `deriveInsightCards` is pure & importable) | **S** | Replaces reliance on stale stored cards | Ops: confirm prod deploy currency |
| 2 | Lying window copy (§2.2) → period-aware tooltip/label copy; on-screen "fixed window" labels for pacing/13-mo/Competitive; align AI-narrative frame with selected compare | `AnalyticsKpiStrip.tsx:44,51`, `WebsiteKpiRow.tsx`, `app/actions/analytics.ts` (prompt) | **S** | Replaces wrong copy | — |
| 3 | 6-month pinned trends → swap to existing period-aware `fetchGA4Trend`/`fetchGSCTrend` | `lib/google-analytics.ts`, `lib/google-search-console.ts`, `WebsiteTab.tsx`, `SeoTab.tsx` | **S–M** | Replaces 2 hardcoded chart windows | — |
| 4 | Dead Definitions tab → **cut tab + dead button**; definitions move into the existing KpiCard `tooltip` prop (add `tooltip` to `ExecKpi` + pass-through) | `DashboardTabs.tsx`, `ExecutiveSummaryBand.tsx`, `AnalyticsSection.tsx` | **S** | **Removes a tab** | — |
| 5 | Website tab duplicates Snapshot → **merge into Detail** (move SourceMediumTable + MonthlySessionsChart; delete WebsiteTab + WebsiteKpiRow); requires gate fix `hasDetail ||= hasAnalytics` (`DashboardTabs.tsx:232-234`) so generic clients keep source/medium | `DashboardTabs.tsx`; delete `WebsiteTab.tsx`, `WebsiteKpiRow.tsx`; keep `SourceMediumTable.tsx`, `MonthlySessionsChart.tsx` | **M** | **Removes a tab + dup chart + dup KPI row** | ⚑ tab removal |
| 6 | Same KPIs twice on Snapshot → drop `AnalyticsKpiStrip` from Snapshot (`DashboardTabs.tsx:358-375`); Home keeps compact use; `analyticsData` prop stays (drives tab gating :229-230) | `DashboardTabs.tsx` | **S** | **Removes duplicate KPI block** | — |
| 7 | No report delivery → `@media print` stylesheet (fix `calc(100vh-56px)` clip, `AnalyticsSection.tsx:284`) + "Print / Save PDF" button + CSV/XLSX export of MetricTable13 via ExportTool with new `persist?: boolean` prop (avoids pseudo `tool_runs`) — **no new packages** (xlsx is a dep) | `app/globals.css`, `DashboardTabs.tsx`, `ExportTool.tsx` | **M** | Net-zero: pairs with the two tab removals | — |
| 8 | Pacing invisible (0/4 clients have targets) → when `isAdmin` and no targets, render "Set monthly goals →" linking `/clients/[id]` instead of self-hiding (`Targets.tsx:93-94`; pass `isAdmin`+`clientId` from `DashboardTabs.tsx:338`) | `Targets.tsx`, `DashboardTabs.tsx` | **S** | Replaces silent self-hide | ⚑ Matt: actually set TFK targets |
| 9 | No cross-client triage (job c) → admin-only strip on Home: per-client sessions delta + pacing-behind + GBP health via **clientId-accepting** paths (`fetchAnalyticsData`, `fetchDashboardGBP`, `getPacingActuals` — the `dashboard-*` convenience actions resolve the *selected* client internally and cannot be looped); Suspense-deferred, concurrency-capped, per-client try/catch; cold cache ≈5–10 Google calls/client (6h `cachedFetch` TTL) | new `app/actions/admin-triage.ts`, new `components/home/AdminTriageStrip.tsx`, `app/(dashboard)/page.tsx` | **L** | Replaces nothing; slim Home's quick-nav to compensate | ⚑ signals + quota strategy |
| 10 | Two answers for branded share → admin-gated deep-link from BrandedSplit module to the tool; drop the tool's duplicate KPI cards; **align window + brand-term source** (tool: fixed 90d + name/slug heuristic vs module: period-aware + configured `brand_terms`) or label the difference | `BrandedSplit.tsx`, `DashboardTabs.tsx`, `tools/ai-visibility/page.tsx`, possibly `app/actions/tools.ts` | **S–M** (M if aligning) | **Merges a tool into a module** | ⚑ alignment approach |

---

## 6. Quick-wins batch (each <1h — approvable as one PR; most touch `DashboardTabs.tsx`, so they land together)

1. Cut Definitions tab + dead "Admin: Edit" button (change 4).
2. Drop the duplicate KPI strip from Snapshot (change 6).
3. Targets "Set monthly goals →" admin nudge (change 8).
4. Fix lying tooltip copy (change 2's copy portion).
5. Tone pass: "Critical" chip → "Attention" (`InsightCards.tsx:36`); **move** the freshness stamp into the exec band (new `updatedAt` prop on `ExecutiveSummaryBandProps`; delete the duplicate at `DashboardTabs.tsx:384-391`); `MetricTable13` `red-400`→`rose-400`; aria-labels on ExportTool buttons.
6. Delete stale "dark-theme" comments (`Targets.tsx`, `InsightCards.tsx`, `Sparkline.tsx`).
7. Docs refresh: 19-entry tool registry into `.claude/CLAUDE-routes.md` + `.claude/CLAUDE-seo-tools.md`; schema drift in `.claude/CLAUDE-db-schema.md`; test-framework note + Ask LVL3 max_tokens in CLAUDE.md docs.

---

## 7. Phased plan — each phase = one shippable PR (`npx tsc --noEmit` + `npm run build` green; no new packages; no migrations anywhere in PR1–6; modules stay gated so unconfigured clients keep the clean generic view)

| PR | Contents | Decisions needed before merge |
|---|---|---|
| **PR1** | Quick-wins batch (§6) | none |
| **PR2** | Insight-layer revival (change 1) + supersede the 3-paragraph context panel with cards + redeploy prod | keep LLM `takeaways` paragraph? (default: keep headline + takeaways, drop anomalies/opportunities paragraphs in favor of cards) |
| **PR3** | Date-range coherence (change 3 + remaining change-2 labels) | none |
| **PR4** | Tab consolidation: Website→Detail merge (change 5) + BrandedSplit↔AI-Visibility merge (change 10) | ⚑ Website tab removal · ⚑ number-alignment approach |
| **PR5** | Monthly report export (change 7) | none |
| **PR6** | Cross-client triage strip (change 9) | ⚑ signals, quota, latency budget |

**Flagged for later (not in PR1–6):** Looker tab sunset · annotations hidden from client view until used · Content Quality merged into Page SEO Audit · scheduled insight refresh via cron (`vercel.json` change) · TFK target values · per-location trend drill-down on Locations.

---

## Appendix A — Redundancy map
- **Sessions ×6:** exec band (`AnalyticsSection.tsx:234`) · KPI strip (`DashboardTabs.tsx:363-374`) · traffic trend (:341-346) · Website KPI row (`WebsiteTab.tsx:28`) · channel chart (×2 render sites, §2.4) · 13-month table (`MetricTable13.tsx:13`).
- **Organic clicks ×4:** exec band (:240) · KPI strip · SEO tab KPI row (`SeoTab.tsx:59`) · 13-month table.
- **GBP calls ×3:** exec band (:248) · GbpOverview tiles (`DashboardTabs.tsx:156-167`) · LocationLeaderboard column.
- **Branded share ×2 with different answers:** BrandedSplit module (period-aware, configured terms) vs AI Visibility tool (fixed 90d, heuristic terms).

## Appendix B — Docs drift detail
See §2.8. Files to update in PR1: `.claude/CLAUDE-routes.md`, `.claude/CLAUDE-seo-tools.md`, `.claude/CLAUDE-db-schema.md`, `CLAUDE.md` (test-framework + Ask LVL3 params), `design-system/DESIGN.md` (tool-sweep follow-up: done).

## Appendix C — Screenshot manifest
Captured logged-in (admin), read-only, viewports 1440×900 and 375×812, against production. Files: `docs/audit/screens/<surface>-<client|na>-<width>.png`. Dashboard tabs × {TFK, MantelMount-generic}, Home, tools hub, all 16 tool landing states, Ask LVL3. Where a screenshot contradicts a code-derived score above, the screenshot wins and the row is annotated.
