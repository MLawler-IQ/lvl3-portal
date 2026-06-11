# App Routes

```
/                        → Home (client summary, engagement strip, nav cards)
/dashboard               → Type-aware dashboard. Tabs: Snapshot / Locations / Detail / Website / SEO / Full (shown per clients.client_type + connected data). period/compare via URL params; periods 7d/28d/90d/180d/365d + calendar presets mtd/qtd/last_full_month
/projects                → Google Sheet task tracker
/deliverables            → Deliverable cards with comments
/insights                → Blog/insights posts
/services                → Services page (redirect stub)
/tools                   → SEO tools hub (admin only). 19 registry entries in lib/tools/registry.ts: 16 active + 3 coming-soon (hidden)
/tools/keyword-quick-wins   → GSC positions 4-20 opportunity table
/tools/ai-visibility        → Branded vs non-branded search share
/tools/content-gaps         → High-impression low-CTR query finder
/tools/semrush-gap          → Semrush competitor keyword gap analysis
/tools/backlink-overview    → Domain authority, backlinks, referring domains (Semrush)
/tools/seo-content-engine   → Keyword research → brief → draft article → DOCX pipeline
/tools/tfk-generator        → ACF-ready location page copy for True Food Kitchen stores
/tools/blog-image-generator → Batch AI blog image generation (OpenAI DALL-E)
/tools/keyword-research     → Volume / CPC / competition / trends (Keywords Everywhere)
/tools/core-web-vitals      → CrUX field data + Lighthouse scores for any URL
/tools/page-seo-audit       → Crawl a page: title, meta, headings, schema, canonical
/tools/content-quality      → Word count, reading level, alt coverage, internal links
/tools/content-refresh-finder → Declining-traffic pages + AI refresh briefs → Content Engine
/tools/landing-page-cro-audit → Score landing pages on friction, CTAs, trust, speed
/tools/vertical-benchmark   → Best-in-class vertical research + LLM citation probing
/tools/gbp-audit            → GBP location audit: NAP, hours, category, completeness
(coming-soon, hidden from hub: schema-generator, service-page-generator, indexation-monitor)
/ask-lvl3                 → Claude-powered chat with client analytics context
/clients                  → Client list (admin only)
/clients/[id]             → Client detail + settings form merged (admin only)
/clients/[id]/settings    → Redirects to /clients/[id]
/admin                    → Admin health overview + Google OAuth connect panel
/login                    → Auth page
/auth/callback            → Supabase OAuth callback
/auth/google-callback     → Google OAuth callback (stores token in admin_google_token)
```

## Route Handlers (`app/api/`)

| Route | Purpose |
|-------|---------|
| `app/api/ask-lvl3/route.ts` | Streaming NDJSON endpoint for Ask LVL3 chat. Agentic loop with Claude tool_use (GSC/GA4 queries). Manual auth check (no `requireAdmin()` — it uses `redirect()` which throws inside ReadableStream). |
| `app/api/generate-blog-images/route.ts` | Batch blog image generation via OpenAI DALL-E + sharp for resizing. Uploads to Supabase Storage. `maxDuration = 300`. |

Route Handlers do NOT use `'use server'`. They use manual auth via `supabase.auth.getUser()` + profile role check.

## Server Actions (`app/actions/`)

All files must have `'use server'` at the top. No `'use server'` in `lib/` files.

