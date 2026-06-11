# LVL3 Portal — Analytics UX Audit

**Date:** 2026-06-11 · **Scope:** `/dashboard` (all tabs, all modules) + all 16 active `/tools` + Ask LVL3 + supporting shell surfaces
**Evidence:** every claim cites `file:line` (repo @ `087dc4d`), a live prod-DB query (Supabase project `zoeaifsxnaenlcdkavzf`, 2026-06-11), or a screenshot (`SS:` = `docs/audit/screens/<name>.png`). 58 screenshots captured logged-in against production at 1440×900 and 375×812; 32 reviewed in detail (the rest are viewport variants of confirmed patterns — manifest in Appendix C).
**Status:** AUDIT ONLY — no feature code ships until the phased plan (§7) is approved.

---

## 0. Executive summary

The analyst tooling is genuinely strong — Content Refresh Finder, the SEO Content Engine, GBP Audit, and the Locations modules would survive a day-one demo to Ryan Metcalf without caveats, and the tools hub is the best-crafted surface in the portal. The architecture (type-aware registry, data-gated modules, period-aware fetching) is better than most agency portals. But on the things a CMO-facing reporting product is judged on, the screenshots are blunt:

1. **The first screenful for the flagship client is a wall of four alarm banners**, followed by an exec headline that repeats the same bad news — and that headline is the *fallback*, because the structured insight layer has never rendered in prod for any client (SS: dashboard-snapshot-tfk-1440; §2.1, §2.10).
2. **The numbers contradict each other across surfaces.** Home says 385.3K sessions while the dashboard says 481.0K for the same client; the dashboard says 79% branded share while the AI Visibility tool says 64%; the TopBar says "Updated 112d ago" for a client whose analytics refreshed yesterday (§2.12).
3. **An incomplete month renders as a crash.** The 13-month table and trend treat 11 days of June as a full month: "Jun 2026 −69% sessions MoM", YoY strip "−50%…−79%", and both 13-month charts end in a fabricated nosedive (SS: dashboard-detail-mm-1440; §2.11).
4. **Nothing can leave the dashboard** — no print/PDF/CSV of any dashboard view — and **nothing aggregates across clients** for weekly triage. Those two, plus the dead insight layer, are the three biggest gaps vs the benchmark bar (AgencyAnalytics / Triple Whale / polished Looker templates) (§2.9).

The plan below is net-negative UI: 2 tabs removed, 1 KPI block removed, 2 tools merged, 1 broken tool fixed — against 1 export button, 1 settings nudge, and 1 admin triage strip added.

---

## 1. Methodology & evidence

### 1.1 What was examined
Full code read of `app/(dashboard)/dashboard/*`, `components/dashboard/**`, `components/analytics/**`, `app/(dashboard)/tools/**` (19 registry entries), `app/actions/*`, `lib/dashboard/*`, `lib/tools/registry.ts`, shell/nav/settings; live prod DB (read-only); 58 production screenshots (read-only session — no settings changed, no generators run).

### 1.2 Test matrix — as it actually exists in prod (DB, 2026-06-11)

| Client | client_type | GA4 | GSC | GBP | Competitors | Key events | Brand terms | Targets | Insights refreshed |
|---|---|---|---|---|---|---|---|---|---|
| True Food Kitchen | `multi_location` | ✅ | ✅ | ✅ | 5 | 4 | 9 | **none** | 2026-06-11 |
| MantelMount | null (generic) | ✅ | ✅ | — | 0 | 0 | 0 | none | 2026-06-10 |
| Pasha Health | null (generic) | ✅ | ✅ | — | 0 | 0 | 0 | none | 2026-05-14 |
| Tapps Electric | null (generic) | ✅ | ✅ | — | 0 | 0 | 0 | none | **2026-02-20** |

Notes: (a) the brief assumed TFK had targets — it does not, so Goals & Pacing and goal-miss alerts are invisible even for the flagship client (audited as a finding, per Matt); (b) no GA4-only client exists — partial-config behavior audited by code path (modules self-gate non-fatally, `AnalyticsSection.tsx:139-147`); (c) client-role experience audited by code trace (no client credential); (d) MantelMount has GA4 revenue ($833.4K, SS: dashboard-website-mm-1440) but `client_type=null` — the ecommerce exec band never shows; `inferClientType()` exists in settings but hasn't been applied; (e) usage evidence is internal-only by design: `tool_runs` 2 rows, `client_annotations` 0, `deliverables` 1, `semrush_reports` 3, Ask LVL3 6 threads/45 messages.

---

## 2. Headline findings

