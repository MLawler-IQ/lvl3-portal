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
| **Detail** | 13-month sessions trend, per-vertical modules (ecom funnel/products, converting pages, content performance, branded split, competitive), source/medium table, 13-month metric table (admin); also shown when analytics is connected |
| SEO | Existing GSC tab (when analytics connected) |
| Full Dashboard | Looker embed (when `looker_embed_url`) |

## Date ranges

`lib/date-range.ts`: rolling periods `7d/28d/90d/180d/365d` + calendar presets
`mtd`/`qtd`/`last_full_month` (`CALENDAR_PRESETS`); `compare` = `prior`/`yoy`.
Dashboard default (page.tsx + DashboardTabs, keep in sync): `last_full_month` + `yoy`.
`buildTrendRange` + `pickGranularity` drive period-aware trends (daily/weekly/monthly)
with an aligned ghost-overlay comparison series.

## Insights, alerts, pacing

- **Insights** — `generateAnalyticsInsights` (in `analytics.ts`) writes `headline` +
  `cards: InsightCard[]` into `snapshot_insights` via `lib/dashboard/insights.ts`
  (deterministic from metric deltas).
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