| File | Key exports |
|------|-------------|
| `analytics.ts` | `fetchAnalyticsData`, `fetchDashboardReport`, `detectGSCSiteUrl`, `listGA4Properties`, `listGSCSiteOptions`, `generateAnalyticsInsights` (also writes structured `headline` + `cards` into `snapshot_insights`; `SnapshotInsights` type), `fetchLogoUrl`, `getSheetHeadersAction` |
| `tools.ts` | `fetchQuickWins`, `checkAIVisibility`, `fetchContentGaps` |
| `ask-lvl3.ts` | `sendChatMessage` (injects GSC + GA4 context dynamically) |
| `clients.ts` | `getClientsWithStats`, `updateClient` (persists dashboard metadata: `client_type`, `gbp_account_id`, `gbp_location_group`, `key_event_names`, `competitors`, `targets`), `getClientUsers`, `inviteUser`, `removeUser` |
| `dashboard-ga4.ts` | `getGA4TrendData` (period-aware trend + ghost series), `getGA4ChannelsData`, `getGA4EcomFunnelData`, `getGA4TopProductsData` — selected-client envelopes |
| `dashboard-gsc.ts` | `getGSCTrendAction`, `getGSCBrandedSplitAction`, `getGSCIntentSplitAction`, `getGSCReportAction` |
| `dashboard-gbp.ts` | `fetchDashboardGBP(clientId, opts)` → aggregate + per-location GBP insights + profile-audit rollup |
| `dashboard-leadgen.ts` | `getConvertingPagesData`, `getContentPerformanceData` (lead-gen modules) |
| `dashboard-competitive.ts` | `getCompetitiveData` (Semrush comparison vs `clients.competitors`) |
| `dashboard-metrics-table.ts` | `get13MonthTable` (GA4 + GSC monthly series; 13 complete months + current MTD month flagged `isPartial`) |
| `dashboard-pacing.ts` | `getPacingActuals(clientId)` — consistent MTD actuals for goal pacing |
| `annotations.ts` | `listAnnotations`, `createAnnotation`, `deleteAnnotation` (`client_annotations`; writes require admin) |
| `projects.ts` | `getSheetData`, `syncSheet` |
| `admin-google.ts` | `getAdminGoogleStatus`, `connectAdminGoogle`, `disconnectAdminGoogle` |
| `client-selection.ts` | `setSelectedClient` (sets the `selected_client` cookie) |
| `summaries.ts` | `generateClientSummary` (AI project summary) |
| `deliverables.ts` | CRUD + comment actions |
| `ask-lvl3-conversations.ts` | `listConversations`, `loadConversation`, `deleteConversation` — thread persistence |
| `semrush-reports.ts` | `listSemrushReports`, `loadSemrushReport`, `saveSemrushReport` — gap analysis persistence |

## Lib Files (`lib/`)

No `'use server'` in any lib file — they are plain async functions.

| File | Purpose |
|------|---------|
| `auth.ts` | `requireAuth()`, `requireAdmin()` |
| `client-resolution.ts` | `resolveSelectedClientId`, `getClientById`, `getClientListForUser` |
| `google-auth.ts` | `getAdminOAuthClient()` — OAuth2 client from DB token |
| `google-analytics.ts` | `fetchGA4Metrics`, `fetchGA4Report`, `fetchGA4Trend`, `fetchGA4EcomFunnel`, `fetchGA4TopProducts`, `fetchGA4ConvertingPages`, `fetchGA4PacingTotals`, `fetchGA4MonthlySeries` — admin OAuth, cached |
| `google-search-console.ts` | `fetchGSCMetrics`, `fetchGSCReport`, `fetchGSCTrend`, `fetchGSCBrandedSplit`, `fetchGSCIntentSplit`, `fetchGSCContentPerformance`, `fetchGSCMonthlySeries`, `listGSCSites` — admin OAuth, cached |
| `connectors/gbp.ts` | GBP Business Profile API: `listGBPAccounts/Locations`, `fetchGBPLocationInsights`, `fetchGBPClientInsights` (aggregate+per-location), `auditLocation` + account audit rollup |
| `connectors/semrush-portal.ts` | `fetchSemrushDomainRanks`, `fetchSemrushBacklinksOverview` (used by competitive module + tools) |
| `google-sheets.ts` | `fetchSheetRows`, `fetchSheetHeaders`, `parseSheetId` — uses service account |
| `tools-gsc.ts` | `fetchGSCRows` — raw 25k-row GSC dump for tools + Ask LVL3 |
| `date-range.ts` | `buildDateRange(period, compare)`, `buildTrendRange`, `pickGranularity` — periods 7d/28d/90d/180d/365d + calendar presets `mtd`/`qtd`/`last_full_month` (`CALENDAR_PRESETS`), compare prior/yoy |
| `dashboard/types.ts` | Shared dashboard contracts: `ClientType`, `DashboardModuleId`, `ModuleDef`, `TrendPoint`, `InsightCard`/`StructuredInsights`, `Targets`/`MetricTarget`, `DashboardAlert`, `Granularity` |
| `dashboard/registry.ts` | `MODULES`, `defaultModulesForType(type)`, `inferClientType(signals)` — module set per client type |
| `dashboard/insights.ts` | `deriveInsightCards`, `deriveHeadline` — deterministic structured insights from metric deltas |
| `dashboard/pacing.ts` | `computePacing`, `monthElapsedFraction`, `TARGET_METRIC_IDS` — actual-vs-goal run-rate |
| `dashboard/alerts.ts` | `deriveAlerts(input)` — ranked alerts from metric drops / goal misses / GBP health |
| `queries.ts` | Shared Supabase query helpers |
| `ask-tools.ts` | `gscQuery` — flexible GSC search analytics query used by Ask LVL3 agentic tools |