### 2.1 The structured insight layer is dead in prod (highest-leverage fix in the portal)
`generateAnalyticsInsights` unconditionally writes `headline`, `cards[]`, `generatedAt` (`app/actions/analytics.ts:381-388`). **DB:** all four clients' `snapshot_insights` contain only legacy `takeaways/anomalies/opportunities` — TFK included, refreshed the day of this audit. Since `cards` and `generatedAt` are written unconditionally, prod must be running a build predating the writer. Effect: `AnalyticsSection.tsx:158` reads `cards ?? []` → InsightCards has never rendered; the exec headline always falls back to the generic sessions sentence (`AnalyticsSection.tsx:256-265`) — visible in SS: dashboard-snapshot-tfk-1440 ("Sessions down 28% vs the prior period" under a "vs. prior year" selector).

### 2.2 Snapshot composition: alarm wall + self-duplication (SS: dashboard-snapshot-tfk-1440, -375)
The flagship client's entire first viewport is four stacked alert banners (Sessions −28% / GBP calls −19% / Organic clicks −18.9% / 4 locations flagged closed) before a single chart; the exec band below then **repeats alert #1 as the headline**, and its three KPI cards repeat the same three metrics as the alerts. On mobile the alert stack alone is ~1.5 screens. Below that, the KPI strip (`DashboardTabs.tsx:358-375`) repeats sessions/clicks a third time. Meanwhile the right ~40% of the exec band is empty at 1440. Alert *wording* is factual and well-built (ranked, deduped, capped at 6 — `lib/dashboard/alerts.ts:119-296`); it's the *composition* that reads as crisis.

### 2.3 Comparison-frame and window honesty
The section eyebrows are correct ("WEBSITE PERFORMANCE · vs. prior year", SS: dashboard-website-tfk-1440). What's wrong:
- The exec fallback headline says "vs the prior period" under a YoY selector (§2.1).
- KPI hover-tooltip copy hardcodes "last 30 days"/"28 days" regardless of period (`AnalyticsKpiStrip.tsx:44,51`; same in `WebsiteKpiRow`).
- The two monthly trend charts are pinned to 6 months while their tabs follow the picker (`lib/google-analytics.ts:206-208,256-265`; `lib/google-search-console.ts:158-160`; label `WebsiteTab.tsx:40`).
- The AI narrative is generated from "last 30 days vs prior period" (`app/actions/analytics.ts:309,319`) while the dashboard defaults to last-full-month vs YoY — **DB:** TFK's stored narrative opens "Over the last 30 days … declines of 20% and 18% … compared to the prior period."
- Fixed-by-design surfaces (pacing MTD, 13-month, Competitive) carry no on-screen window label.

### 2.4 Partial-month cliff — data-correctness bug (SS: dashboard-detail-mm-1440, dashboard-detail-tfk-375)
The 13-month surfaces treat June 2026 (11 days elapsed) as a complete month: MantelMount's table leads "Jun 2026 · 32,913 sessions ↘ −69%" with MoM badges on the partial row; the YoY strip reads "JUN 2026 VS JUN 2025: −50% / −68% / −79% / −60% / −55%"; both clients' 13-month trend charts end in a fabricated nosedive. Source: `get13MonthTable` (`app/actions/dashboard-metrics-table.ts`) includes the current MTD month undifferentiated; `MetricTable13.tsx:96-152` then headlines it. Any client (or Ryan) seeing this would conclude the account is collapsing.

### 2.5 Delta color semantics — everything reads red (SS: dashboard-website-tfk-1440, dashboard-seo-tfk-1440)
KPI values are brand-red by design; up-deltas render `text-accent-400` (= brand red, `DeltaChip.tsx:14`, `tailwind.config.ts:42-53`) and down-deltas `text-rose-400` (`DeltaChip.tsx:23`) — visually near-identical hues. "↑ Up 22%" and "↓ Down 28%" differ only by arrow glyph. On a page already using red as the accent, nothing distinguishes good from bad at a glance; positive results are invisible as positives.

### 2.6 Dead / stub UI (SS: dashboard-definitions-tfk-1440)
Definitions tab = one placeholder card ("Metric definitions and methodology notes will appear here.") + an `Admin: Edit` button with no handler (`DashboardTabs.tsx:516-535`) on an otherwise empty page. Looker "Full Dashboard" tab captured stuck on "Loading dashboard…" (SS: dashboard-full-tfk-1440) with only the cache disclaimer rendered. Three `coming-soon` registry stubs are correctly hidden (`lib/tools/registry.ts:257-300`).

### 2.7 Empty-by-default features
Targets: 0/4 clients configured → pacing module self-hides (`Targets.tsx:93-94`), goal alerts can never fire, no admin nudge exists. Annotations: 0 rows ever. ActivityFeed: driven by deliverables (1 row). The single best retention story — *what we did → what happened* — has no data anywhere in the product.

