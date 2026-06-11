# SEO Tools & Ask LVL3

## SEO Tools

All tools are admin-only. Registry: `lib/tools/registry.ts` — 19 entries, 16 active + 3 `coming-soon` (hidden from the hub: Schema Markup Generator, Service Page Generator, Indexation Monitor). Client-input tools require a client selected in the top bar; GSC-backed ones call `fetchGSCRows` (90-day window, up to 25k rows via admin OAuth).

| Tool | Logic |
|------|-------|
| Keyword Quick Wins | Position 4–20, 100+ impressions. Opportunity score = (est clicks at #3 − actual clicks) × (1/position) × 100 |
| AI Visibility Check | Branded vs non-branded split. Brand terms = client name + slug + domain hostname prefix |
| Content Gap Finder | Three gap types: high-impression-no-clicks (200+ imp, <1% CTR, pos ≤30), near-page-one (pos 11-20, 150+ imp), ranking-but-weak (pos ≤10, CTR below position benchmark) |
| Semrush Gap Analysis | Competitor keyword gap analysis via Semrush API. Matrix view, pre-filters, relevance scoring. Reports persisted in `semrush_reports` table. |
| Backlink Overview | Domain authority, organic traffic, backlink count, referring domains via Semrush |
| SEO Content Engine | Pipeline: keyword research → content brief → draft article → DOCX export. Pre-fills `clients.brand_context`. Parallel topics. |
| TFK Page Generator | ACF-ready location page copy for True Food Kitchen stores via Google Places + Claude |
| Blog Image Generator | Batch DALL-E image generation from CSV input. Uses OpenAI API (`OPENAI_API_KEY`) + sharp for resizing. Uploads to Supabase Storage. |
| Keyword Research | Volume, CPC, competition, 12-month trends for up to 100 keywords (Keywords Everywhere) |
| Core Web Vitals | CrUX field data (LCP, CLS, INP) + Lighthouse performance via PageSpeed Insights |
| Page SEO Audit | Crawls a URL: title, meta description, headings, images, structured data, canonical |
| Content Quality | Word count, reading level, heading structure, alt coverage, internal linking density |
| Content Refresh Finder | Pages with declining GSC traffic + AI refresh briefs; one-click send to Content Engine |
| Landing Page CRO Audit | Scores form friction, CTA clarity, trust signals, page speed; tracks runs over time |
| Vertical Benchmark | Best-in-class vertical research, SEO/GEO pattern extraction, LLM citation probing |
| GBP Audit | Audits all GBP locations for NAP, phone, website, hours, category, description completeness |

## Ask LVL3 Chat

`/ask-lvl3` — Claude-powered agentic chat with client-specific context.

**Architecture:** Streaming NDJSON via Route Handler (`app/api/ask-lvl3/route.ts`). Agentic loop (max 6 iterations) — Claude calls tools autonomously until it has enough data to answer. 13 tool definitions in `lib/ask-lvl3/tools/`: `get_gsc_data`, `get_ga4_data`, `list_gbp_accounts`, `get_gbp_locations`, `get_gbp_insights`, `get_keyword_data`, `get_related_keywords`, `get_domain_visibility`, `get_competitor_gap`, `get_backlink_overview`, `get_core_web_vitals`, `crawl_page_seo`, `create_spreadsheet`. Text deltas are suppressed during tool_use iterations; status events (`{ type: 'status', text: '...' }`) are emitted instead.

**Persistence:** Conversations stored in `ask_lvl3_conversations` + `ask_lvl3_messages` tables. Thread picker UI with select dropdown + delete.

Context injected into system prompt:
1. Client name
2. `analytics_summary` (stored narrative from last insight refresh)
3. `snapshot_insights` (takeaways, anomalies, opportunities)

Model: `claude-sonnet-4-6`, max_tokens: 4096.

## Dashboard Date Range System

Dashboard period and comparison are URL params: `?period=28d&compare=prior&tab=website`

- Period pills: `7D | 28D | 3M | 6M | 12M` → `7d | 28d | 90d | 180d | 365d`
- Compare: `prior` (preceding equal window) or `yoy` (same window 365 days back)
- Server page reads params → calls `fetchAnalyticsData` + `fetchDashboardReport` with a `DateRange` object
- `DashboardTabs.tsx` is a `'use client'` component using `useSearchParams` + `useRouter` to update URL
