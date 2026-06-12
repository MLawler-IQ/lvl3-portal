# Type-Aware Dashboard

The `/dashboard` page renders a **type-aware** set of modules driven by
`clients.client_type`. Everything is additive: a client with no `client_type`
sees the generic (core-only) dashboard, and every module self-hides when its
data isn't configured.

## Client types & module registry

`lib/dashboard/registry.ts` is the single source of truth.

- `ClientType` = `local_service | multi_location | ecommerce | lead_gen` (null = generic).
- `MODULES`: `Record<DashboardModuleId, ModuleDef>` — `defaultFor` (which types show it),
  `core` (shown for everyone), `requires` (ga4/gsc/gbp/semrush), `phase`.
- `defaultModulesForType(type)` → ordered `DashboardModuleId[]` for that type.
- `inferClientType(signals)` → heuristic best-guess from connected data (admin confirms in settings).

Contracts live in `lib/dashboard/types.ts` (`TrendPoint`, `InsightCard`/`StructuredInsights`,
`Targets`/`MetricTarget`, `DashboardAlert`, `Granularity`).

## Data flow

`app/(dashboard)/dashboard/page.tsx` (selects client + threads `client_type`/`targets`)
→ `components/dashboard/AnalyticsSection.tsx` (server component: resolves the module set,
fetches per-module data **gated on the set**, all non-fatal; builds the exec band, alerts,
pacing) → `DashboardTabs.tsx` (`'use client'`, renders tabs).

Per-domain server actions (each resolves the selected client internally, returns typed
envelopes, never throws): `dashboard-ga4`, `dashboard-gsc`, `dashboard-gbp`,
`dashboard-leadgen`, `dashboard-competitive`, `dashboard-metrics-table`, `dashboard-pacing`.
All underlying GA4/GSC/GBP/Semrush lib fetches are `cachedFetch`-wrapped.

## Tabs (shown only when they have content)

| Tab | Content |
|-----|---------|
| **Snapshot** | Alerts banner, executive summary band (KPIs + sparklines + health + activity + freshness stamp), goals & pacing (admin nudge when no targets), traffic trend (ghost overlay), channel mix, key insights, context (takeaways/anomalies/opportunities + annotations) |
| **Locations** | GBP overview tiles, top-locations chart, location leaderboard, profile completeness (when `gbp.configured`) |
| **Detail** | 13-month sessions trend, per-vertical modules (ecom funnel/products, converting pages, content performance, branded split, competitive), source/medium table (AI-referral rows grouped as "AI Search"), new-vs-returning revenue share (admin + ecommerce only — TODO: client-visible is a deliberate later flip), 13-month metric table (admin; suspect months flagged `dataQuality:'suspect'` when sessions/clicks < 50% of the other complete months' median); also shown when analytics is connected |
| SEO | Existing GSC tab (when analytics connected) |
| Full Dashboard | Looker embed (when `looker_embed_url`) |

## Date ranges

`lib/date-range.ts`: rolling periods `7d/28d/90d/180d/365d` + calendar presets
`mtd`/`qtd`/`last_full_month` (`CALENDAR_PRESETS`); `compare` = `prior`/`yoy`.
Dashboard default (page.tsx + DashboardTabs, keep in sync): `last_full_month` + `yoy`.
`buildTrendRange` + `pickGranularity` drive period-aware trends (daily/weekly/monthly)
with an aligned ghost-overlay comparison series.

## Insights, alerts, pacing

- **Insights (draft-gated LLM layer)** — `generateAnalyticsInsights` (in `analytics.ts`)
  writes the LLM output to `clients.snapshot_insights_draft` ONLY (admins + members can
  trigger; client-role cannot). `approveSnapshotInsightsDraft` (admin-only; saving an
  edit counts as approval) publishes to `snapshot_insights` + `analytics_summary` and
  clears the draft; `discardSnapshotInsightsDraft` drops it. Admins review via
  `InsightDraftReview` in the Snapshot Context panel. Client-visible surfaces read only
  the published columns and fall back to deterministic `deriveHeadline`/live cards —
  never a blank, never a draft. Deterministic insight cards + alerts are NOT gated.
- **Metric naming (canon)** — anything backed by GA4 `transactions` is labeled
  **"Purchases"**; **"Conversions"** is reserved for keyEvents-backed numbers (13-month
  table, pacing). Internal keys (`conversions`) stay stable; only labels differ.
  Inverted metrics (Avg Position) use the `DeltaChip`/`KpiCard` `goodDirection`/`wording`
  contract — color follows goodDirection, the arrow shows numeric movement.
- **Alerts** — `lib/dashboard/alerts.ts` `deriveAlerts(input)` from metric drops, goal
  misses, and GBP health.
- **Pacing** — goals set in client settings (`clients.targets`); `dashboard-pacing.ts`
  `getPacingActuals` provides a consistent month-to-date snapshot, and
  `lib/dashboard/pacing.ts` `computePacing` projects a monthly run-rate vs target.

## Conventions

- New module = add to `DashboardModuleId` (types.ts) + `MODULES` (registry.ts) + a
  presentational component in `components/dashboard/modules/`, then render it in `DashboardTabs`.
- Module components are presentational (no fetching); `AnalyticsSection` feeds them.
- Charts reuse `components/analytics/shared/*` (`TrendChart`, `RankedBarChart`, `ChartContainer`)
  and the `--chart-*` CSS-var tokens so they track the active theme.
- GA4 monthly-series + converting-pages fetches scope keyEvents to
  `clients.key_event_names` (separate filtered report joined in JS — never put an
  eventName filter on a report that also measures sessions/revenue).

## Open follow-ups (June 2026 dashboard pass)

- **TFK conversions** (manual, can't fix in code): set `key_event_names` in client
  settings, AND un-flag the junk high-frequency event as a key event in the GA4
  property admin.
- New-vs-returning module: flipping client-visible is a deliberate decision, not a bug.
- First insight-draft generation after deploy: smoke-test generate → review → approve
  end to end.
- Parked from the improvement plan: P1 (data entry, not code) and items 12/14/16/17.
- `dashboard-improvement-review.md` was never committed (local-only on Matt's machine) —
  commit it if dashboard work resumes from that plan.