### 2.8 Tone & trust for client eyes
- "⚠ 5 FAILED · 50 locations" badge on the Location Leaderboard (SS: dashboard-locations-tfk-1440) — those are per-location *fetch* errors (`LocationLeaderboard.tsx:186-189`), but it reads like five failing restaurants.
- Health chip says "A · GBP Profiles (50)" directly under an alert about 4 closed locations (same SS) — mixed signals with no reconciliation.
- InsightCards' severity chip is labeled literally "Critical" (`InsightCards.tsx:36`) — not yet client-visible only because the module is dead (§2.1).
- GSC raw error text correctly admin-gated (`SeoTab.tsx:77-82`).

### 2.9 Benchmark bar — three biggest gaps vs AgencyAnalytics / Triple Whale / Looker templates
1. **Delivery:** no print/PDF/CSV/scheduled digest of any dashboard view (exports exist only inside tools — `components/tools/primitives/ExportTool.tsx`).
2. **Portfolio view:** no cross-client "what needs attention" surface; triage requires visiting each client.
3. **Verdict layer:** insights dead (§2.1) + frame inconsistency (§2.3) + alarm-wall composition (§2.2) — competitors lead with one consistent, dated, plain-English verdict.

### 2.10 Cross-surface number conflicts (trust killers, all screenshot-cited)
| Conflict | Surface A | Surface B |
|---|---|---|
| Sessions 385.3K vs 481.0K (same client, same day) | Home KPI strip, rolling 30d unlabeled (SS: home-tfk-1440) | Dashboard exec band, last full month (SS: dashboard-snapshot-tfk-1440) |
| Branded share 79% vs 64% | BrandedSplit module — period-aware, configured `brand_terms` (SS: dashboard-detail-tfk-1440) | AI Visibility tool — fixed 90d, name/slug heuristic (SS: tool-ai-visibility-na-1440) |
| "Updated 2h ago / 112d ago" header chip | TopBar reads `ai_summary_updated_at` — the *project sheet* summary — labeled "Client data last synced" (`app/(dashboard)/layout.tsx:122`, `TopBar.tsx:174-176`) | Actual analytics freshness (MantelMount: 1 day) |

