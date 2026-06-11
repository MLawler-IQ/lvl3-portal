# LVL3 Portal — Engineering & Operations Handoff

> A complete operational and engineering manual for the LVL3 / IgniteIQ client portal.
> Audience: any engineer or operator inheriting this product cold.
> Last refreshed: 2026-05-14 (against commit `6d1820b` — "Rebrand portal to IgniteIQ v4.2").

This document is the **canonical handoff**. The existing `README.md` (setup-only) and `CLAUDE.md` (dev conventions cheatsheet) and the `.claude/CLAUDE-*.md` reference files are retained as deeper-dive companions. Nothing in those files is contradicted here — this document collects, expands, and connects them.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture at a Glance](#2-architecture-at-a-glance)
3. [Tech Stack](#3-tech-stack)
4. [Repository Layout](#4-repository-layout)
5. [Routes — Pages, API Handlers, Server Actions](#5-routes--pages-api-handlers-server-actions)
6. [`lib/` Reference](#6-lib-reference)
7. [Components Reference](#7-components-reference)
8. [Database Schema](#8-database-schema)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [External Integrations](#10-external-integrations)
11. [Environment Variables](#11-environment-variables)
12. [SEO Tools Catalog](#12-seo-tools-catalog)
13. [Ask LVL3 — Claude Agentic Chat](#13-ask-lvl3--claude-agentic-chat)
14. [SEO Content Engine](#14-seo-content-engine)
15. [TFK Generator](#15-tfk-generator)
16. [Operations Runbooks](#16-operations-runbooks)
17. [Development Workflow](#17-development-workflow)
18. [Deployment & Infrastructure](#18-deployment--infrastructure)
19. [Observability & Known Gaps](#19-observability--known-gaps)
20. [Recent Activity & Active Work](#20-recent-activity--active-work)
21. [Quick Reference Appendices](#21-quick-reference-appendices)

---

## 1. Product Overview

**LVL3 Portal** is the internal client dashboard for LVL3 / IgniteIQ, a digital-marketing agency focused on the modern trades (home services). It is **not** a customer-facing marketing site — it is the working surface where:

- **Admin** users (LVL3 employees with full access) manage clients, connect data sources, run SEO tools, review deliverables, and operate the agency end-to-end.
- **Member** users (LVL3 employees with restricted access) do the same minus admin settings + client onboarding.
- **Client** users (external — Apex Service Partners and similar) log in to view *only their assigned client's* deliverables, dashboards, project tracker, and reports.

The portal is the single pane of glass through which the agency:
1. **Pulls live performance data** from GA4 and Google Search Console per client.
2. **Runs SEO tools** (keyword opportunity finders, content gap analyzers, CRO audits, Core Web Vitals checks, GBP audits, Semrush gap analysis, and ~13 more).
3. **Generates content** via Claude — full SEO blog posts (DOCX + matrixify XLSX), TFK strategy decks, AI summaries of analytics.
4. **Manages deliverables** with threaded comments and read-state per client user.
5. **Tracks projects** via a Google Sheets-backed tracker.
6. **Provides Ask LVL3** — a Claude-powered agentic chat with tool access to client GSC/GA4 data.

### Key Coordinates

| Item | Value |
|---|---|
| Production URL | https://lvl3-portal.vercel.app |
| Repo | https://github.com/MLawler-IQ/lvl3-portal |
| Supabase Project | `zoeaifsxnaenlcdkavzf` |
| Vercel Project | `lvl3-portal` (production alias auto-aliased) |
| Default branch | `main` |
| Current branding | IgniteIQ v4.2 (rebrand landed in `6d1820b`) |
| Owner / Maintainer | Matt Lawler (matt@igniteiq.com) |
| Anthropic model | `claude-sonnet-4-6` |
| Node | 18.17+ (Next.js 14 requirement) |

### Role Quick Reference

| Role | Can do | Cannot do |
|---|---|---|
| `admin` | Everything | — |
| `member` | All tools, analytics, deliverables, projects; switch between clients | `/admin` page, client settings forms, Google OAuth reconnect, invite users |
| `client` | View their assigned client's home, dashboard, projects, deliverables, insights, services | Switch clients, see admin tools, see other clients' data |

---

## 2. Architecture at a Glance

### System Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                  BROWSER                                   │
│                        React 18 + Recharts + Tailwind                      │
└──────────────────────────────────┬─────────────────────────────────────────┘
                                   │  HTTPS
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                          NEXT.JS 14 (App Router)                           │
│                       Deployed on Vercel (Node 18.17+)                     │
│                                                                            │
│   ┌─────────────────┐   ┌──────────────┐   ┌────────────────────────────┐ │
│   │ Pages (RSC)     │   │ Route        │   │ Server Actions             │ │
│   │ app/(dashboard) │   │ Handlers     │   │ app/actions/*              │ │
│   │ app/(auth)      │   │ app/api/*    │   │                            │ │
│   └────────┬────────┘   └──────┬───────┘   └─────────────┬──────────────┘ │
│            │                   │                         │                │
│            └───────────────────┼─────────────────────────┘                │
│                                ▼                                          │
│   ┌────────────────────────────────────────────────────────────────────┐  │
│   │                              lib/                                  │  │
│   │  auth · supabase · google-auth · google-analytics · gsc · sheets   │  │
│   │  connectors (semrush, gbp, pagespeed, keywords-everywhere)         │  │
│   │  seo-content-engine · tfk · tools · crawlers · ask-tools           │  │
│   └────────────────────────────────────────────────────────────────────┘  │
└──────────┬───────────┬──────────┬──────────┬──────────┬──────────┬────────┘
           │           │          │          │          │          │
           ▼           ▼          ▼          ▼          ▼          ▼
        ┌──────┐  ┌─────────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌─────────┐
        │SUPABASE│ │ GOOGLE  │ │CLAUDE│ │ OPENAI │ │SEMRUSH │ │  GBP    │
        │ PG+RLS│ │ OAuth2  │ │ API  │ │ DALL·E │ │  API   │ │ OAuth   │
        │+Auth  │ │+Service │ │      │ │        │ │        │ │         │
        │+Storage│ │ Account │ │      │ │        │ │        │ │         │
        └───────┘ └─────────┘ └──────┘ └────────┘ └────────┘ └─────────┘
                       │
                       ├─ GA4 Data API
                       ├─ Search Console API
                       └─ Google Sheets API (svc acct)
```

### Critical Data Flows

#### Flow A — Authentication & Session Refresh
1. User hits any route → `middleware.ts` runs.
2. Middleware calls Supabase SSR helper which reads cookies → refreshes session if needed.
3. Page-level `requireAuth()` / `requireAdmin()` in `lib/auth.ts` re-validates and loads `users` row (role + client_id).
4. Unauthed → `redirect('/login')`. Wrong role → `redirect('/')`.
5. `/login` posts email → Supabase sends magic link → user clicks → `/auth/callback` exchanges code for session.

#### Flow B — Client Selection (Admin / Member)
1. Admin clicks client switcher in `TopBar` → calls server action `setSelectedClient()` in `app/actions/client-selection.ts`.
2. Action writes `selected_client` cookie.
3. On next request, `resolveSelectedClientId(user)` in `lib/client-resolution.ts` returns:
   - For role `client`: their pinned `client_id` (cookie ignored).
   - For role `admin` / `member`: cookie value, or null if unset.
4. Page-level queries scope all `clients.id = $1` lookups to this ID.

#### Flow C — Analytics Fetch (GA4 + GSC)
1. Page loads with selected client → reads `clients.ga4_property_id` and `clients.gsc_url` from DB.
2. Calls `getAdminOAuthClient()` in `lib/google-auth.ts` → reads single-row `admin_google_token` table → returns googleapis OAuth2 client with auto-refresh wired in.
3. `fetchGA4Metrics()` / `fetchGSCMetrics()` issue Data API calls.
4. Results normalized → Recharts components.
5. **Critical**: `getAdminOAuthClient()` reads cookies — **never** wrap with `unstable_cache`. (See CLAUDE.md rule.)

#### Flow D — Ask LVL3 Agentic Loop
1. Client posts message → `POST /api/ask-lvl3` (NDJSON stream).
2. Handler **manually checks auth** inside the handler — `requireAdmin()`'s `redirect()` does not work inside `ReadableStream` callbacks. See pattern saved in auto-memory.
3. Loads `ask_lvl3_conversations` + `ask_lvl3_messages` history.
4. Streams to Claude with tools defined in `lib/ask-tools.ts` (currently `gscQuery`).
5. Loop:
   - Stream text deltas as `{type: 'text', delta: '...'}` lines.
   - On `content_block_start` with `type === 'tool_use'`: suppress text deltas, emit `{type: 'status', text: 'Querying GSC...'}`.
   - After `streamObj.finalMessage()`: if tool_use blocks present, execute them, append `tool_result` to messages, re-stream.
   - Otherwise: persist final assistant message → close stream.
6. Client-side: `fetch()` → `res.body.getReader()` → line buffer → render.

#### Flow E — SEO Content Engine Pipeline
1. Admin uploads keyword XLSX at `/tools/seo-content-engine`.
2. `app/api/seo-content-engine/route.ts` parses with `xlsx-parser.ts`.
3. Topics clustered via `keyword-engine.ts` (groups keywords into post-sized topics).
4. For each topic:
   - Outline generated via Claude (`prompts.ts` + `anthropic-client.ts`).
   - Full draft generated.
   - DOCX written via `docx-writer.ts` (uses `docx` npm package).
   - Uploaded to Supabase Storage `client-assets` bucket.
   - Row inserted into `seo_content_engine_topics`.
5. Run-level XLSX export + ZIP bundle + Matrixify CSV generated on demand.

---

## 3. Tech Stack

### Runtime + Framework

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | 14.2.35 | RSC + Server Actions + Route Handlers |
| Language | TypeScript | ^5 | `strict` mode |
| Runtime | Node.js | 18.17+ | Required by Next 14 |
| UI | React | ^18 | Server Components default |
| Styling | Tailwind CSS | ^3.4.1 | + CSS variables for theming |
| PostCSS | postcss | ^8 | Tailwind pipeline |
| Linting | ESLint + eslint-config-next | ^8 / 14.2.35 | `npm run lint` |

### Dependencies (Production)

| Package | Version | Purpose |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.77.0 | Claude API — content engine, TFK, Ask LVL3, summaries |
| `@supabase/ssr` | ^0.8.0 | Server-side Supabase cookie helpers |
| `@supabase/supabase-js` | ^2.97.0 | Core Supabase client |
| `cheerio` | ^1.2.0 | HTML parsing for page crawler / SEO audit |
| `docx` | ^9.6.1 | DOCX generation in SEO Content Engine |
| `googleapis` | ^171.4.0 | Google APIs — GA4, GSC, Sheets, GBP, OAuth2 |
| `jszip` | ^3.10.1 | ZIP bundling for content engine downloads |
| `lucide-react` | ^0.574.0 | Icons |
| `openai` | ^6.25.0 | DALL·E for blog image generation |
| `recharts` | ^2.15.0 | Charts |
| `sharp` | ^0.34.5 | Image resizing for DALL·E outputs |
| `xlsx` | ^0.18.5 | Excel parsing + writing (keyword inputs, exports) |

### What's *not* here

- **No ORM** — all DB queries are raw Supabase client calls. There is no Prisma, Drizzle, Kysely, or similar.
- **No test framework** — no Jest, Vitest, Playwright, or similar. Type-checking via `npx tsc --noEmit` is the only automated gate.
- **No background job system** — no BullMQ, Inngest, or similar. Long jobs run inside Route Handlers with `export const maxDuration = 300`.
- **No error tracking** — no Sentry, Bugsnag, etc. Only `console.*`.
- **No analytics** — no PostHog, Mixpanel, Segment.
- **No CI** — `.github/workflows/` is empty.
- **No cron** — no scheduled jobs of any kind.

These omissions are intentional gaps to address — see [§19 Observability & Known Gaps](#19-observability--known-gaps).

---

## 4. Repository Layout

```
lvl3-portal/
├── app/                              # Next.js App Router
│   ├── (auth)/login/                 # Public magic-link login
│   ├── (dashboard)/                  # Protected segment — all internal pages
│   │   ├── ask-lvl3/                 # Claude chat
│   │   ├── clients/                  # Client list + detail + settings
│   │   ├── dashboard/                # GA4/GSC analytics + Looker embed
│   │   ├── deliverables/             # Deliverables grid
│   │   ├── insights/                 # Blog posts / insights
│   │   ├── projects/                 # Google Sheets project tracker
│   │   ├── services/                 # Services page
│   │   ├── tools/                    # SEO tools hub + 17 individual tools
│   │   ├── layout.tsx                # Sidebar + TopBar shell
│   │   └── page.tsx                  # Home dashboard
│   ├── actions/                      # Server Actions (all 'use server')
│   ├── api/                          # Route Handlers (streaming + long jobs)
│   ├── auth/callback/                # Supabase magic link callback
│   ├── auth/google-callback/         # Google OAuth callback (writes admin token)
│   ├── fonts/                        # Local font files
│   ├── layout.tsx                    # Root layout
│   └── page.tsx                      # Root redirect to (dashboard)
├── lib/                              # Core logic — never has 'use server'
│   ├── auth.ts                       # requireAuth / requireAdmin
│   ├── client-resolution.ts          # Client scoping logic
│   ├── connectors/                   # External API connectors (semrush, gbp, etc.)
│   ├── crawlers/                     # Web crawler + page analyzer + queue
│   ├── seo-content-engine/           # SEO Content Engine pipeline
│   ├── tfk/                          # TFK generator pipeline
│   ├── tools/                        # Tool registry + types
│   ├── supabase/                     # client.ts (browser) + server.ts (SSR)
│   ├── google-*.ts                   # Google API wrappers
│   ├── ask-tools.ts                  # Ask LVL3 tool definitions
│   └── *.ts                          # Misc utilities
├── components/                       # React components, grouped by feature
├── supabase/migrations/              # 21 SQL DDL files
├── design-system/                    # DESIGN.md + MASTER.md (canonical specs)
├── public/                           # Static assets (logos, favicons, fonts)
├── .claude/                          # Claude Code reference docs + skills
│   ├── CLAUDE-db-schema.md           # DB schema reference (deeper dive)
│   ├── CLAUDE-routes.md              # Route reference (deeper dive)
│   ├── CLAUDE-google-api.md          # Google API auth reference
│   └── CLAUDE-seo-tools.md           # SEO tools + Ask LVL3 reference
├── middleware.ts                     # Session refresh on every request
├── next.config.mjs                   # Empty — defaults
├── tsconfig.json
├── tailwind.config.ts
├── package.json
├── README.md                         # Setup guide (kept)
├── CLAUDE.md                         # Dev conventions cheatsheet (kept)
└── HANDOFF.md                        # ← This file
```

---

## 5. Routes — Pages, API Handlers, Server Actions

### 5.1 Pages

| Path | File | Role | Purpose |
|---|---|---|---|
| `/` | `app/(dashboard)/page.tsx` | any | Home dashboard — hero banner, client summary, attention queue, open loops |
| `/login` | `app/(auth)/login/page.tsx` | public | Magic-link login |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | any | GA4 + GSC analytics with tabs + Looker embed |
| `/projects` | `app/(dashboard)/projects/page.tsx` | any | Google Sheets-backed project tracker |
| `/deliverables` | `app/(dashboard)/deliverables/page.tsx` | any | Deliverable cards + threaded comments |
| `/insights` | `app/(dashboard)/insights/page.tsx` | any | Blog posts / insights |
| `/services` | `app/(dashboard)/services/page.tsx` | any | Services overview (stub) |
| `/ask-lvl3` | `app/(dashboard)/ask-lvl3/page.tsx` | admin | Claude agentic chat |
| `/clients` | `app/(dashboard)/clients/page.tsx` | admin | Client list grid |
| `/clients/[id]` | `app/(dashboard)/clients/[id]/page.tsx` | admin | Client detail + merged settings |
| `/clients/[id]/settings` | `app/(dashboard)/clients/[id]/settings/page.tsx` | admin | Redirects to `/clients/[id]` |
| `/tools` | `app/(dashboard)/tools/page.tsx` | admin | Tools hub overview |
| `/tools/keyword-quick-wins` | tools/keyword-quick-wins/page.tsx | admin | GSC positions 4–20 finder |
| `/tools/ai-visibility` | tools/ai-visibility/page.tsx | admin | Branded vs non-branded search split |
| `/tools/content-gaps` | tools/content-gaps/page.tsx | admin | High-impression low-CTR queries |
| `/tools/semrush-gap` | tools/semrush-gap/page.tsx | admin | Competitor keyword gap |
| `/tools/blog-image-generator` | tools/blog-image-generator/page.tsx | admin | DALL·E batch image gen |
| `/tools/content-refresh-finder` | tools/content-refresh-finder/page.tsx | admin | Coming soon (stub UI present) |
| `/tools/landing-page-cro-audit` | tools/landing-page-cro-audit/page.tsx | admin | CRO audit |
| `/tools/vertical-benchmark` | tools/vertical-benchmark/page.tsx | admin | Vertical benchmark |
| `/tools/page-seo-audit` | tools/page-seo-audit/page.tsx | admin | On-page SEO audit |
| `/tools/content-quality` | tools/content-quality/page.tsx | admin | Content quality analyzer |
| `/tools/core-web-vitals` | tools/core-web-vitals/page.tsx | admin | PSI Core Web Vitals checker |
| `/tools/gbp-audit` | tools/gbp-audit/page.tsx | admin | GBP audit (uses separate GBP token) |
| `/tools/keyword-research` | tools/keyword-research/page.tsx | admin | Keyword research |
| `/tools/seo-content-engine` | tools/seo-content-engine/page.tsx | admin | AI-driven full SEO content pipeline |
| `/tools/tfk-generator` | tools/tfk-generator/page.tsx | admin | Targets / Funnel / Keywords generator |

### 5.2 Route Handlers (`app/api/*` + `/auth/*`)

| Method + Path | File | Purpose | Notable |
|---|---|---|---|
| `POST /api/ask-lvl3` | `app/api/ask-lvl3/route.ts` | NDJSON streaming agentic chat | Manual auth check (no `redirect()`); `gscQuery` tool registered |
| `POST /api/generate-blog-images` | `app/api/generate-blog-images/route.ts` | DALL·E batch + sharp resize + Supabase upload | `maxDuration = 300` |
| `POST /api/seo-content-engine` | `app/api/seo-content-engine/route.ts` | Full content engine pipeline | Long-running, `maxDuration = 300` |
| `POST /api/tfk-generator` | `app/api/tfk-generator/route.ts` | TFK pipeline | XLSX in → XLSX + HTML out |
| `POST /api/tools/content-refresh-finder` | `app/api/tools/content-refresh-finder/route.ts` | Content refresh finder | Persists to `tool_runs` |
| `POST /api/tools/gbp-audit` | `app/api/tools/gbp-audit/route.ts` | GBP audit | Uses `admin_gbp_token` |
| `POST /api/tools/landing-page-cro-audit` | `app/api/tools/landing-page-cro-audit/route.ts` | CRO audit (crawl + analyze) | Cheerio-driven |
| `POST /api/tools/vertical-benchmark` | `app/api/tools/vertical-benchmark/route.ts` | Vertical benchmark | Semrush-driven |
| `GET /auth/callback` | `app/auth/callback/route.ts` | Supabase magic-link code exchange | Sets session cookies |
| `GET /auth/google-callback` | `app/auth/google-callback/route.ts` | Google OAuth callback | Writes `admin_google_token` row |

### 5.3 Server Actions (`app/actions/*.ts`)

All files in this directory start with `'use server'`. Each exported function is callable from any client component via `import`.

| File | Key Actions | Mutates |
|---|---|---|
| `admin-google.ts` | `getAdminGoogleStatus()`, `disconnectAdminGoogle()`, GBP variants | `admin_google_token`, `admin_gbp_token` |
| `analytics.ts` | `fetchAnalyticsSnapshot()`, `refreshAnalytics()` | `clients.analytics_summary`, `snapshot_insights` |
| `ask-lvl3-conversations.ts` | `listConversations()`, `createConversation()`, `deleteConversation()`, `renameConversation()` | `ask_lvl3_conversations` |
| `ask-lvl3.ts` | misc helpers for chat persistence | `ask_lvl3_messages` |
| `client-selection.ts` | `setSelectedClient(clientId)` | `selected_client` cookie |
| `clients.ts` | `createClient`, `updateClient`, `deleteClient`, `inviteUser` | `clients`, `users`, `user_client_access` |
| `deliverables.ts` | `createDeliverable`, `updateDeliverable`, `addComment`, `resolveComment`, `markRead` | `deliverables`, `comments` |
| `projects.ts` | `fetchProjectSheet(sheetId, tabName)` | none (read-only) |
| `semrush-reports.ts` | `runSemrushGap`, `loadSemrushReport`, `deleteSemrushReport` | `semrush_reports` |
| `seo-content-engine.ts` | `createRun`, `loadRun`, `regenerateDocx`, `deleteRun` | `seo_content_engine_runs`, `seo_content_engine_topics` |
| `summaries.ts` | `generateAiSummary(clientId)` | `clients.ai_summary`, `clients.analytics_summary` |
| `tools-extended.ts` | extended tool action helpers | `tool_runs` |
| `tools.ts` | `recordToolRun`, `listToolRuns`, `deleteToolRun` | `tool_runs` |

---

## 6. `lib/` Reference

> Rule: **`lib/` files never contain `'use server'`**. Server-only logic lives here, but server actions live in `app/actions/`.

### 6.1 Auth & Identity

| File | Exports | Purpose |
|---|---|---|
| `lib/auth.ts` | `requireAuth()`, `requireAdmin()` | Loads session + user row + role; redirects on fail |
| `lib/client-resolution.ts` | `resolveSelectedClientId(user)`, `getClientById(id, columns)`, `getClientListForUser(...)` | Determines which client_id any given query should scope to |

### 6.2 Supabase

| File | Exports | Purpose |
|---|---|---|
| `lib/supabase/client.ts` | `createClient()` | Browser-side client (RLS-respecting) |
| `lib/supabase/server.ts` | `createClient()` (SSR, cookies), `createServiceClient()` (service role, bypasses RLS) | Server-side clients |

**Rule:** Use `createServiceClient()` for admin operations (writing to `admin_google_token`, system-wide queries). Use `createClient()` for user-scoped operations where RLS should apply.

### 6.3 Google APIs

| File | Exports | Purpose |
|---|---|---|
| `lib/google-auth.ts` | `getAdminOAuthClient()` | Reads `admin_google_token` row, returns `OAuth2Client` with auto-refresh. **Never wrap with `unstable_cache` — reads cookies.** |
| `lib/google-analytics.ts` | `fetchGA4Metrics(propertyId, range)`, `fetchGA4Report(propertyId, dimensions, metrics, range)` | GA4 Data API wrappers |
| `lib/google-search-console.ts` | `listGSCSites()`, `fetchGSCMetrics(url, range)`, `fetchGSCReport(url, dimensions, range)` | Search Console API wrappers |
| `lib/google-sheets.ts` | `fetchSheetRows(sheetId, range)`, `fetchSheetHeaders(sheetId, range)`, `parseSheetId(url)` | Google Sheets API — **uses service account, not admin OAuth** |
| `lib/gbp-auth.ts` | GBP OAuth client (reads `admin_gbp_token`) | Independent token from main Google OAuth |
| `lib/tools-gsc.ts` | `fetchGSCRows(url, daysBack, rowLimit)` | Raw GSC dump, up to 25k rows, used by SEO tools |

### 6.4 External Connectors

| File | Purpose |
|---|---|
| `lib/connectors/crawler.ts` | Cheerio-based HTML fetcher |
| `lib/connectors/gbp.ts` | Google Business Profile API |
| `lib/connectors/keywords-everywhere.ts` | Keywords Everywhere volume/CPC API |
| `lib/connectors/pagespeed.ts` | PageSpeed Insights API |
| `lib/connectors/semrush-portal.ts` | Semrush API (gap analysis, keyword data, backlinks) |

### 6.5 Crawlers

| File | Purpose |
|---|---|
| `lib/crawlers/index.ts` | Exports + shared types |
| `lib/crawlers/page-analyzer.ts` | HTML → structured JSON (headers, links, images, text) |
| `lib/crawlers/queue.ts` | Parallel work queue |
| `lib/crawlers/semrush-audit.ts` | Semrush audit + ranking analysis |

### 6.6 SEO Content Engine

| File | Purpose |
|---|---|
| `lib/seo-content-engine/anthropic-client.ts` | Claude SDK wrapper (model selection, retry, token counting) |
| `lib/seo-content-engine/config.ts` | Engine defaults + tunables |
| `lib/seo-content-engine/content-engine.ts` | Top-level pipeline orchestrator |
| `lib/seo-content-engine/data-sources.ts` | Pulls GSC/GA4 context for prompts |
| `lib/seo-content-engine/docx-writer.ts` | DOCX serializer (uses `docx` npm) |
| `lib/seo-content-engine/keyword-engine.ts` | Keyword clustering + outline gen |
| `lib/seo-content-engine/prompts.ts` | Claude system + user prompts |
| `lib/seo-content-engine/types.ts` | Pipeline TypeScript interfaces |
| `lib/seo-content-engine/utils.ts` | Helpers (token counting, markdown formatting) |
| `lib/seo-content-engine/validators.ts` | Output validation |
| `lib/seo-content-engine/xlsx-parser.ts` | Excel keyword input parsing |

### 6.7 TFK Generator

| File | Purpose |
|---|---|
| `lib/tfk/enricher.ts` | Keyword volume / CPC / competition enrichment |
| `lib/tfk/generator.ts` | Claude-driven TFK generation |
| `lib/tfk/parser.ts` | CSV / XLSX input parsing |
| `lib/tfk/preview.ts` | Preview generation |
| `lib/tfk/schema.ts` | Schema definitions |
| `lib/tfk/tfk-page-css.ts` | CSS-in-JS for HTML output |
| `lib/tfk/types.ts` | TypeScript interfaces |
| `lib/tfk/validator.ts` | Schema validation |
| `lib/tfk/writer.ts` | XLSX + HTML writers |

### 6.8 Tools + Ask LVL3

| File | Purpose |
|---|---|
| `lib/tools/registry.ts` | Tool definitions for the tools hub |
| `lib/tools/types.ts` | Tool interface types |
| `lib/ask-tools.ts` | Ask LVL3 tool definitions — currently `gscQuery` (flexible GSC search analytics query) |

### 6.9 Utilities

| File | Purpose |
|---|---|
| `lib/date-range.ts` | `buildDateRange(period, compare)` → `{startDate, endDate}` for GA4/GSC. Periods: `7d`/`28d`/`90d`/`180d`/`365d`. Compare: `prior`/`yoy`. |
| `lib/normalize-domain.ts` | Domain normalization for cross-source matching |
| `lib/queries.ts` | Shared Supabase query helpers |

---

## 7. Components Reference

63 components across 12 feature areas.

### 7.1 UI Base (`components/ui/`)
`KpiCard.tsx`, `DeltaChip.tsx`, `StatusBadge.tsx`, `NarrativeCard.tsx`, `EmptyState.tsx`, `Skeleton.tsx`.

### 7.2 Navigation (`components/nav/`)
`TopBar.tsx` (client switcher + user menu), `PageHeader.tsx`, `LayoutShell.tsx`, `MobileNavDrawer.tsx`.

### 7.3 Home (`components/home/`)
`HeroBanner.tsx`, `client-summary.tsx`, `RefreshAnalyticsButton.tsx`, `RefreshSummaryButton.tsx`, `EngagementStrip.tsx`, `AttentionQueueCard.tsx`, `OpenLoopsCard.tsx`, `nav-cards.tsx`.

### 7.4 Clients (`components/clients/`)
`clients-grid.tsx`, `new-client-modal.tsx`, `ClientSettingsForm.tsx`, `client-users-table.tsx`, `invite-user-modal.tsx`.

### 7.5 Projects (`components/projects/`)
`projects-view.tsx`, `task-table.tsx`, `filters-bar.tsx`, `collapsible-section.tsx`, `hero-card.tsx`, `project-helpers.ts`.

### 7.6 Tools (`components/tools/`)
`ToolsHubClient.tsx`, `ToolLayoutWrapper.tsx`, `RunHistory.tsx`, plus `primitives/`: `UrlInputTool.tsx`, `ClientScopedTool.tsx`, `BackgroundJobTool.tsx`.

### 7.7 Deliverables (`components/deliverables/`)
`deliverable-card.tsx`, `deliverable-slide-over.tsx`, `deliverables-client.tsx`, `add-deliverable-modal.tsx`, `comment-thread.tsx`.

### 7.8 Admin (`components/admin/`)
`GoogleConnectionPanel.tsx` (with Reconnect button for scope upgrades), `GBPConnectionPanel.tsx`.

### 7.9 Analytics (`components/analytics/`)
`AnalyticsKpiStrip.tsx`, plus subdirectories:
- `website/`: `ChannelBarChart.tsx`, `SourceMediumTable.tsx` (rendered on Snapshot / Detail; the Website tab was merged into Detail).
- `seo/`: SEO-specific analytics views.
- `shared/`: shared chart + table primitives.

### 7.10 Other
- `notifications/NotificationsPanel.tsx`
- `search/CommandPalette.tsx`
- `dashboard/looker-embed.tsx`
- `sidebar.tsx` (top-level — main navigation)

---

## 8. Database Schema

Supabase Postgres with RLS enabled on all user-data tables. Migrations live in `supabase/migrations/`. **No ORM** — everything is `supabase.from('table').select(...)`.

### 8.1 Tables

#### `clients`
PE/agency client (e.g., one Apex brand).

Columns (inferred from migrations + code):
- `id` UUID PK
- `name`, `slug` TEXT
- `logo_url`, `hero_image_url` TEXT
- `ga4_property_id` TEXT
- `gsc_url` TEXT
- `looker_embed_url` TEXT
- `ai_summary` JSONB (cached client-level summary)
- `analytics_summary` JSONB (cached analytics narrative)
- `snapshot_insights` JSONB (takeaways, anomalies, opportunities)
- `semrush_project_id` TEXT (from migration `20260416000002`)
- brand_context columns (from migration `20260402000000`)
- `created_at` TIMESTAMPTZ

#### `users`
Portal users.
- `id` UUID PK (= Supabase auth.users id)
- `email` TEXT
- `role` ENUM `admin` | `member` | `client`
- `client_id` UUID FK → `clients.id` (only set for role=`client`)
- `created_at`

#### `user_client_access`
Member ↔ client many-to-many.
- `user_id` UUID FK
- `client_id` UUID FK
- PK = (`user_id`, `client_id`)

#### `deliverables`
Shared files / links visible to a client.
- `id` UUID PK
- `client_id` UUID FK
- `title`, `type`, `status`, `file_url` TEXT
- `is_read` BOOL
- `created_at`

#### `comments`
Threaded comments on deliverables.
- `id` UUID PK
- `deliverable_id` UUID FK
- `user_id` UUID FK
- `body` TEXT
- `parent_id` UUID nullable (threading)
- `resolved` BOOL
- `created_at`

#### `posts`
Blog posts / insights (visible to clients).
- `id` UUID PK
- `client_id` UUID FK nullable (null = visible to all)
- `title`, `body`, `slug` TEXT
- `published_at`

#### `services`
Agency services catalog.
- `id`, `name`, `description`, `client_id` (nullable)

#### `admin_google_token`
**Single-row table** (`id = 1`) storing the admin's Google OAuth refresh + access tokens.
- `id` INT PK (always 1)
- `access_token`, `refresh_token` TEXT
- `expiry_date` BIGINT
- `scopes` TEXT[]
- `updated_at`

#### `admin_gbp_token`
Same shape as above, but for GBP (separate scopes). Introduced in `20260416000003`.

#### `ask_lvl3_conversations`
Chat threads.
- `id` UUID PK
- `client_id` UUID FK
- `user_id` UUID FK
- `title` TEXT
- `created_at`

#### `ask_lvl3_messages`
Messages.
- `id` UUID PK
- `conversation_id` UUID FK
- `role` ENUM `user` | `assistant` | `tool`
- `content` JSONB (full Anthropic content block array)
- `created_at`

#### `semrush_reports`
Cached gap analysis results.
- `id` UUID PK
- `client_id` UUID FK
- `competitors` TEXT[]
- `keywords` JSONB
- `filters` JSONB
- `created_at`

#### `seo_content_engine_runs`
One row per pipeline run.
- `id` UUID PK
- `client_id` UUID FK
- `status` ENUM `pending` | `running` | `complete` | `partial` | `failed`
- `keyword_input` JSONB
- `created_at`

#### `seo_content_engine_topics`
One row per generated topic within a run.
- `id` UUID PK
- `run_id` UUID FK
- `keyword` TEXT (note: historically sometimes stored as object — string coercion now enforced in `docx-writer.ts`)
- `outline` JSONB
- `draft` TEXT
- `docx_url`, `xlsx_url` TEXT
- `status` TEXT
- `created_at`

#### `tool_runs`
Universal tool execution history.
- `id` UUID PK
- `client_id` UUID FK
- `user_id` UUID FK
- `tool_name` TEXT
- `input` JSONB
- `output` JSONB
- `status` TEXT
- `error` TEXT nullable
- `created_at`

### 8.2 Migration History (Chronological)

| # | File | What it adds |
|---|---|---|
| 1 | `20240001_admin_google_oauth.sql` | `admin_google_token` table |
| 2 | `20240101000001_create_tables.sql` | Core: clients, users, deliverables, comments, posts, services |
| 3 | `20240101000002_create_policies.sql` | RLS policies for all core tables |
| 4 | `20240101000003_create_storage.sql` | Storage buckets |
| 5 | `20240101000004_fix_users_rls.sql` | RLS fixes for users table |
| 6 | `20240101000005_add_member_role.sql` | `member` role added |
| 7 | `20240101000006_add_member_role_objects.sql` | RLS for member role |
| 8 | `20240102000000_add_ai_summary_to_clients.sql` | `ai_summary` + `analytics_summary` |
| 9 | `20260219000000_add_analytics_fields.sql` | Analytics schema extensions |
| 10 | `20260219000001_add_snapshot_insights.sql` | `snapshot_insights` |
| 11 | `20260220000000_add_hero_image.sql` | `hero_image_url` |
| 12 | `20260220000001_create_client_assets_bucket.sql` | `client-assets` storage bucket |
| 13 | `20260220000002_create_chat_tables.sql` | `ask_lvl3_conversations` + `ask_lvl3_messages` |
| 14 | `20260226000000_create_semrush_reports.sql` | `semrush_reports` |
| 15 | `20260401000000_create_seo_content_engine_tables.sql` | Content engine tables |
| 16 | `20260402000000_add_brand_context_to_clients.sql` | Brand context columns |
| 17 | `20260408000000_add_chat_artifacts.sql` | `chat-artifacts` storage bucket |
| 18 | `20260408000001_chat_artifacts_rls.sql` | RLS on chat artifacts |
| 19 | `20260416000001_tool_runs.sql` | `tool_runs` |
| 20 | `20260416000002_clients_semrush_project.sql` | `clients.semrush_project_id` |
| 21 | `20260416000003_admin_gbp_token.sql` | `admin_gbp_token` |

Run migrations with `supabase db push --include-all` (the `--include-all` flag is needed because file timestamps are not strictly monotonic).

### 8.3 Storage Buckets

| Bucket | Purpose | RLS |
|---|---|---|
| `client-assets` | Client logos, hero images, SEO Content Engine DOCX/XLSX exports | Admin + member write; client read scoped by client_id |
| `chat-artifacts` | Ask LVL3 generated spreadsheets, downloads | Admin + member write; user read scoped by conversation owner |

---

## 9. Authentication & Authorization

### 9.1 Magic-link Flow

1. User visits any `/(dashboard)/*` route.
2. `middleware.ts` (runs on every request) calls `createClient()` and refreshes session cookies.
3. Page-level `await requireAuth()` reads session, loads `users` row by `auth.users.id`.
4. If no session → `redirect('/login')`.
5. `/login` form posts email → `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '<origin>/auth/callback' }})`.
6. Email arrives → user clicks link → `/auth/callback` runs.
7. Callback handler calls `supabase.auth.exchangeCodeForSession(code)` → sets cookies → redirects to `/`.

### 9.2 Role Matrix

| Capability | admin | member | client |
|---|---|---|---|
| View home/dashboard/projects/deliverables/insights/services | ✓ | ✓ | ✓ (own client only) |
| Switch client via TopBar | ✓ | ✓ | ✗ (pinned) |
| Access `/tools/*` | ✓ | ✓ | ✗ |
| Access `/ask-lvl3` | ✓ | ✗ | ✗ |
| Access `/clients` list | ✓ | ✗ | ✗ |
| Edit client settings | ✓ | ✗ | ✗ |
| Connect Google OAuth | ✓ | ✗ | ✗ |
| Invite users | ✓ | ✗ | ✗ |
| Comment on deliverables | ✓ | ✓ | ✓ |

### 9.3 `requireAuth` vs `requireAdmin`

```typescript
// lib/auth.ts
const { supabase, user } = await requireAuth()  // any logged-in user
const { supabase, user } = await requireAdmin() // admin only — redirect('/') if not
```

Both return `{ supabase, user: { id, email, role, client_id } }`.

### 9.4 Streaming Route Handler Auth Caveat

`requireAuth()` and `requireAdmin()` call `redirect()` from `next/navigation` under the hood. **This breaks inside `ReadableStream` callbacks.** For Route Handlers that stream (notably `app/api/ask-lvl3/route.ts`), do the auth check manually before constructing the stream:

```ts
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
const service = await createServiceClient()
const { data: profile } = await service.from('users').select('role').eq('id', user.id).single()
if (!profile || profile.role !== 'admin') return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
```

### 9.5 Client Selection Cookie

- Name: `selected_client`
- Set by: `setSelectedClient()` in `app/actions/client-selection.ts`
- Read by: `resolveSelectedClientId()` in `lib/client-resolution.ts`
- Lifetime: indefinite (no expiry set) — persists across sessions until changed
- Ignored for: `client` role (always returns their pinned `client_id`)

---

## 10. External Integrations

### 10.1 Anthropic (Claude)
- **Model:** `claude-sonnet-4-6`. Change only in `lib/seo-content-engine/anthropic-client.ts` and Ask LVL3 handler.
- **SDK:** `@anthropic-ai/sdk@^0.77.0`.
- **Used for:** SEO Content Engine, TFK Generator, Ask LVL3, AI client summaries, CRO audit narratives.
- **Auth:** `ANTHROPIC_API_KEY` env var.
- **Rate limits:** No explicit handling. Long pipelines (content engine) issue sequential calls — partial-run state is persisted so retries pick up from the last successful topic.
- **Cost:** Sonnet 4.6 — monitor via Anthropic console.

### 10.2 Google OAuth2 (Admin Account)
- **Used for:** GA4 Data API, Search Console API.
- **Token storage:** `admin_google_token` table, single row `id = 1`.
- **Refresh:** `getAdminOAuthClient()` in `lib/google-auth.ts` returns an `OAuth2Client` with the refresh token wired in — googleapis SDK auto-refreshes access tokens.
- **Reconnect:** When scopes change or refresh token revokes, admin clicks **Reconnect** in `GoogleConnectionPanel` (`/admin` or wherever rendered). This routes to Google consent → `/auth/google-callback` writes new token.
- **Scopes required:** Analytics readonly + Webmasters readonly. (Verify in `app/auth/google-callback/route.ts`.)
- **Pitfall:** Never wrap `getAdminOAuthClient()` with `unstable_cache` — it reads cookies.

### 10.3 Google Service Account
- **Used for:** Google Sheets read-only (project tracker).
- **Auth:** `GOOGLE_SERVICE_ACCOUNT_KEY` env var holds the JSON key inline (as a string).
- **Service account email:** Configured in your Google Cloud project. Share each project tracker sheet with this email as "Viewer".
- **Why separate from admin OAuth:** Sheets uses sheet-level sharing, not user-level scope. A service account is the right abstraction.

### 10.4 Google Business Profile
- **Used for:** GBP Audit tool.
- **Token storage:** `admin_gbp_token` table (separate from `admin_google_token` since commit `c7e4816` — different OAuth scope and refresh lifecycle).
- **Reconnect:** Via `GBPConnectionPanel` on admin page.
- **Connector:** `lib/connectors/gbp.ts` + `lib/gbp-auth.ts`.

### 10.5 GA4
- Property ID per client lives at `clients.ga4_property_id`.
- Functions: `fetchGA4Metrics()`, `fetchGA4Report()` in `lib/google-analytics.ts`.
- Uses admin OAuth — that admin Google account must have access to every client's GA4 property.

### 10.6 Google Search Console
- URL per client at `clients.gsc_url`.
- Functions: `listGSCSites()`, `fetchGSCMetrics()`, `fetchGSCReport()` in `lib/google-search-console.ts`. Raw dump: `fetchGSCRows()` in `lib/tools-gsc.ts`.
- Uses admin OAuth — admin must be verified owner/user on every client's GSC property.

### 10.7 Supabase
- **Project ID:** `zoeaifsxnaenlcdkavzf`.
- **Anon key:** public, safe in browser, respects RLS.
- **Service role key:** server-only, bypasses RLS. Use sparingly via `createServiceClient()`.
- **RLS gotcha:** When in doubt, default to user-scoped `createClient()`. Use service role only for admin operations or system-wide reads.
- **Auth:** Magic link only — no password auth.

### 10.8 OpenAI (DALL·E)
- **Used for:** Blog image batch generation at `/tools/blog-image-generator`.
- **Pipeline:** prompt → DALL·E 3 image → `sharp` resize → Supabase Storage upload.
- **Env:** `OPENAI_API_KEY`.
- **Endpoint:** `POST /api/generate-blog-images` (`maxDuration = 300`).

### 10.9 Semrush
- **Used for:** Competitor keyword gap analysis (`/tools/semrush-gap`), vertical benchmark, keyword research.
- **Env:** `SEMRUSH_API_KEY`.
- **Project ID per client:** `clients.semrush_project_id` (optional; only set for clients with active Semrush projects).
- **Connector:** `lib/connectors/semrush-portal.ts`.
- **Persistence:** Gap results cached in `semrush_reports` table.

### 10.10 PageSpeed Insights / Keywords Everywhere
- **PSI:** `lib/connectors/pagespeed.ts` — used by `/tools/core-web-vitals`. May or may not require an API key depending on quota.
- **Keywords Everywhere:** `lib/connectors/keywords-everywhere.ts` — used by TFK enricher. Optional; engine has fallbacks if not configured.

### 10.11 Resend (Email)
- **Env:** `RESEND_API_KEY` is referenced but I have not confirmed an active send path. Verify before relying on email notifications. Likely intended for comment notifications.

---

## 11. Environment Variables

Set in `.env.local` (local dev) and in Vercel project settings (production + preview).

| Variable | Required | Used For | Set Where |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase client URL (browser + server) | `.env.local` + Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (browser-safe) | `.env.local` + Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (server only, bypasses RLS) | `.env.local` + Vercel (sensitive) |
| `ANTHROPIC_API_KEY` | Yes | Claude API | `.env.local` + Vercel (sensitive) |
| `OPENAI_API_KEY` | Yes (for blog images) | DALL·E | `.env.local` + Vercel (sensitive) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Yes | Sheets service account JSON (inline string) | `.env.local` + Vercel (sensitive) |
| `GOOGLE_CLIENT_ID` | Yes | Server-side OAuth client ID | `.env.local` + Vercel |
| `GOOGLE_CLIENT_SECRET` | Yes | Server-side OAuth client secret | `.env.local` + Vercel (sensitive) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Yes | Browser-side OAuth client ID (same value as server) | `.env.local` + Vercel |
| `SEMRUSH_API_KEY` | Yes (for Semrush tools) | Semrush API | `.env.local` + Vercel (sensitive) |
| `GOOGLE_PLACES_API_KEY` | Optional | Reserved (currently unused) | `.env.local` |
| `RESEND_API_KEY` | Optional (unverified) | Email send (Resend) | `.env.local` + Vercel (sensitive) |
| `NEXT_PUBLIC_SITE_URL` | Optional | Portal canonical URL (for OAuth redirect construction) | Vercel |

What breaks if missing:
- **Supabase keys missing →** App fails to boot.
- **`ANTHROPIC_API_KEY` missing →** Content engine, TFK, Ask LVL3, summaries all error out.
- **Google OAuth client missing →** Reconnect flow breaks; existing token still works until expiry.
- **`GOOGLE_SERVICE_ACCOUNT_KEY` missing →** Projects page errors.
- **`OPENAI_API_KEY` missing →** Blog image generator errors.
- **`SEMRUSH_API_KEY` missing →** Semrush-dependent tools error.

---

## 12. SEO Tools Catalog

All tools live at `/tools/<slug>`. Admin-only. All persist runs to `tool_runs`.

| Tool | Status | Inputs | Outputs | APIs Hit |
|---|---|---|---|---|
| Keyword Quick Wins | Live | Client (GSC URL) | Table of queries at positions 4–20 with traffic potential | GSC |
| AI Visibility | Live | Client | Branded vs non-branded query split + trend | GSC |
| Content Gaps | Live | Client | High-impression low-CTR queries needing better content | GSC |
| Semrush Gap | Live | Client + 1–4 competitor domains | Keyword gap table, persisted to `semrush_reports` | Semrush |
| Blog Image Generator | Live | List of prompts | Batch of resized images uploaded to Supabase | OpenAI DALL·E + Sharp + Supabase Storage |
| Content Refresh Finder | Stub / coming soon | TBD | TBD | TBD |
| Landing Page CRO Audit | Live | URL | Crawled + analyzed CRO recommendations | Crawler + Claude |
| Vertical Benchmark | Live | Client + vertical | Benchmark table | Semrush |
| Page SEO Audit | Live | URL | On-page SEO scorecard | Crawler |
| Content Quality | Live | URL | Content quality breakdown | Crawler + Claude |
| Core Web Vitals | Live | URL | CWV scores | PageSpeed Insights |
| GBP Audit | Live | Client / GBP location | Profile completeness + recommendations | GBP API |
| Keyword Research | Live | Seed keywords | Volume / CPC / difficulty | Keywords Everywhere / Semrush |
| SEO Content Engine | Live | Keyword XLSX | Topics → DOCX + XLSX + ZIP + Matrixify CSV | Claude + Supabase Storage |
| TFK Generator | Live | Keyword input | Targets / Funnel / Keywords XLSX + HTML | Claude + enricher |

Coming-soon UIs were intentionally added in `2e22da5` to stop 4 tools from 404ing while their backends are built.

---

## 13. Ask LVL3 — Claude Agentic Chat

### 13.1 Architecture

- **Route Handler:** `app/api/ask-lvl3/route.ts` — first Route Handler in the project.
- **Response format:** NDJSON (one JSON object per line). Event types:
  - `{ type: 'text', delta: '...' }` — assistant text delta
  - `{ type: 'status', text: 'Querying GSC...' }` — tool execution status
  - `{ type: 'artifact', url: '...', name: '...' }` — generated spreadsheet/file
  - `{ type: 'done' }` — stream end
- **Streaming:** `anthropic.messages.stream()` + `for await (const event of streamObj)`. Detect tool_use via `content_block_start` events where `event.content_block.type === 'tool_use'`. After the for-await loop, `streamObj.finalMessage()` gives the full message for the next loop iteration.
- **Agentic loop:** Run the stream → if final message contains `tool_use` blocks, execute tools → append `tool_result` user message → re-stream. Repeat until no more tool calls. Suppress text deltas during iterations that contain tool_use (don't show partial thinking before tool execution).

### 13.2 Tools

Currently one tool, defined in `lib/ask-tools.ts`:

- **`gscQuery`** — flexible Search Console query.
  - Inputs: dimensions, filters, date range, row limit.
  - Returns: rows of GSC data.
  - Uses admin OAuth via `getAdminOAuthClient()`.

### 13.3 Persistence

- Conversations: `ask_lvl3_conversations` (id, client_id, user_id, title, created_at).
- Messages: `ask_lvl3_messages` (conversation_id, role, content). `content` is the full Anthropic content block array, including tool_use and tool_result blocks.
- Server actions in `app/actions/ask-lvl3-conversations.ts` for thread management (list/create/rename/delete).

### 13.4 Artifacts

When Claude generates a spreadsheet or download:
- File written to `chat-artifacts` Supabase Storage bucket.
- RLS scopes downloads to the conversation owner.
- Cross-origin downloads use blob fetch (fix from `7e97389`).

### 13.5 Auth Caveat (repeated for visibility)

The streaming handler **must do manual auth checks** — no `requireAuth()` / `requireAdmin()` inside the stream because `redirect()` doesn't work there. See [§9.4](#94-streaming-route-handler-auth-caveat).

---

## 14. SEO Content Engine

End-to-end SEO content production pipeline.

### Pipeline Stages

1. **Input** — Admin uploads keyword XLSX (`xlsx-parser.ts`).
2. **Cluster** — Keywords grouped into post-sized topics (`keyword-engine.ts`).
3. **Context** — GSC/GA4 data fetched for each topic (`data-sources.ts`).
4. **Outline** — Claude generates outline per topic (`prompts.ts`).
5. **Draft** — Claude writes the full draft.
6. **Serialize** — DOCX written via `docx-writer.ts` (uses `docx` npm package).
7. **Persist** — Topic row written to `seo_content_engine_topics`; DOCX uploaded to `client-assets` bucket.
8. **Bundle** — On user demand: ZIP of all DOCXs + master XLSX + Matrixify-compatible CSV for Shopify imports.

### State + Recovery

- Run-level state in `seo_content_engine_runs` (status: pending/running/complete/partial/failed).
- Partial runs render gracefully — topics with status `failed` are shown alongside successes.
- "Regenerate DOCX" button (commit `42a49ca`) re-runs serialization without re-prompting Claude.

### Known Gotchas (recently fixed)

- Keywords sometimes stored as objects (legacy data); `docx-writer.ts` and the UI now coerce to strings (commits `c8d5815`, `ae720bf`).
- DOCX MIME type must be `application/vnd.openxmlformats-officedocument.wordprocessingml.document` for Supabase Storage upload (commit `5accfd9`).
- Client-side crash viewing historical runs with partial status now handled (commit `da13ce7`).

---

## 15. TFK Generator

**TFK = Targets, Funnel, Keywords.** Strategic SEO planning document generator.

### Pipeline

1. **Parse** — `lib/tfk/parser.ts` reads CSV or XLSX seed input.
2. **Enrich** — `lib/tfk/enricher.ts` adds volume / CPC / competition from Keywords Everywhere or Semrush.
3. **Generate** — `lib/tfk/generator.ts` calls Claude to produce structured TFK output.
4. **Validate** — `lib/tfk/validator.ts` schema-checks the output.
5. **Write** — `lib/tfk/writer.ts` emits XLSX + HTML.
6. **Skip-regen** — If a previous run's XLSX exists, the UI offers to load it instead of regenerating (commit `9e2571c`).

---

## 16. Operations Runbooks

### 16.1 Reconnect Google OAuth (Admin)

Symptom: Analytics widgets show "Not connected" or "Permission denied".

1. Log in as admin.
2. Navigate to the page that renders `<GoogleConnectionPanel />` (typically `/admin` or `/clients/[id]`).
3. Click **Reconnect**.
4. Complete Google consent — make sure to grant Analytics readonly + Webmasters readonly scopes.
5. You'll redirect back to `/auth/google-callback` which writes a new `admin_google_token` row.
6. Refresh the dashboard.

If reconnect fails: check `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env vars in Vercel.

### 16.2 Reconnect GBP

Symptom: GBP Audit tool errors.

1. Same as above but use `<GBPConnectionPanel />`.
2. GBP has separate OAuth scope — its token is in `admin_gbp_token`, not `admin_google_token`.

### 16.3 Add a New Client

1. Admin → `/clients` → "New Client" button.
2. Fill `name`, `slug`, `ga4_property_id`, `gsc_url`, optional `looker_embed_url`.
3. Ensure the admin Google account is granted access to the GA4 property and GSC URL.
4. Upload logo + hero image to `client-assets` bucket (via Supabase dashboard or future UI).
5. Optional: set `semrush_project_id` for Semrush-driven tools.

### 16.4 Add a New User

1. Admin → `/clients/[id]` → Invite User modal.
2. Enter email + role (`admin` / `member` / `client`).
3. For `client` role: `client_id` is pinned to the current client.
4. For `member` role: add rows to `user_client_access` for each accessible client.
5. User receives magic link → first login creates the auth.users row.

### 16.5 Run a Database Migration

```bash
cd supabase
supabase db push --include-all
```

`--include-all` is required because migration timestamps are not strictly monotonic (see migration list — `20240001_*` predates `20240101000001_*` lexically but should run first).

### 16.6 Deploy to Production

```bash
npx tsc --noEmit && npm run build   # local gate
vercel --prod                        # push to Vercel
git push                             # push to GitHub
```

**Always do both `vercel --prod` and `git push`.** The Vercel deploy comes from local files; `git push` keeps GitHub in sync. Skipping `git push` means the next dev pulls a divergent main.

### 16.7 Rotate a Secret

For any of `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `SEMRUSH_API_KEY`:

1. Generate new key in the provider's console.
2. Update Vercel env var (Settings → Environment Variables → Edit → Save).
3. Update local `.env.local`.
4. Redeploy (`vercel --prod`) so the new value takes effect.
5. Revoke the old key.

For Google OAuth credentials (rare): generate new client ID/secret in Google Cloud Console, update both env vars, then **all admin users must reconnect** (the old refresh tokens are invalidated).

### 16.8 Restore from Backup

Supabase manages daily backups automatically on paid tiers. To restore:
1. Supabase dashboard → Database → Backups.
2. Select snapshot → Restore.
3. Note: storage buckets (`client-assets`, `chat-artifacts`) are not always part of the PG snapshot — verify the bucket backup separately.

### 16.9 Investigate a Broken Tool

1. Check Vercel logs (`Deployments → Logs`) for stack trace.
2. Query `tool_runs` for the failed row: `select error, input, output from tool_runs where status = 'failed' order by created_at desc limit 10`.
3. Token issues: re-validate `admin_google_token` row exists and `expiry_date` is in the future.
4. Quota issues: check Google Cloud Console quotas (GA4 API has a daily request quota).
5. Re-run locally with same input — usually exposes the bug fast.

### 16.10 Diagnose Ask LVL3 Streaming Failure

1. Open browser devtools → Network → find the `/api/ask-lvl3` request.
2. Look at the streamed response body. NDJSON lines should appear progressively.
3. If 401/403 — auth issue, check `users` table for the requesting user's role.
4. If 500 — check Vercel logs for the Anthropic SDK error.
5. If text stops mid-stream — likely a tool_use happened. Check the `ask_lvl3_messages` row for the conversation to see what tools were called.
6. If tool execution fails — check that admin OAuth token is valid (Ask LVL3 uses admin OAuth for GSC queries).

---

## 17. Development Workflow

### 17.1 Setup

```bash
git clone https://github.com/MLawler-IQ/lvl3-portal
cd lvl3-portal
npm install
cp .env.example .env.local       # (or create from §11)
npm run dev                       # http://localhost:3000
```

### 17.2 Iteration

After every set of changes:

```bash
npx tsc --noEmit                  # must pass
npm run build                     # must pass
```

There is no test framework. Type-check + build are the only gates.

### 17.3 Conventions (from CLAUDE.md, restated here for completeness)

1. **`'use server'`** only at the top of files in `app/actions/*.ts`. Never in `lib/`.
2. **Never wrap `getAdminOAuthClient()` with `unstable_cache`** — it reads cookies.
3. **`createServiceClient()` for admin/system writes; `createClient()` for user-scoped reads.**
4. **Fix all TypeScript errors** before committing.
5. **No new packages without explicit request.**
6. **No new migrations without explicit request.**
7. **Map iteration:** use `Array.from(map.entries())` — `for...of` triggers TS target issues.
8. **App Router `params` and `searchParams` are Promises** — always `await` them.
9. **`'use client'`** at top of any component that uses hooks or browser APIs.
10. **Cookies in server components** are read-only — use server actions to write.

### 17.4 Branch + PR Conventions (inferred from history)

- Branch off `main`.
- Conventional-ish commits — recent examples: `feat: ...`, `Fix ...`, `Add ...`, with PR numbers (`#1` etc.). Format is loose; descriptive is more important than format.
- Open PR → preview deploy auto-spins on Vercel → review + merge.

---

## 18. Deployment & Infrastructure

### Vercel

- **Project name:** `lvl3-portal`
- **Production alias:** `lvl3-portal.vercel.app`
- **Framework preset:** Next.js (auto-detected)
- **Build command:** default (`next build`)
- **Output:** default (`.next`)
- **Node version:** Vercel default for Next 14 (Node 18.17+)
- **Environment variables:** All vars from [§11](#11-environment-variables) must be set per environment (production, preview, development).

### `vercel.json`

None present. All defaults.

### Middleware

`middleware.ts` runs on every request. It exists primarily to refresh Supabase sessions so users stay logged in across long-running tabs.

### Preview Deploys

Vercel automatically creates a preview deployment on every PR. Preview deploys share the production Supabase project, so DB writes go to the same database. Be careful with destructive PR previews.

### CI / GitHub Actions

**None.** `.github/workflows/` is empty. Type-checking and build verification are local-only. See [§19](#19-observability--known-gaps).

---

## 19. Observability & Known Gaps

This product has been built fast and pragmatically. The following gaps are known and intentional — addressing them is on the future roadmap.

| Gap | Impact | Recommended next step |
|---|---|---|
| No test framework | Regressions caught only by manual QA + typecheck | Add Vitest for `lib/` utilities; Playwright for top user flows |
| No CI | Bad commits can land on `main` if local checks skipped | Add a GitHub Action: `npm ci && npx tsc --noEmit && npm run build` on every PR |
| No structured logging | Vercel logs are unstructured `console.*` | Add `pino` or rely on Vercel's log drains; structure key events as JSON |
| No error tracking | Errors caught only by user reports | Add Sentry (or similar); critical for content engine + Ask LVL3 |
| No cron/background jobs | All "refresh" actions are user-triggered | Add Vercel Cron for daily analytics summary regen, weekly Semrush refresh, monthly client reports |
| Resend integration unverified | Comment notifications may not send | Trace `RESEND_API_KEY` usage and confirm or remove |
| No usage analytics | Don't know which tools get used | Add PostHog or similar — low priority |
| Single admin OAuth token | If revoked, every client's analytics breaks | Tolerable for now (1 admin); consider per-client OAuth long-term |
| No DB connection pooling configuration | Supabase handles for us | Monitor if scaling |
| `xlsx` package CVE history | Watch for advisories | Consider `exceljs` migration if a vuln surfaces |

---

## 20. Recent Activity & Active Work

Last 20 commits (most recent first), grouped by theme:

### Rebrand (current focus)
- `6d1820b` — Rebrand portal to IgniteIQ v4.2 (#1)

### GBP token separation
- `c7e4816` — Separate GBP OAuth token from main Google token
- `59be0bb` — Add Reconnect button to GoogleConnectionPanel for scope upgrades

### Tools architecture
- `2d3ef9d` — Build GBP Audit tool
- `2e22da5` — Fix 4 unbuilt tools 404ing — add coming-soon status
- `2a30c78` — Clean up unused state in ToolsHubClient
- `d2ba1f1` — Tools architecture + Phase 1 tools (Content Refresh Finder, CRO Audit, Vertical Benchmark)

### TFK Generator
- `9e2571c` — TFK: load existing output XLSX to skip regeneration

### SEO Content Engine stability
- `7e97389` — Fix spreadsheet download — use blob fetch for cross-origin URLs
- `a3a7d2a` — Fix partial topics showing as failed during live pipeline runs
- `9d14bfa` — Add ZIP download and Matrixify CSV export
- `5accfd9` — Fix DOCX upload MIME type
- `c8d5815` — Fix docx-writer crash when DB stores keyword entries as objects
- `42a49ca` — Add Regenerate DOCX button
- `7b966d9` — Show visible error banner when DOCX download fails
- `ae720bf` — Fix React error #31: coerce DB keyword objects to strings
- `da13ce7` — Fix client-side crash viewing historical runs

### Ask LVL3
- `3ea7d7f` — Add spreadsheet download to Ask LVL3 chat
- `7877aad` — Add RLS policies for chat-artifacts storage bucket

### Documentation
- `ddba9f0` — Split CLAUDE.md into core + reference files for reduced context usage

---

## 21. Quick Reference Appendices

### Appendix A — Environment Variables (One-line each)

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (browser).
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (server, bypasses RLS).
- `ANTHROPIC_API_KEY` — Claude API.
- `OPENAI_API_KEY` — DALL·E.
- `GOOGLE_SERVICE_ACCOUNT_KEY` — Inline JSON for Sheets.
- `GOOGLE_CLIENT_ID` — Server-side OAuth ID.
- `GOOGLE_CLIENT_SECRET` — Server-side OAuth secret.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Browser-side OAuth ID.
- `SEMRUSH_API_KEY` — Semrush API.
- `GOOGLE_PLACES_API_KEY` — Reserved.
- `RESEND_API_KEY` — Email (unverified).

### Appendix B — All Routes (One-line each)

Pages: `/`, `/login`, `/dashboard`, `/projects`, `/deliverables`, `/insights`, `/services`, `/ask-lvl3`, `/clients`, `/clients/[id]`, `/clients/[id]/settings`, `/tools`, `/tools/keyword-quick-wins`, `/tools/ai-visibility`, `/tools/content-gaps`, `/tools/semrush-gap`, `/tools/blog-image-generator`, `/tools/content-refresh-finder`, `/tools/landing-page-cro-audit`, `/tools/vertical-benchmark`, `/tools/page-seo-audit`, `/tools/content-quality`, `/tools/core-web-vitals`, `/tools/gbp-audit`, `/tools/keyword-research`, `/tools/seo-content-engine`, `/tools/tfk-generator`.

API: `POST /api/ask-lvl3`, `POST /api/generate-blog-images`, `POST /api/seo-content-engine`, `POST /api/tfk-generator`, `POST /api/tools/content-refresh-finder`, `POST /api/tools/gbp-audit`, `POST /api/tools/landing-page-cro-audit`, `POST /api/tools/vertical-benchmark`, `GET /auth/callback`, `GET /auth/google-callback`.

### Appendix C — All Tables (One-line each)

- `clients` — Client orgs.
- `users` — Portal users.
- `user_client_access` — Member↔client M2M.
- `deliverables` — Files/links per client.
- `comments` — Threaded comments on deliverables.
- `posts` — Blog/insights.
- `services` — Services catalog.
- `admin_google_token` — Single-row admin OAuth token (GA4/GSC).
- `admin_gbp_token` — Single-row admin OAuth token (GBP).
- `ask_lvl3_conversations` — Chat threads.
- `ask_lvl3_messages` — Chat messages.
- `semrush_reports` — Cached gap analyses.
- `seo_content_engine_runs` — Content engine runs.
- `seo_content_engine_topics` — Per-topic outputs.
- `tool_runs` — Universal tool execution history.

### Appendix D — All Migrations (One-line each)

See [§8.2](#82-migration-history-chronological) for the full chronological table.

### Appendix E — All External Services + Auth Method

| Service | Auth |
|---|---|
| Anthropic | API key |
| Google (GA4, GSC) | Admin OAuth2 (`admin_google_token`) |
| Google Sheets | Service Account JSON |
| Google Business Profile | Admin OAuth2 (`admin_gbp_token`) |
| Supabase | Anon key (browser) / Service role (server) |
| OpenAI | API key |
| Semrush | API key |
| PageSpeed Insights | API key (optional) |
| Keywords Everywhere | API key (optional) |
| Resend | API key (unverified) |

### Appendix F — Cross-reference to Existing `.claude/` Docs

These remain canonical for the deeper dive on each topic. **This HANDOFF.md does not replace them.**

- `.claude/CLAUDE-db-schema.md` — Full DB schema with column-level detail.
- `.claude/CLAUDE-routes.md` — Per-route narrative descriptions.
- `.claude/CLAUDE-google-api.md` — Detailed OAuth2-vs-service-account explanation.
- `.claude/CLAUDE-seo-tools.md` — Per-tool logic + Ask LVL3 architecture + dashboard date-range system.
- `design-system/DESIGN.md` — Canonical design specs.
- `design-system/lvl3-portal/MASTER.md` — Generated design master reference.

### Appendix G — Glossary

- **Apex** — Apex Service Partners, the primary PE-backed home services aggregator client.
- **GBP** — Google Business Profile (formerly Google My Business).
- **GA4** — Google Analytics 4.
- **GSC** — Google Search Console.
- **TFK** — Targets, Funnel, Keywords — strategic SEO planning document.
- **CRO** — Conversion Rate Optimization.
- **CWV** — Core Web Vitals.
- **PSI** — PageSpeed Insights.
- **RLS** — Row-Level Security (Postgres / Supabase).
- **RSC** — React Server Component.
- **NDJSON** — Newline-Delimited JSON.
- **Matrixify** — Shopify import format for bulk content uploads.

---

*End of handoff. For anything not covered here, start with the file paths above — every claim in this document is grounded in code under `/Users/matthewlawler/lvl3-portal/`.*
