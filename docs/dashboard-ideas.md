# Dashboard Improvement Ideas

**Goal:** make the Dashboard useful for everyone from a marketing analyst to a CMO, with the layout and KPIs varying by client type (local service business, multi-location restaurant/franchise, e-commerce, lead-gen/B2B).

**Status:** ideas/roadmap document — nothing here is implemented yet. Sections are written so they can be lifted directly into implementation tickets. Feasibility notes reference the actual code that exists today.

**Current state (for context):** the dashboard (`app/(dashboard)/dashboard/`) is a tabbed page — Snapshot / Website / SEO / Full Dashboard (Looker embed) / Definitions — showing GA4 + GSC KPIs with period-over-period deltas, channel and source tables, a device donut, SERP position distribution, top queries/pages, and AI-generated snapshot insights. It is identical for every client regardless of what their business actually sells, and identical for every viewer regardless of what they need to know.

---

## 1. Guiding principles

1. **Layered single page.** The CMO gets their answer in the first screenful — a plain-English headline, the north-star number, and whether things are up or down. The analyst scrolls or tabs into density. No "exec mode" toggle to maintain; one page serves both by vertical hierarchy.
2. **Goal-first, not metric-first.** Every client type has a north-star metric (leads, revenue, orders, key events). The dashboard leads with it. Sessions and impressions are supporting evidence, not the headline.
3. **Show the agency's impact.** The most valuable thing the dashboard can do for retention is connect *what LVL3 did* to *what happened*. Deliverables, projects, and tool runs are already in the database — overlay them on the outcome charts.
4. **Plain English at the top, density below.** Insight text above the fold reads like a sentence a CMO would repeat in a board meeting. Tables of 25 queries stay — below the fold, for the analyst.
5. **No number without context.** Every KPI gets a trajectory (sparkline), a comparison (delta vs a meaningful baseline), and — where it matters — a flag when something is unusual.

---

## 2. The client-type system (hybrid)

The single biggest structural change: the dashboard composes itself differently per client type.