### 2.11 Live defects found in production (screenshot-cited)
- **Backlink Overview is broken:** renders "Semrush API error: query type not found" on load (SS: tool-backlink-overview-na-1440) — an API-parameter bug in `fetchSemrushBacklinksOverview` (`lib/connectors/semrush-portal.ts`), not quota (the error box's own hint text notwithstanding).
- **Sessions-by-Channel chart leaves its largest bar unlabeled** — y-axis tick skipping hides alternating labels, including the top channel (SS: dashboard-website-tfk-1440, dashboard-website-mm-1440; fix: `interval={0}` on the YAxis in `ChannelBarChart.tsx`).
- **Ask LVL3 renders raw markdown** — literal `**` and `###` in assistant replies (SS: ask-lvl3-na-1440); artifacts/threads/status streaming otherwise excellent.
- **Every tool page renders its title + description twice** (breadcrumb header block + in-card header — SS: tool-semrush-gap, tool-seo-content-engine, tool-gbp-audit) and GBP Audit's inner title is monospace while others are sans.
- **Semrush Gap doesn't pre-fill the 5 competitors stored in client settings** (empty "competitor1.com" field, SS: tool-semrush-gap-na-1440) — while Content Engine *does* pre-fill brand context from settings (SS: tool-seo-content-engine-na-1440). Blog Image Generator's default style rules are MantelMount-specific copy shown under any client (SS: tool-blog-image-generator-na-1440).

### 2.12 Theme & docs drift
Rose-vs-red ad-hoc negative states (`MetricTable13.tsx:47` uses raw `emerald-400`/`red-400`); stale "dark-theme" comments (`Targets.tsx`, `InsightCards.tsx`, `Sparkline.tsx`); tools dir is **clean** of the violet hex DESIGN.md flags as follow-up (sweep already done). Docs: `.claude/CLAUDE-routes.md:10-15` + `CLAUDE-seo-tools.md` list 5 tools vs 19 registry entries (16 active, `lib/tools/registry.ts:25-316`); `CLAUDE-db-schema.md` has `semrush_project_id` (doesn't exist) and omits `brand_context` (does); CLAUDE.md "No test framework" is wrong (8 vitest files + Playwright smoke); Ask LVL3 docs say `max_tokens: 1024`, code says 4096 (`app/api/ask-lvl3/route.ts:219`).

---

## 3. Scorecard & ranking

Scales 1–5: **U**sefulness · **I**nsightfulness · **D**igestibility · **V**isualization · **C**raft. 5 = changes a decision / best-in-class; 1 = nobody would miss it / actively confusing. Scored **as deployed** (potential noted). Visual scores finalized from screenshots.

### 3.1 Dashboard tabs

| Tab | U | I | D | V | C | Evidence (one line) |
|---|---|---|---|---|---|---|
| Snapshot | 4 | 3 | **2** | 3 | 4 | Alarm wall + triple metric repetition above the fold (SS: dashboard-snapshot-tfk-1440); composition right in code order (`DashboardTabs.tsx:329-427`), wrong in lived experience |
| Locations | 4 | 3 | 4 | 3 | 4 | Tiles + gaps line + leaderboard render exactly as designed (SS: dashboard-locations-tfk-1440); "5 FAILED" badge + A-grade-vs-closures mixed signal |
| Detail | 3 | 3 | 3 | 3 | 3 | Real content (13-mo trend, converting pages, 79% branded donut — SS: dashboard-detail-tfk-1440) organized by data source; partial-month cliff poisons the headline chart (§2.4); cramped headers in half-width tables |
| SEO | 3 | 3 | 3 | 3 | 3 | Clean KPI cards + device donut + landing pages with deltas (SS: dashboard-seo-tfk-1440); no query movers; 6-mo trend pinned |
| Website | 2 | 2 | 3 | **2** | 3 | Duplicates Snapshot channel chart + sessions KPI (SS: dashboard-website-tfk-1440 vs -snapshot-); largest channel bar unlabeled (§2.11) |
| Full Dashboard (Looker) | 2 | 2 | 2 | 2 | 2 | Captured stuck on "Loading dashboard…" with cache disclaimer (SS: dashboard-full-tfk-1440) |
| Definitions & Notes | 1 | 1 | 1 | 1 | 1 | One placeholder card + dead button on an empty page (SS: dashboard-definitions-tfk-1440; `DashboardTabs.tsx:516-535`) |

### 3.2 Dashboard modules / exec band

| Module | U | I | D | V | C | Evidence |
|---|---|---|---|---|---|---|
| ExecutiveSummaryBand | 4 | 3 | 4 | 3 | 4 | KPIs + sparklines render well; headline = fallback duplicating alert #1; ~40% empty width at 1440; red-on-red deltas (SS: dashboard-snapshot-tfk-1440) |
| Alerts | 4 | 4 | **3** | 3 | 4 | Wording factual (`alerts.ts:156-215`); four full-width banners consume the first screenful (SS: dashboard-snapshot-tfk-1440/-375); not dismissible, no collapse |
| TrendChart + ghost overlay | 4 | 4 | 4 | 4 | 4 | Ghost YoY line + legend render beautifully (SS: dashboard-snapshot-mm-1440) — best chart in the app |
| MetricTable13 (admin) | 5 | **3** | 4 | 3 | 4 | The QBR workhorse (SS: dashboard-detail-mm-1440) — currently leading with fabricated −69% MoM from the partial month (§2.4); no export; raw emerald/red (:47) |
| LocationLeaderboard | 5 | 4 | 4 | 3 | 4 | Sortable, city-labeled, dense in the right way (SS: dashboard-locations-tfk-1440); "5 FAILED" wording; no per-row deltas or drill-down |
| LocationCompleteness | 4 | 4 | 4 | 3 | 4 | "Top profile gaps: closed (4) · hours (1) · description (1)" — actionable in one line (same SS) |
| BrandedSplit (+intent) | 4 | 4 | 4 | 4 | 4 | 79% donut + local/general bar (SS: dashboard-detail-tfk-1440); contradicts tool's 64% (§2.10) |
| GbpOverview tiles | 4 | 3 | 4 | 3 | 4 | 5 KPI tiles + profile-gap line (SS: dashboard-locations-tfk-1440) |
| Competitive | 4 | 4 | 4 | 3 | 3 | Table well-formed (code: `Competitive.tsx:80-131`); static, not period-aware (`AnalyticsSection.tsx:146`); not captured (below fold) |
| ConvertingPages | 4 | 3 | 4 | 3 | **3** | Right data (SS: dashboard-detail-tfk-1440); column headers truncate ("CON RAT") in half-width card; clipped on mobile without scroll hint (SS: dashboard-detail-tfk-375) |
| Top-locations chart | 3 | 3 | 4 | 4 | 4 | All 8 bars labeled, top bar accented (SS: dashboard-locations-tfk-1440) |
| ChannelBarChart (Snapshot + Website) | 3 | 2 | 4 | **2** | 3 | Largest bar unlabeled on both captures (§2.11); rendered twice per client |
| ContentPerformance | 3 | 3 | 3 | 3 | 3 | Inline bars (code: `ContentPerformance.tsx:25-96`); below fold in captures |
| EcomFunnel / TopProducts | 3 | 3 | 4 | 3 | 3 | Well-built (`EcomFunnel.tsx:51-114`); no ecommerce-typed client exists, so never rendered in prod |
| Context panel (3 AI paragraphs) | 2 | 3 | 2 | – | 3 | Wall of AI text in the wrong frame (§2.3); supersede with cards |
| KPI strip on Snapshot | 2 | 2 | 3 | 3 | 3 | Third rendering of the same numbers on one tab (`DashboardTabs.tsx:358-375`) |
| InsightCards (as shipped) | 2 | 2 | 4 | 3 | 3 | Never rendered in prod (§2.1); good card design in code (`InsightCards.tsx:46-114`); "Critical" chip label; potential 5 |
| Annotations (as used) | 1 | 1 | 3 | – | 3 | 0 rows ever (DB); placeholder shows instead |
| Targets/pacing (as deployed) | 1 | 1 | 4 | 3 | 4 | Sound run-rate math (`lib/dashboard/pacing.ts`) invisible: no client has targets, no nudge |

### 3.3 Tools (+ hub + Ask LVL3)

| Tool | U | I | D | V/C | Evidence |
|---|---|---|---|---|---|
| Content Refresh Finder | 5 | 5 | 4 | 5 | Cleanest landing in the portal: breadcrumb, NEW badge, plain-English method, single CTA (SS: tool-content-refresh-finder-na-1440); decline→brief→Engine handoff is a workflow, not a report |
| SEO Content Engine | 5 | 3 | 3 | 4 | 4-tab pipeline, xlsx drop zone with expected columns, brand context **pre-filled from settings** (SS: tool-seo-content-engine-na-1440); complexity tax on first use |
| Keyword Quick Wins | 4 | 4 | 4 | 4 | Auto-runs on load → full 50-row opportunity table + exports (SS: tool-keyword-quick-wins-na-1440); score formula only explained in footnote |
| Content Gap Finder | 4 | 4 | 3 | 4 | ~50 rows with color-coded gap-type chips + exports (SS: tool-content-gaps-na-1440); dense but scannable |
| Semrush Gap Analysis | 4 | 4 | 3 | 4 | Clean form, pre-filled client domain (SS: tool-semrush-gap-na-1440); does NOT pre-fill stored competitors (§2.11) |
| GBP Audit | 4 | 4 | 4 | 4 | Account picker + "Auditing for: True Food Kitchen" + Run (SS: tool-gbp-audit-na-1440); inner title font inconsistent (mono) |
| Keyword Research | 4 | 3 | 4 | 4 | Textarea + country + Research; placeholder examples (SS: tool-keyword-research-na-1440) |
| Page SEO Audit | 4 | 3 | 4 | 4 | Single URL input + Audit (SS: tool-page-seo-audit-na-1440) |
| Ask LVL3 | 4 | 4 | 4 | **3** | Threads, artifact chips with download, status streaming (SS: ask-lvl3-na-1440); renders raw markdown — literal `**`/`###` in replies (§2.11) |
| Tools hub | 4 | – | 4 | 5 | Search + categories + New/Recent sections (SS: tools-hub-na-1440); New-status tools render twice (New section + category) — 20 cards for 16 tools |
| Core Web Vitals | 3 | 3 | 4 | 4 | URL + strategy + Analyze (SS: tool-core-web-vitals-na-1440) |
| Vertical Benchmark | 3 | 4 | 3 | 4 | Auto-includes client gap analysis; disabled CTA until input (SS: tool-vertical-benchmark-na-1440) |
| AI Visibility Check | 3 | 3 | 4 | 4 | Auto-runs: 64% branded share + query tables + footnote admitting heuristic terms (SS: tool-ai-visibility-na-1440); contradicts module's 79% (§2.10) |
| Landing Page CRO Audit | 3 | 3 | 3 | 4 | Run/History + clear description (SS: tool-landing-page-cro-audit-na-1440) |
| Content Quality | 3 | 3 | 4 | 4 | URL + Analyze (SS: tool-content-quality-na-1440); second URL-audit tool |
| Blog Image Generator | 3 | 1 | 3 | 4 | Numbered steps + editable style rules (SS: tool-blog-image-generator-na-1440); defaults are MantelMount-specific under any client; results not persisted |
| TFK Generator | 3 | 2 | 3 | 4 | Generate/Preview/Validation tabs, two entry paths (SS: tool-tfk-generator-na-1440); bespoke single-client |
| Backlink Overview | **1** | 2 | 4 | 3 | **Broken in prod**: "Semrush API error: query type not found" on load (SS: tool-backlink-overview-na-1440); friendly error box, dead tool |

### 3.4 Overall ranking (best → worst)

**Tier 1 — demo to Ryan day one:** Content Refresh Finder · LocationLeaderboard · SEO Content Engine · TrendChart+ghost · BrandedSplit · Tools hub · LocationCompleteness · GBP Audit · Keyword Quick Wins
**Tier 2 — good, needs polish:** MetricTable13 (after §2.4 fix; with the bug it would mislead in a QBR) · Ask LVL3 · Content Gaps · Semrush Gap · Alerts (wording yes, composition no) · ExecutiveSummaryBand · GbpOverview · Keyword Research · Page SEO Audit · Locations tab · Competitive · ConvertingPages
**Tier 3 — serviceable:** Snapshot tab (potential Tier 1 after PR2) · SEO tab · Detail tab · Core Web Vitals · Vertical Benchmark · CRO Audit · Content Quality · Top-locations chart · EcomFunnel/TopProducts · ContentPerformance
**Tier 4 — cut, merge, fix, or revive:** AI Visibility (merge) · ChannelBarChart (fix labels, render once) · Website tab (merge) · KPI strip on Snapshot (cut) · Blog Image Gen (persist or accept ephemerality) · TFK Generator (bespoke) · Looker tab (sunset path) · Context paragraphs (supersede) · Annotations as-used · Targets as-deployed · InsightCards as-shipped (revive — highest leverage) · **Backlink Overview (broken — fix or fold)** · **Definitions tab (cut — bottom)**

---

## 4. Job coverage — every surface mapped to a recurring job

Jobs: **(a)** monthly reporting / QBR prep · **(b)** new-client onboarding & setup · **(c)** weekly cross-client triage · **(d)** SEO production work · **(e)** client self-serve check-in.

| Surface | Jobs | Verdict |
|---|---|---|
| Snapshot (exec band, alerts, trend, channels) | a, e | **Keep** — recompose (§5 #2), revive insights (#1) |
| KPI strip on Snapshot | a (dup) | **Cut** from Snapshot (Home keeps compact use) |
| Context panel (3 paragraphs) | a, e (dup) | **Merge** into InsightCards once live |
| InsightCards / headline | a, e | **Keep + revive** |
| Targets & pacing | a, e | **Keep + nudge** (invisible today) |
| Annotations | a, e | **Keep admin-side; hide from client view until used** (decision) |
| Locations tab (tiles, leaderboard, completeness) | a, d-local, e | **Keep** — flagship |
| Detail modules (funnel, products, converting, content, branded, competitive) | a, d | **Keep**, gated as-is |
| MetricTable13 | a (QBR) | **Keep + fix partial month + export** |
| Website tab | a (dup) | **Merge into Detail** (decision) |
| SEO tab | a, d | **Keep**; period-fix + query movers later |
| Full Dashboard (Looker) | a (legacy) | **Keep for now; flag sunset** (decision) |
| Definitions tab | — | **Cut** (dead) |
| Home (KPI strip, queues, narrative) | c (weak), e | **Keep; label its window; host the triage strip** |
| Quick Wins / Content Gaps / Refresh Finder / Content Engine / Keyword Research / Semrush Gap | d | **Keep** — strongest area of the portal |
| GBP Audit / Page SEO Audit / Vertical Benchmark / CWV / CRO Audit | b, d | **Keep** |
| AI Visibility tool | d (dup) | **Merge** with BrandedSplit (decision) |
| Content Quality tool | d (dup) | **Merge** into Page SEO Audit (decision) |
| Backlink Overview | a, d | **Fix the Semrush call**, then fold into the Competitive surface (decision) |
| Blog Image Gen / TFK Gen | d-adjacent | **Keep**, low priority |
| Ask LVL3 | a, c, d (ad hoc) | **Keep + render markdown** |
| Client settings form (+ Recommend buttons, type auto-detect) | b | **Keep** — onboarding well served (`ClientSettingsForm.tsx:345-886`); apply auto-detect to MantelMount |

**Gap analysis:** job **(a)** dead-ends at delivery (no export); job **(c)** has **no surface at all**; (b) and (d) are well covered; (e) fails the trust pass (§2.8, §2.10) until PR1–2 land.

**Ryan Metcalf day-one test:** Tier 1 passes clean. Snapshot fails as-deployed — the meeting opens with four alarms, a duplicate headline, and (on Detail) a fabricated −69% June. After PR1+PR2 below, Snapshot and the 13-month table both pass without caveats.

---

## 5. Top 10 changes (ranked by impact ÷ effort; file lists validated against code)

| # | Problem → Change | Files | Effort | Removes / replaces | Decision? |
|---|---|---|---|---|---|
| 1 | Insight layer dead (§2.1) → derive InsightCards **live at render** from current-period deltas (prefer live period-correct cards; stored insights only for LLM headline/takeaways) + **redeploy prod**; fix fallback-headline frame text | `components/dashboard/AnalyticsSection.tsx` (~15 lines; `deriveInsightCards` is pure) | **S** | Replaces stale stored cards + wrong-frame fallback | Ops: confirm prod deploy currency |
| 2 | Partial-month cliff (§2.4) → mark the current month MTD: label the row "Jun 2026 (MTD)", suppress MoM/YoY badges on it, end the 13-mo trend at the last complete month (or dash the MTD segment) | `app/actions/dashboard-metrics-table.ts`, `components/dashboard/modules/MetricTable13.tsx`, `DashboardTabs.tsx:451-457` (trend derivation) | **S** | Replaces fabricated decline story | — |
| 3 | Alarm wall + triple duplication (§2.2) → collapse alerts to one compact strip (highest severity + "+N more" expander), suppress the exec headline when it duplicates the top alert, drop the KPI strip from Snapshot | `components/dashboard/modules/Alerts.tsx`, `AnalyticsSection.tsx`, `DashboardTabs.tsx:358-375` | **S–M** | **Removes duplicate KPI block + 3 banner rows** | — |
| 4 | Up/down both red (§2.5) → semantic delta colors: down = rose, up = emerald (or ink), flat = muted; align `MetricTable13` badges with the same tokens | `components/ui/DeltaChip.tsx:14,23`, `MetricTable13.tsx:47` | **S** | Replaces ambiguous color coding | ⚑ confirm green is acceptable in the one-accent IgniteIQ system (alternative: ink + arrow weight) |
| 5 | Dead Definitions tab (§2.6) → **cut tab + dead button**; definitions move into the existing KpiCard `tooltip` prop (add `tooltip` to `ExecKpi` + pass-through) | `DashboardTabs.tsx`, `ExecutiveSummaryBand.tsx`, `AnalyticsSection.tsx` | **S** | **Removes a tab** | — |
| 6 | Website tab duplicates Snapshot → **merge into Detail** (move SourceMediumTable + MonthlySessionsChart; delete WebsiteTab + WebsiteKpiRow); gate fix `hasDetail ||= hasAnalytics` (`DashboardTabs.tsx:232-234`); fix ChannelBarChart label skipping (`interval={0}`) and render it once | `DashboardTabs.tsx`; delete `WebsiteTab.tsx`, `WebsiteKpiRow.tsx`; `ChannelBarChart.tsx` | **M** | **Removes a tab + dup chart + dup KPI row** | ⚑ tab removal |
| 7 | No report delivery (§2.9) → `@media print` stylesheet (fix `calc(100vh-56px)` clip, `AnalyticsSection.tsx:284`) + "Print / Save PDF" button + CSV/XLSX export of MetricTable13 via ExportTool with `persist?: boolean` prop — no new packages (xlsx is a dep) | `app/globals.css`, `DashboardTabs.tsx`, `components/tools/primitives/ExportTool.tsx` | **M** | Net-zero: pairs with the two tab removals | — |
| 8 | Trust & freshness (§2.10) → TopBar chip reads analytics freshness (or per-surface stamps: exec band gets `updatedAt`, Home strip gets "last 30 days" label); align Home strip window or label it; move (don't duplicate) the context-panel timestamp | `app/(dashboard)/layout.tsx:122`, `components/nav/TopBar.tsx:170-178`, `ExecutiveSummaryBand.tsx`, `app/(dashboard)/page.tsx:124-142` | **S–M** | Replaces misleading "112d ago" chip | ⚑ which timestamp the TopBar should show |
| 9 | No cross-client triage (job c) → admin-only strip on Home: per-client sessions delta + pacing-behind + GBP health via clientId-accepting paths (`fetchAnalyticsData`, `fetchDashboardGBP`, `getPacingActuals` — the `dashboard-*` convenience actions resolve the *selected* client and cannot be looped); Suspense-deferred, concurrency-capped; cold cache ≈5–10 Google calls/client (6h `cachedFetch` TTL) | new `app/actions/admin-triage.ts`, new `components/home/AdminTriageStrip.tsx`, `app/(dashboard)/page.tsx` | **L** | Slim Home's quick-nav to compensate | ⚑ signals + quota strategy |
| 10 | One branded-share answer (§2.10) + tool paper-cuts → align AI Visibility window/terms with BrandedSplit (use configured `brand_terms`, follow period or label "90d"), admin-gated deep-link module→tool, drop tool's dup KPI cards; fix Backlink Overview Semrush call; render markdown in Ask LVL3; dedupe tool page headers; pre-fill Semrush Gap competitors from settings; "5 FAILED"→"5 locations: data unavailable" | `app/actions/tools.ts`, `tools/ai-visibility/page.tsx`, `BrandedSplit.tsx`, `lib/connectors/semrush-portal.ts`, `AskLvl3Chat.tsx`, tool page headers, `SemrushGapClient.tsx`, `LocationLeaderboard.tsx:186-189` | **M** | **Merges a tool into a module; fixes a broken tool** | ⚑ alignment approach |

Also recommended, zero-code: set TFK monthly targets; run type auto-detect for MantelMount (likely `ecommerce` — $833.4K revenue, SS: dashboard-website-mm-1440); refresh Pasha/Tapps insights after redeploy.

---

## 6. Quick-wins batch (each <1h — one approvable PR; most touch `DashboardTabs.tsx`, so they land together)

1. Cut Definitions tab + dead "Admin: Edit" button (change 5).
2. Drop the duplicate KPI strip from Snapshot (part of change 3).
3. Partial-month fix (change 2 — small and data-critical).
4. Delta color semantics (change 4) + `MetricTable13` token alignment.
5. Targets "Set monthly goals →" admin nudge (`Targets.tsx:93-94`; pass `isAdmin`+`clientId` from `DashboardTabs.tsx:338`).
6. ChannelBarChart `interval={0}` label fix.
7. Honest copy: KPI tooltip windows (`AnalyticsKpiStrip.tsx:44,51`), "5 FAILED" → "data unavailable", "Critical" chip → "Attention" (`InsightCards.tsx:36`), Home strip "last 30 days" label.
8. Exec-band freshness stamp (move from context panel, `DashboardTabs.tsx:384-391` → `ExecutiveSummaryBand`).
9. Stale "dark-theme" comments deleted; ExportTool aria-labels.
10. Docs refresh: 19-entry registry into `.claude/CLAUDE-routes.md` + `CLAUDE-seo-tools.md`; `CLAUDE-db-schema.md` drift; CLAUDE.md test-framework + Ask LVL3 params.

---

## 7. Phased plan — each phase = one shippable PR (`npx tsc --noEmit` + `npm run build` green; no new packages; **no migrations in any PR**; modules stay gated so unconfigured clients keep the clean generic view)

| PR | Contents | Decisions needed before merge |
|---|---|---|
| **PR1 — Correctness & quick wins** | §6 batch (includes partial-month fix, delta colors, label fixes, honest copy) | ⚑ delta up-color (emerald vs ink) |
| **PR2 — Verdict layer** | Insight revival (change 1) + alert-strip recomposition (change 3 remainder) + supersede context paragraphs with cards + **redeploy prod** + refresh all clients' insights | ⚑ keep LLM takeaways paragraph? (default: headline + takeaways stay, anomalies/opportunities paragraphs replaced by cards) |
| **PR3 — Date coherence** | 6-month trends become period-aware via existing `fetchGA4Trend`/`fetchGSCTrend`; AI-narrative frame matches selected compare; fixed-window labels (pacing/13-mo/Competitive) | — |
| **PR4 — Consolidation** | Website→Detail merge (change 6) + AI-Visibility↔BrandedSplit merge + tool paper-cuts batch (change 10) | ⚑ Website tab removal · ⚑ branded-share alignment approach |
| **PR5 — Delivery** | Print/PDF + CSV/XLSX export (change 7) + TopBar freshness fix (change 8) | ⚑ TopBar timestamp source |
| **PR6 — Portfolio triage** | Admin cross-client strip (change 9) | ⚑ signals, quota, latency budget |

**Flagged for later (not PR1–6):** Looker tab sunset · annotations hidden from client view until used · Content Quality folded into Page SEO Audit · Backlink Overview folded into Competitive · scheduled insight refresh via cron (`vercel.json`) · per-location drill-down on Locations · SEO tab "query movers" (what changed vs prior period) · client-role end-to-end walkthrough once a test credential exists.

---

## Appendix A — Redundancy map
- **Sessions ×6:** exec band (`AnalyticsSection.tsx:234`) · KPI strip (`DashboardTabs.tsx:363-374`) · traffic trend (:341-346) · Website KPI row (`WebsiteTab.tsx:28`) · channel chart (two render sites) · 13-month table (`MetricTable13.tsx:13`). Plus Home's conflicting 30-day figure (§2.10).
- **Organic clicks ×4:** exec band (:240) · KPI strip · SEO tab KPI row (`SeoTab.tsx:59`) · 13-month table.
- **GBP calls ×3:** exec band (:248) · GbpOverview tiles · LocationLeaderboard column.
- **Branded share ×2, two answers:** module 79% vs tool 64% (§2.10).
- **Tool page titles ×2 on every tool** (§2.11).

## Appendix B — Docs drift detail
See §2.12. Files for PR1: `.claude/CLAUDE-routes.md`, `.claude/CLAUDE-seo-tools.md`, `.claude/CLAUDE-db-schema.md`, `CLAUDE.md`, `design-system/DESIGN.md` (mark tool-sweep follow-up done).

## Appendix C — Screenshot manifest
58 files in `docs/audit/screens/`, captured 2026-06-11 against production, logged in as admin, strictly read-only, viewports 1440×900 and 375×812 (above-the-fold composition; hub/quick-wins/content-gaps captured full-page). Naming: `<surface>-<client|na>-<width>.png`; clients: `tfk` = True Food Kitchen (fully configured), `mm` = MantelMount (generic `client_type=null`). Reviewed in detail: all dashboard tabs ×2 clients at 1440 + key 375 variants, Home, tools hub (both widths), all 16 tool landing states at 1440, Ask LVL3. Remaining files are width variants of reviewed surfaces and were spot-checked for layout breakage only (none found beyond the mobile table-clipping noted in §3.2).