### New field
- `clients.client_type` enum: `local_service | multi_location | ecommerce | lead_gen` (nullable → null behaves as today's generic dashboard, the fallback).
- Set by admins on the client settings page (`/clients/[id]/settings`).

### Auto-suggest inference (hybrid)
When the field is unset, suggest a default from connected data — admin confirms or overrides:

| Signal | Suggested type |
|---|---|
| GBP connected, > 5 locations | `multi_location` |
| GBP connected, 1–5 locations, no GA4 revenue | `local_service` |
| GA4 `purchaseRevenue` > 0 in trailing 90d | `ecommerce` |
| Otherwise | `lead_gen` |

(All signals are already fetchable: `listGBPLocations()` in `lib/connectors/gbp.ts`, `purchaseRevenue` in `fetchGA4Report()` in `lib/google-analytics.ts`.)

### Module registry
Treat the dashboard as a stack of composable modules (KPI row, trend chart, leaderboard, funnel, health card…). The client type selects the default module set and the KPI definitions. Future: per-client module toggles for admins, so an unusual client can get a custom mix without a new type.

---

## 3. Executive summary band (all types) — the CMO layer

A fixed band at the top of the page, above the tabs. Always visible, never reconfigured by the date picker (see §5.3).

| Element | Description | Data source |
|---|---|---|
| **Headline** | One auto-generated sentence: "Organic leads up 22% in May — best month since January." | `snapshot_insights` (exists; needs a `headline` field added to the JSON shape) |
| **North-star KPIs** | 3–4 type-specific numbers with deltas and 12-month sparklines (see §4 for which) | GA4 / GSC / GBP — mostly fetched today |
| **Health scorecard** | Letter-grade chips: SEO health, GBP health, Site health — click → relevant tab/tool | Composite of GSC trends, Semrush authority, GBP `auditLocation()` scores |
| **What we did → what happened** | Last 3–5 shipped items from `deliverables`/`projects` with dates, replacing the placeholder "What we changed" section | `deliverables`, `projects` tables (exist) |
| **Freshness** | "Data through Jun 9 · insights refreshed 6h ago" | `analytics_summary_updated_at` + GA4 lag note |

The band is intentionally boring in the best way: stable window (last full month vs same month last year), same layout every visit, so a CMO who checks monthly always lands on familiar ground.

---

## 4. Per-type dashboard variants

Each variant = exec-band KPI definitions + a type-specific module inserted as the first analyst tab. Everything below the type-specific module (Website / SEO tabs) stays shared.

### 4a. Local service business (the IgniteIQ core)

**North star: leads** = calls + direction requests + form fills (GA4 key events).

| Module | Contents | Feasibility |
|---|---|---|
| Lead KPI row | Calls (`CALL_CLICKS`), direction requests, website clicks, GA4 key events | ✅ GBP metrics exist in `fetchGBPLocationInsights()`; 🔌 GA4 `keyEvents` is one metric away |
| Local visibility trend | GBP impressions over time, split Search vs Maps | ✅ impressions metrics exist; needs a chart |
| GBP profile health | 0–100 completeness score + issue list (missing hours, description, etc.) | ✅ `auditLocation()` already computes this |
| Local intent queries | GSC queries filtered to geo-modified / "near me" terms; branded vs non-branded split | 🔌 GSC dimension filter, one call away |
| Lead funnel | GBP impressions → website clicks → key events | 🔌 assembled from above |

### 4b. Multi-location (restaurant / franchise)

**North star: orders + bookings** (or calls, configurable).

| Module | Contents | Feasibility |
|---|---|---|
| Brand KPI row | Total food orders (`BUSINESS_FOOD_ORDERS`), bookings, menu clicks, calls — across all locations | ✅ metrics exist per location; needs aggregation |
| **Location leaderboard** | Sortable table: per-location calls / directions / website clicks / orders, with deltas; top-5 and bottom-5 callouts | ✅ data exists; the flagship module for this type |
| Profile completeness heatmap | Audit score per location; flags for suspended / temporarily-closed / incomplete listings | ✅ `auditLocation()` per location |
| Location drill-down | Click a row → that location's trend + profile detail | ✅ `fetchGBPLocationInsights()` supports per-location daily/monthly |
| Rollup trend | Brand-level visibility and actions over time | ✅ aggregate of the above |

> **Engineering note:** N locations × insights = N API calls. Use `api_cache` (`lib/api-cache.ts`) with a long TTL (12–24h — GBP data is not real-time) and consider a nightly Vercel cron prefetch so the leaderboard renders instantly.

### 4c. E-commerce

**North star: revenue.**

| Module | Contents | Feasibility |
|---|---|---|
| Revenue KPI row | Revenue, transactions, conversion rate, AOV (= revenue ÷ transactions) | ✅ revenue + transactions already in `fetchGA4Report()`; conv. rate & AOV are arithmetic |
| Revenue by channel | Add `purchaseRevenue` to the existing channel query → revenue per channel bar chart | 🔌 one metric added to an existing call |
| Shopping funnel | `itemsViewed → addToCarts → checkouts → purchases` with stage conversion % | 🔌 one GA4 call away |
| Top products | Revenue/qty by `itemName` | 🔌 one GA4 dimension away |
| SEO ROI | Organic revenue (✅ `organicTransactions` already fetched) + Semrush `organic_cost` framed as "this organic traffic would cost ~$X/mo in paid" | ✅ both exist |

### 4d. Lead-gen / B2B

**North star: key events (form fills, demo requests).**

| Module | Contents | Feasibility |
|---|---|---|
| Lead KPI row | Key events, lead conv. rate, organic leads, traffic value (Semrush `organic_cost`) | 🔌 GA4 `keyEvents` one call away; needs per-client key-event name config (small JSONB field) |
| Converting pages | Top landing pages by key events, not just sessions | 🔌 one GA4 dimension combo away |
| Content performance | Sessions + conversions by page path section (`/blog/`, `/services/`…) | 🔌 `pagePath` dimension |
| Branded vs non-branded | GSC clicks split by brand-term regex — "is non-brand demand growing?" | 🔌 GSC filter, one call away |

---

## 5. Time, trends & comparisons

How trends are evaluated, what comparison views exist, and how much control the viewer has.

### 5.1 Trend evaluation

- **Trend windows follow the selected period.** Today the trend charts are hardcoded to 6 months regardless of the picker (`lib/google-analytics.ts` ~line 172, GSC equivalent). Fix: granularity auto-selects — daily for 7d/28d, weekly for 90d, monthly for 180d/365d — with a per-chart day/week/month toggle for analysts.
- **Sparkline on every KPI card.** Trailing 12 months behind every number, exec band included. No number without its trajectory. (Extend `components/ui/KpiCard.tsx`.)
- **Trend classification, not just endpoint deltas.** Label each core metric *improving / flat / declining* from the slope of the trailing window. A metric can be +2% vs prior period but in a 6-month decline — endpoint deltas hide that. Feeds the health scorecard (§3) and alerts (§6).
- **Anomaly markers on charts.** Z-score vs the trailing window; unusual days/weeks get a dot on the trend line with a hover explanation. Cheap, rule-based, no AI required.
- **Event annotations.** Vertical markers on trend charts for deliverable ship dates (`deliverables.created_at`), project milestones, and a maintained list of Google algorithm updates. This is the "what we did → what happened" overlay and the single best storytelling feature for retention.
- **Seasonality.** Home services and restaurants are seasonal — YoY becomes the *default* compare for those client types (prior-period stays default for ecom/lead-gen). 7/28-day rolling-average option to de-noise daily series.

### 5.2 Comparison views

- **Ghost overlay on trend charts.** The comparison period drawn as a muted dashed line under the current period. Today comparisons exist *only* as delta chips — you can't see the shape of last year vs this year anywhere.
- **13-month metric table.** Classic agency MoM view: one row per metric, one column per month, mini heat-shading. Analysts and CMOs both read these natively.
- **Segment comparisons over time:** organic vs paid vs direct (stacked area), branded vs non-branded GSC clicks, device mix shift.
- **Type-specific comparisons:** location vs location side-by-side (multi-location); share-of-voice vs named competitors over time (Semrush `semrush_reports`); channel revenue mix (ecommerce).
- **Record framing for execs:** "best month since March 2025," all-time-high badges. Computable from the same monthly series.
- **"vs target"** as a third compare mode once goals/targets exist (phase C, §9).

### 5.3 Date-range & comparison control

| Control | Behavior |
|---|---|
| Preset pills | Keep 7D / 28D / 3M / 6M / 12M (exists) |
| **Calendar-aligned presets** | Add "Last full month," "Month to date," "Quarter to date." CMOs and reporting cycles think in calendar months; today's rolling windows never align with "how did May do?" |
| Custom range | Calendar picker for analysts; custom comparison range too (extend `lib/date-range.ts` — `buildDateRange()` already centralizes this) |
| Compare selector | Prior period / YoY / custom / none — applies globally to all analyst tabs |
| Persistence | Selection lives in URL params (exists — shareable links) **plus** a cookie so a returning user lands on their last view |
| Exec band exception | The exec band stays pinned to *last full month vs same month last year* regardless of the picker — the headline never shifts under the CMO mid-meeting. Analyst tabs follow the global picker. |
| Freshness indicator | "Data through Jun 9" — GA4 lags ~24h and the cache TTL is 6h (`lib/api-cache.ts`); say so instead of letting users wonder why today is missing |

---

## 6. Making insights immediately apparent

Today's insights are three AI-written paragraphs in a tab, refreshed only when an admin presses a button. Upgrade path:

1. **Headline sentence at the very top of the page** (exec band, §3). The single most important takeaway — auto-generated, first thing every viewer reads.
2. **Insights become structured cards, not paragraphs.** Extend the `snapshot_insights` JSON shape: each insight = `{ metric, direction, magnitude, period, statement, why_it_matters, chart_ref }`. Render as compact cards: metric chip + direction arrow + magnitude + one-line "why it matters."
3. **Click an insight → jump to the evidence.** `chart_ref` scrolls to and highlights the chart/table the insight refers to. Insight and data stop living in separate tabs.
4. **Rank by impact, cap at top 3–5.** Score = affected volume × magnitude of change. Five sharp insights beat twelve mushy ones.
5. **Inline badges on KPI cards and charts.** "⚠ −32% vs prior 28d," "🏆 record high" rendered *next to the number*, not only in the insights list. (Extends `KpiCard`/`DeltaChip` in `components/ui/`.)
6. **Auto-refresh on a schedule.** Vercel cron (e.g. daily, after the data cache warms) calls `generateAnalyticsInsights()` instead of relying on the manual admin button; freshness timestamp shown in the exec band.
7. **"So what → now what."** Every Opportunity insight pairs with a recommended action deep-linking to the relevant portal tool: "5 pages slipped from page 1 → run Content Refresh Finder," "3 locations missing hours → open GBP Audit." The dashboard becomes the front door to the tools.
8. **Rule-based alerts alongside AI anomalies.** Deterministic checks that don't need a model: traffic drop > X% WoW, GBP listing suspended/closed, position losses on money keywords, GA4/GSC connection broken. Surface as red chips in the exec band.

---

## 7. Universal analyst-layer upgrades (all types)

- **Competitive module:** Semrush authority score trend, organic keyword count trend, share-of-voice vs named competitors (gap data already stored in `semrush_reports`). Needs a `competitors` list per client (small config field).
- **Fix known gaps:**
  - GSC top-URLs table: `clicksDelta` is always 0 (prior-period pages call was removed — `lib/google-search-console.ts` ~line 237). Restore it.
  - Period-aware trend windows (§5.1).
  - Definitions tab: replace placeholder with real metric definitions + methodology; admin-editable.
- **Targets/goals:** per-client monthly targets for the north-star metric → "vs target" chips and pacing ("83% to goal with 9 days left"). Phase C.
- **Monthly PDF export / scheduled email digest** of the exec band — the dashboard goes to the CMO instead of waiting for a visit. Phase C.

---

## 8. Data feasibility map

| Idea | Status |
|---|---|
| GBP calls / directions / website clicks / impressions / orders / bookings | ✅ fetched today (`lib/connectors/gbp.ts`) — just not shown on the dashboard |
| GBP profile audit score per location | ✅ computed today (`auditLocation()`) |
| GA4 revenue + transactions (incl. organic) | ✅ fetched today (`fetchGA4Report()`) |
| Conversion rate, AOV, record months, trend classification, anomaly z-scores | ✅ arithmetic on data already fetched |
| Deliverable/project annotations, "what we did" feed | ✅ tables exist (`deliverables`, `projects`) |
| Semrush authority / keyword counts / organic value / competitor gap | ✅ connector + `semrush_reports` exist |
| GA4 key events, funnel stages, top products, page-path sections, revenue-by-channel | 🔌 one metric/dimension added to existing GA4 calls |
| GSC branded vs non-branded, geo-intent queries, device split | 🔌 one filter/dimension added to existing GSC calls |
| `client_type` field + inference, key-event + competitor config | 🆕 small migration + settings UI |
| GBP review counts/ratings | 🆕 separate GBP API surface — verify scope before promising |
| Call tracking (CallRail etc.), offline revenue | 🆕 net-new integration — out of scope for now |
| Targets/goals, PDF export, email digest | 🆕 new feature surface (phase C) |

---

## 9. Suggested phasing

**Phase A — type-aware foundation (highest value-to-effort):**
`client_type` field + hybrid inference + settings UI · exec summary band (headline, north-star KPIs, sparklines, real "what we did" feed) · GBP module for local/multi-location (data is already there) · ecom KPI row (revenue/transactions/CR/AOV) · period-aware trend windows + ghost comparison overlays · fix GSC URL deltas.

**Phase B — depth per type + insight upgrade:**
location leaderboard + completeness heatmap · shopping funnel + top products · key-event config + lead-gen modules · branded/non-branded + geo-intent splits · calendar-aligned presets + custom ranges · structured insight cards + impact ranking + cron auto-refresh + tool deep-links · competitive module.

**Phase C — accountability layer:**
targets & pacing · rule-based alerting · 13-month table · PDF export / email digest · per-client module overrides · annotations admin (algorithm-update list).

---

*Grounding: exploration of `app/(dashboard)/dashboard/`, `app/actions/analytics.ts`, `lib/google-analytics.ts`, `lib/google-search-console.ts`, `lib/connectors/gbp.ts`, `lib/connectors/semrush-portal.ts`, `lib/api-cache.ts`, `lib/date-range.ts`, and the `clients` schema in `supabase/migrations/` — June 2026.*
