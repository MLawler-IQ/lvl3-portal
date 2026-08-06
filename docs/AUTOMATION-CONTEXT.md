# Automating LVL3 SEO Services: Full Context

**Purpose of this document.** Everything decided, researched, proven and rejected across a long working session, assembled so Claude Code can produce a build plan. This is context and constraints, not a build plan itself. Where something is unproven or uncertain, it says so.

**Target repo:** `MLawler-IQ/lvl3-portal` (Next.js 14 App Router, TypeScript 5, Supabase, Tailwind, Recharts, Anthropic SDK, Vercel). Live at portal.igniteiq.com. Supabase project `zoeaifsxnaenlcdkavzf`.

**Date of context:** August 2026.

---

## 1. The goal

Turn LVL3's human-delivered SEO service into a mostly-automated system with the portal as the hub. The full loop the owner wants:

1. **Conversational onboarding** replaces the current access-setup form, and captures client context the system needs.
2. **Run the audit** automatically and produce a strategy.
3. **Turn the strategy into task lists** in an in-portal project tracker.
4. **Execute a task** by dispatching an agent that implements the change on the client's site.
5. **Requires connecting client CMS and hosting** so redirects, page titles and similar can be managed from the portal.

Humans keep strategic judgment, content decisions, link acquisition, and the client relationship. That split is deliberate and is defended below.

**Key client context:** primary account is Apex Service Partners, a PE-backed home-services aggregator with 250+ brands, priced $2,500-3,500/mo per brand by volume tier. Pilot client is Tornado HVAC (tornadohvacca.com), a single-location Los Angeles HVAC and duct-cleaning business.

---

## 2. What already exists in the portal

Do not rebuild these.

| Asset | Detail |
|---|---|
| **16 active SEO tools** | `lib/tools/registry.ts`, 19 entries (16 active, 3 coming-soon). Includes Vertical Benchmark, Content Gap Finder, Keyword Quick Wins, Semrush Gap Analysis, Backlink Overview, SEO Content Engine, Core Web Vitals, Page SEO Audit, Content Quality, Content Refresh Finder, Landing Page CRO Audit, GBP Audit, Keyword Research, Blog Image Generator, TFK Page Generator, AI Visibility Check |
| **Ask LVL3** | Agentic chat, max 6 iterations, 13 headless tools in `lib/ask-lvl3/tools/`, streaming NDJSON, conversation persistence |
| **Connectors** | `lib/connectors/`: gbp.ts (~21KB, `auditGBPAccount`, `fetchGBPClientInsights`), pagespeed.ts, keywords-everywhere.ts, semrush-portal.ts, crawler.ts (cheerio, single-URL, static only), types.ts |
| **Crawlers** | `lib/crawlers/semrush-audit.ts` wraps Semrush Site Audit API |
| **Google APIs** | GA4 + GSC via admin OAuth (`analytics@igniteiq.com` identity), GBP via a separate identity (`matt@igniteiq.com`), Sheets via service account |
| **Draft gate** | `snapshot_insights_draft` column plus `CLAUDE.md` convention #12: LLM output never writes to a client-visible column directly |
| **Caching** | `lib/api-cache.ts`, `api_cache` table (key, payload jsonb, expires_at, created_at) |
| **Other tables** | clients, users, user_client_access, deliverables, comments, posts, services, tool_runs, client_annotations, semrush_reports, seo_content_engine_runs/topics, ask_lvl3_conversations/messages, admin_google_token, admin_gbp_token |
| **Client fields** | `gbp_account_id`, `gbp_location_group`, `ga4_property_id`, `gsc_site_url`, `brand_context`, `competitors[]`, `google_sheet_id`, `sheet_column_map`, `client_type` |
| **Existing settings AI** | `app/actions/recommendations.ts` pre-fills brand terms, competitors and key events. **Important precedent:** deterministic heuristics, LLM refinement that can only *select* from a candidate list and never invent, graceful degradation on every failure path. The synthesis pattern is already solved once in this codebase |
| **Deps available** | docx, xlsx, jszip, sharp, cheerio, zod, googleapis, openai, @anthropic-ai/sdk. Playwright is a devDependency only (e2e), not wired for production |

**Current clients in the portal:** 4 (MantelMount, Pasha Health, Tapps Electric, True Food Kitchen). Tornado HVAC needs adding. Not 250. Scope accordingly.

---

## 3. What is missing (verified against the code, not assumed)

1. **The tools are UI routes, not callable functions.** Each of the 16 lives behind a page. Only the ~13 Ask LVL3 tools are headless, and they don't cover the core audit workflow. Vertical Benchmark, Content Quality, Keyword Quick Wins, AI Visibility, Content Gaps, CRO Audit and GBP Audit have no headless entry point. **Nothing can orchestrate them until this is fixed.**
2. **No plan or recommendation data model.** `snapshot_insights_draft` holds a dashboard narrative, not a structured task list. `app/actions/recommendations.ts` is settings pre-fill, not a roadmap.
3. **No orchestrator.** Nothing chains the tools or emits a prioritized plan.
4. **No JS rendering in production.** The crawler is cheerio over a single fetch with `redirect: 'follow'`, so redirect chains are invisible and client-side-rendered content is unreadable.
5. **No site-wide crawl of our own.** Site-wide technical data currently comes from Semrush Site Audit.
6. **No robots.txt or sitemap ingestion.**
7. **No call tracking integration.** For home services, calls are the conversion. This gates outcome reporting entirely.
8. **No citation/directory data source.**
9. **No GBP locations-list tool on the MCP surface.** `get_location_performance` and `get_search_appearances` exist but need a location ID that Google no longer exposes in its UI. The portal has `get_gbp_locations` internally; exposing it unlocks GBP calls and direction requests.
10. **No scheduler.** The one scheduled tool (Indexation Monitor) is still `coming-soon`.
11. **No eval set.** Zero labeled examples of good audits or good plans.

---

## 4. The advisory panel and its conclusions

A panel was assembled by lens rather than by fame. Its conclusions are the reasoning behind the decisions in section 5.

| Seat | Lens | Core contribution |
|---|---|---|
| **Taiichi Ohno** | Flow and waste | "You already built the 16 stations of an assembly line by hand. Nobody built the conveyor." The waste is the human carrying data between tools. Automate the seams before the intelligence. Stop the line on a defect rather than passing it downstream |
| **Andrej Karpathy** | LLM/agent systems | Reuse what exists, simplest thing that works, heavy evals. The eval is the spec. Later reversed on sequencing: build the diagnostic surface before the chat surface |
| **Marie Haynes** | Google risk | Content and links are where scaled automation creates durable, irreversible damage. Automate around them, not them. **Non-negotiable** |
| **Rand Fishkin** | Strategy | Outcomes over activity. Every check must name the outcome it protects or be deleted. Rank by expected revenue impact, not by audit convention |
| **Ben Treynor Sloss** | Reliability | Availability multiplies across dependencies. Design for partial success. An incomplete audit that looks complete is worse than a visible failure |
| **Jason Fried** | Product | Decide what the product *is*. Fewer, better things. The hybrid's failure mode is never making the cut |
| **David Ogilvy** | Agency craft | Clients buy confidence, not findings. The felt experience of the plan, reporting and meetings is the product surface. Automation is invisible to the client; polish is not |
| **Boris Cherny** | Builder | Ship a thin version on one client and let reality resolve the open questions. Build the eval before the thing it evaluates. Buy the crawl, build only the differentiator. Tool *interfaces* must be built for a model to consume, not a human clicking |
| **Elon Musk** | First principles | Delete before automating. The most common error of a smart engineer is optimizing a thing that should not exist. Every requirement needs a name attached |

**The panel's central finding:** this is not a from-scratch build. It's an assembly problem. Most of the stations exist; the line does not.

**The live disagreement worth preserving:** Fried and Musk push toward collapsing surfaces and productizing the system as a brand asset. Boris and Karpathy push back that nothing has shipped and there are no evals, so branding a system that doesn't exist is backwards. Resolution adopted: build thin on one client, but design the data model and client surface cleanly enough that productizing later is packaging rather than a rebuild.

---

## 5. Decisions already made (do not relitigate)

Recorded from a formal decision pass. Two went against the panel's recommendation and carry forcing functions so the hedge cannot become permanent.

| # | Decision | Notes |
|---|---|---|
| **D1** | **Product frame: phased hybrid.** Automate the current deliverable catalog now, add an AI-visibility line, migrate toward outcome-based delivery over 2-3 quarters | *Against* the board's outcome-engine pick. Conditions: the AI-visibility deliverable ships in the pilot, not later; the catalog gets re-cut against outcomes on a named trigger, target Q1 2027, treated as a floor not a target. The deletion pass (which deliverables never get implemented or never move results) happens regardless |
| **D2** | **Data backbone: dual-source.** GSC + GA4 as first-party truth, DataForSEO as the programmatic base, one premium platform retained for backlink depth and validation | *Against* the panel's pure-backbone pick, but defensible. **Coupling rule: all new pipeline code targets DataForSEO and GSC/GA4 only. Semrush lives in a validation layer and must never become a pipeline dependency.** Keep Semrush (already wired); don't add Ahrefs without a reason |
| **D3** | **Crawl: Sitebulb, manual runs to start.** Amended from "buy a managed crawl API" | Sitebulb already ships the raw-vs-rendered diff ("Response vs Render" report plus 12 Rendered hints) and near-duplicate similarity scoring. That eliminated the largest build item on the plan. **What gets built is an ingester, not a crawler.** Also resolves D2's contradiction, since Sitebulb replaces Semrush Site Audit. Desktop Pro ($425/yr) for the pilot; Cloud Small (~$2,940/yr, 1M URLs/mo) when the fleet turns on |
| **D4** | **Content and links stay human-gated.** Content is draft-gated with human publish approval; link acquisition stays human-led with automation only on prospecting | Matches the panel. Load-bearing for the entire risk model. Every approve/edit/reject becomes labeled data |
| **D5** | **Portal DB is the system of record** for tracking. The client-facing Google Sheet is rendered from it or retired | The roadmap the machine generates, the tasks the team works, and the tracker the client sees must be one object |
| **D6** | **Own templated implementation** where CMS access exists: location pages, NAP push, GBP, schema. Engineering-level changes stay handoff with paste-ready specs | This is the decision that makes agent execution the logical next step. Requires a change log and a rollback path before any direct implementation runs |
| **D7** | **Pilot: Tornado HVAC.** One brand, real data, output draft-gated and internal until it earns trust | Success criterion: the system produces a plan the owner would approve with under 30 minutes of editing, with every data gap visibly flagged |

---

## 6. Research findings that constrain the design

Cited research, current as of August 2026. Full detail and sources in the companion research report if needed.

### Google risk (the hard constraints)
- Google's guidance is neutral on method, strict on intent: using AI "to generate many pages without adding value for users may violate Google's spam policy on scaled content abuse."
- The Helpful Content system was **folded into core ranking** in March 2024. It is now a continuous, site-wide signal, so thin automated pages can suppress an otherwise healthy domain.
- Quality Rater Guidelines updated twice in 2025 to flag low-effort AI main content as lowest quality.
- **Links are the asymmetric risk.** Once Google neutralizes spammy links, "any ranking benefit... is lost" and cannot be regained. Much of the damage is algorithmic suppression with no manual-action notice, so the absence of a penalty is not evidence of safety.

### The AI-answer shift (changes what deliverables mean)
- AI Overviews cut organic clicks **38%** on triggered queries (randomized field study), Pew measured 8% CTR with an AI summary versus 15% without, Seer measured a **61%** drop on informational queries with AIOs since mid-2024.
- Being cited *inside* the answer is the new prize, and a top-10 organic position no longer guarantees it.
- AI crawlers (GPTBot, ClaudeBot, PerplexityBot) **do not execute JavaScript**. Server-rendered content is a prerequisite for AI citation.
- **llms.txt is not used** by Google or major AI engines. Flag its presence, never prioritize it.

### Architecture and evaluation
- Anthropic's guidance: find the simplest solution, add complexity only when it demonstrably improves outcomes.
- Deterministic pipelines beat agentic loops on reliability, cost and testability for predictable work. Agents use roughly 4x the tokens of chat; multi-agent ~15x. Errors compound across unvalidated steps.
- Consensus pattern is hybrid: deterministic DAG for the skeleton, LLM only for genuinely open-ended reasoning.
- Human-in-the-loop best practice: **draft-and-approve with edit-before-publish**, gates placed before consequential or client-visible actions rather than on every internal step.
- LLM-as-judge is useful but noisy (documented verbosity, position and self-preference biases). Layer it with deterministic checks, golden-dataset regression tests, and human review.
- Five dependencies at 99.9% availability yield ~99.5% composite. Design for partial success: each data source is a soft dependency; a failure produces a clearly flagged gap rather than a failed run.
- **LLMs are systematically overconfident.** Verbalized confidence diverges from accuracy. Use consistency/voting or calibrated signals to route attention, and validate calibration against outcomes over time.

### Service and product design
- Productized services report materially higher gross margins than general agencies, though the specific figures are vendor-authored and should be treated as directional.
- Outcome reporting (leads, calls, revenue) beats activity reporting, and 2026 guidance explicitly calls for retiring impressions and untargeted traffic as headline metrics. **This requires conversion and call tracking in place from day one.**
- Home-services phone leads convert at ~46% on the call, the highest of any industry, versus a ~1.7% cross-industry web-form average (Invoca, 60M+ calls). For HVAC the revenue center of gravity is local pack visibility plus mobile click-to-call.
- Automation has cut agency costs 20-30% on routine work (reporting -50%, keyword research -40%, briefs -35%) and near-zero on strategy, relationships and complex implementation. **Capture that as margin rather than racing price down.**
- Multi-location pricing typically runs base plus $500-800 per additional location, with roughly 40% per-location cost decrease at 20+ locations.

### Data providers
- DataForSEO is pure pay-as-you-go with no subscription floor, roughly 40-200x cheaper per query than Ahrefs/Semrush for raw programmatic data. Ahrefs/Semrush bundle API access with a platform subscription, so their marginal cost only wins after the fixed floor.
- **Google removed the `&num=100` parameter in September 2025.** Retrieving the top 100 now takes 10 requests instead of 1; deep rank-tracking prices reportedly moved from ~$1 to $8-12 per 1,000 keywords, and GSC impressions dropped across ~88% of sites. Reset historical baselines around that date.
- GSC API limits: 50,000 rows/property/day, 1,200 QPM/site, 16 months retention, impression-weighted average position (not clean rank).

---

## 7. The audit rubric

An **80**-check rubric was produced covering technical SEO, on-page, local search, generative engine optimization, CRO, authority/off-site, and measurement readiness. Every check carries: id, category, check description, **the client outcome it protects**, how to test it, automation tier (auto/assisted/manual), revenue-weighted severity, effort to fix, and two applicability flags.

> **Correction (2026-08-06).** This paragraph previously said 78 checks and listed
> **pass/fail criteria** among the fields. `docs/rubric/rubric.json` has **80** rows and
> **no row carries a pass/fail-criteria field** — verified across all 80. That matters
> beyond bookkeeping: it is the sentence that would let a future author believe a
> numeric threshold was licensed by the rubric when it is not. Where a check needs a
> cutoff, the rubric constrains it at most from one side (ONPAGE-012's note "Tornado
> median was 29% unique / 71% template" is an OBSERVATION that must be caught, not a
> line to sit on), and the chosen number must be marked as ours at its definition — the
> pattern `lib/scoring/config.ts` and
> `lib/findings/analyses/content-template-ratio.ts` both follow.

Design rules baked in:
- **If a check cannot name the outcome it protects, it gets deleted.** This is the rule that keeps the rubric from becoming audit theater.
- Nine legacy checks were explicitly excluded as folklore: meta keywords, keyword-density targets, LSI keywords, text-to-HTML ratio, W3C validation as a ranking factor, exact-match-domain bonus, Domain Authority/DR as a Google ranking factor, routine toxic-link disavow, and llms.txt as a ranking lever.
- Severity is weighted by revenue impact for a local service business, not by audit convention.

**Two checks were added after running the rubric on real data:**
- **`ONPAGE-012` content-to-template ratio.** A pure near-duplicate check *passed* Tornado while its pages were 71% boilerplate. Similarity detection cannot catch AI content that is unique-but-worthless. Flag page groups that are large and have a low median unique-content share.
- **`LOCAL-016` service-area radius coherence.** Compare the GBP service areas and real business address against the geography targeted by location pages. No check on any list caught that a Sherman Oaks business was targeting Orange County.

The rubric itself is a separate artifact and is not yet in the repo. It should be seeded as extensible data, not inline SQL.

---

## 8. Tool coverage reality

Measured against the code, then re-measured after the Sitebulb decision.

- Before Sitebulb: **23 of 78 checks** could run today, 40 partial, 15 with no data source. Only **3 of the 9 critical checks** worked.
- After Sitebulb: roughly **45 ready, 28 partial, 5 missing** (estimate, pending confirmation by a full run with the correct audit template).
- Remaining true gaps: **call tracking**, citation/directory data, structured-data validation (a config problem, not a capability gap), and mobile viewport/position checks Sitebulb doesn't perform.

**Two lessons that should shape how this gets built:**
1. Twice in two days, inferring a tool's capability from its source code overstated what it actually returns. The GBP audit is ~21KB of code and exports **eight fields** (no hours, no reviews, no services, no photos), covering roughly 4 of 15 local checks. **Build coverage claims from observed output, not from reading source.**
2. A metadata estimate said the clients table was empty when it had four rows. Trusting a summary over a real query produced a wrong conclusion. This is the same class of failure the pipeline's degraded-data flags exist to catch: a source returning something plausible but stale.

---

## 9. The Tornado pilot: what a real run produced

This was done manually, in a chat session, and is the reference output the automated version must match. It is also eval case #1.

**Site profile:** WordPress + Yoast, 206 internal URLs, server-rendered. 130 `/Service/[service]-in-los-angeles-ca/` pages plus 18 `/areas-we-serve/` pages, all evidently AI-generated (one hero image literally named `ChatGPT-Image-Feb-8-2026`).

**Headline finding:** the mass-produced pages don't work.
- **106 of 130 service pages have zero impressions.** Not zero clicks. Zero impressions.
- All 130 together produced **42 clicks**. The homepage alone produced 58.
- Median position of the 24 that get impressions: **20.7** (page three).
- Site-wide over 90 days: **315 clicks on 167,144 impressions, 0.19% CTR, average position 25.8.**
- **89% of clicks are branded** ("tornado hvac" alone is 122 of the top 50's 150 clicks).

**Root cause, found via Semrush after the crawl:** two complete generations of service page compete against each other. Older flat URLs (`/attic-fan-install/`, `/heat-pump-install/`, `/furnace-install/`, `/air-duct-cleaning/`) run alongside the 130 newer ones targeting identical terms. "dustless duct" has 4 URLs at positions 35/70/82/90; water heater has 3; thermostat, HVAC inspection, heat pump, furnace and mini split each have 2.

**And the best asset on the site is an old hand-built page.** `/attic-fan-install/` ranks #1 for "attic fan installation near me" (18,100 monthly volume). No AI page comes close. So the fix is consolidation to one canonical page per service, keeping whichever URL holds the equity, not deletion.

**Biggest single opportunity:** "air duct cleaning" produced **22,596 impressions and 1 click at position 17.9**. That is 13.5% of all site impressions, on a term Semrush puts at 165,000 monthly volume.

**Opportunity model** (conservative CTR curve, 6% local-share haircut on national volumes, 12 stuck keywords): ~105 clicks/month today, ~770/month modelled at position 8, ~1,400/month at position 5. Present as a range with assumptions visible, never as a promise.

**A negative result that improved the diagnosis.** Comparing the 24 earning pages against the 106 invisible ones: **median inbound internal links 186 for both cohorts**, content length near-identical (1,500 vs 1,420 words). So the invisible pages aren't thin or under-linked. That kills the internal-linking hypothesis and strengthens consolidation. It also revealed that **186 links on nearly every page means a footer or mega-menu links to everything**, so internal linking currently signals no priority at all. Different fix, better fix.

**Other verified findings:**
- **191 of 206 URLs have no `<h1>`**, including the homepage. The template puts the topic in an `<h2>`. One template change, 191 pages, best impact-to-effort ratio on the site. Sitebulb rates this "Medium / Opportunity."
- **92 URLs** fail viewport sizing and tap-target spacing. HVAC emergency search is mobile and converts by tapping to call.
- **No GA or GTM code detected on any of 187 HTML pages**, and zero goal conversions recorded against the 37 URLs receiving traffic. Nothing is currently measurable.
- 130 URLs use `/Service/` with a capital S. 18 broken internal URLs, 16 uncrawled, 2 hard 404s, 49 pages with broken bookmark links. One live page contains Lorem Ipsum.
- **Zero AI Overview appearances** across 167,144 impressions. Honest read: not ranking well enough to be cited yet. Fix position first, then GEO.
- **Semrush overstates traffic by ~10x** (997 monthly visits estimated vs ~105 actual from GSC). Live argument for D2's first-party-is-truth rule.
- **GBP is the strongest asset:** 5.0 stars on 129 reviews, Open 24 hours, correct primary category ("HVAC contractor"), no keyword stuffing in the name.
- **Service-area constraint:** the business is at 15115 Califa St, Sherman Oaks. An SAB ranks by proximity to its real address, not its declared areas. The site has pages targeting Orange County (45-65 miles away). Only 3 of 18 area pages ever earned an impression; all 18 produced 4 clicks combined.
- **The GBP audit produced a false positive:** it reported "No storefront address" and docked the score to 85. Tornado is a service-area business with a hidden address, which is correct configuration. **An automated audit that faults a client for correct configuration destroys trust in every other finding.** Add SAB detection as a precondition on any address check.
- **PageSpeed API daily quota was exhausted**, so Core Web Vitals went unevaluated. The tool failed cleanly with an explanatory note, which is the right behavior. At 250 brands this is a hard constraint; request a quota increase before any fleet run.

**Prioritized plan produced (the shape the automated version should emit):** P1 consolidate the competing page sets · P1 add H1 to the template · P1 fix mobile viewport and tap targets · P1 repair analytics tracking · P1 move the duct-cleaning cluster to page one. Then P2 (5 items), P3 (6 items), P4 (3 items). Nineteen items total, each with effort tier and DFY-versus-handoff execution model.

---

## 10. Competitive context: Power Digital's Omega

Launched ~30 July 2026, days old at time of review. Positioned as an "AI growth operating system."

**Their published architecture** (from their own page): "built on nova, Power Digital's proprietary technology ecosystem. SOC2 compliant. Every datasource has an individualized knowledge graph that improves and gets smarter over time, with a reinforcement layer and distinct semantic layer built within Looker Enterprise and Snowflake." Client login via Auth0. Their branded model is called "Iris."

**Three surfaces plus a loop:**
1. **Detect / Workflow** — continuous diagnostic, opportunities ranked by impact, "recommending the next move before anyone has to ask." Listed first and clearly primary.
2. **Analyze / Chat** — sourced answers that show reasoning.
3. **Execute / Agents** — "Our team approves, agents execute."

**What this validates:** their gate is functionally identical to convention #12 and decision D4. A $3B-media-spend agency independently landed on the same human-approval architecture. Their "every answer shows its sources and reasoning" turns Treynor's reliability argument into a **marketable trust feature**, which is a genuine reframe: build client-visible provenance as a feature, not an admin warning. They also built on Snowflake and Looker rather than a bespoke platform, reinforcing buy-don't-build.

**What to treat skeptically:** "not just a wrapper over a generic model" appears twice, and "Iris" is almost certainly a retrieval and prompt layer over a commercial model. Their own SVP is more candid: "Everyone is buying the same AI models. We are too. The model was never the edge."

**What it changes:** build the diagnostic surface before investing further in chat (the portal built chat first, which is the harder and less differentiating surface). Generated deliverables rendered in-session become a real roadmap item rather than a nice-to-have.

**Where they don't compete:** nothing on their page touches local pack, GBP, multi-location SEO, technical crawling or schema. Their proof points are media spend and transactions, i.e. paid-media enterprise DNA (CPG, fashion, B2B). Apex's 250+ home-services brands is a narrower but genuinely proprietary dataset in a lane they don't serve.

**Terminology warning:** "Detect" is Power Digital's word. Don't adopt a competitor's vocabulary for internal components.

---

## 11. Target architecture

### Pipeline shape

Deterministic backbone, LLM at exactly one step.

```
onboarding conversation → client context
        ↓
pipeline run (client, trigger)
        ↓
stations (independent, each records ok | degraded | failed)
  ├─ sitebulb ingest (uploaded export)
  ├─ GSC performance (queries + pages, current and prior window)
  ├─ GA4 outcomes (key events, revenue by landing page)
  ├─ GBP profile (audit + reviews)
  ├─ PageSpeed / CrUX (quota-guarded)
  └─ competitive (validation layer only, per D2)
        ↓
derived analyses (pure functions, no external calls)
  ├─ cannibalization (keywords with >1 ranking URL)
  ├─ visibility cohort (earning vs zero-impression comparison)
  ├─ opportunity sizing (position → CTR over impression pools)
  ├─ content-to-template ratio
  └─ template grouping (cluster URLs by path pattern to find template-level fixes)
        ↓
findings   one row per check per run: pass | fail | degraded | not_run
        ↓
scoring    impact (computed from data) + effort (rubric lookup) → priority rank
        ↓
synthesis  ★ the only LLM call → drafted recommendations + narrative
        ↓
review     approve / edit / reject → publish → client-visible
        ↓
tracker    proposed → approved → in_progress → shipped → measured
        ↓
execution  agent implements approved tier-1 tasks on the client site
```

### The organizing object is the recommendation

Not tools, not reports. Everything upstream exists to produce, score and evidence recommendations; everything downstream acts on them. **The recommendation lifecycle *is* the project tracker** — a separate tracker should not be built.

If recommendations become the organizing object, the ten-item nav collapses to roughly four surfaces: what needs attention, what's in flight, what shipped and what it did, and ask anything. Projects, Deliverables and Insights fold into the lifecycle. Tools becomes an admin drawer.

**Do this after the pipeline works, not before.** The portal is not the current bottleneck; the backend is. But decide the organizing object *now*, because it determines whether the recommendation table is designed as a first-class citizen or bolted on later.

### Station contract

```ts
type StationResult<T> = {
  station: string
  status: 'ok' | 'degraded' | 'failed'
  message?: string
  data: T | null
  rowsIngested?: number
  durationMs: number
}
```

- A station never throws to the caller; it returns `failed` with a message.
- `degraded` means partial but usable data, flagged.
- The run continues when any station fails. It does not abort.
- Retry transient errors only, exponential backoff with jitter, at one layer only.
- Read through `lib/api-cache.ts`.
- PageSpeed must detect quota exhaustion, return `degraded`, and not retry into the wall.

### Scoring

**Impact is computed from data. Effort comes from a rubric lookup. The LLM never produces either number.**

| Recommendation type | Impact basis |
|---|---|
| Stuck keyword / position | `impressions × (target_ctr − current_ctr)` over the CTR curve, with a conservative local-share haircut |
| Template-level fix | `affected_url_count × severity_weight`, bonus if any affected URL earns impressions |
| Consolidation | summed impressions across the competing URL set × number of competing URLs |
| Measurement gap | fixed high weight, because it gates all other measurement |
| Local / GBP | weighted by local-factor category weight and by whether the profile can actually rank for the target geography |

Effort tiers: `low` (single template or config change), `medium` (bounded content work, redirect mapping, schema rollout), `high` (site-wide rewrite, dev-dependent change, new templates). Rank on `impact / effort_weight` with weights `{low: 1, medium: 2.5, high: 5}`. Persist the score inputs so any number can be explained to a client.

CTR curve as config, not hardcoded, starting deliberately below published averages because local and AIO SERPs underperform them:
```
pos:  1     2     3     4     5     6     7     8     9     10
ctr:  .22   .13   .09   .07   .055  .045  .037  .030  .026  .022
```

### The synthesis step

The single LLM call. Input: scored findings, client context, and the station status list. Output: drafted recommendations with title, body, execution model and a rationale that cites the evidence numbers.

- The model **selects and explains**. It does not invent findings, scores or numbers. Every number in the output must be traceable to the findings evidence. Follow the precedent already in `app/actions/recommendations.ts`, where the LLM can only select from a candidate list.
- Unparseable output degrades to the deterministic findings list, never to an error.
- Writes to a draft column with status `proposed`. Never to a client-visible column (convention #12).
- The prompt receives the station status list and must state which areas were not evaluated.
- Model: `claude-sonnet-4-6` via the existing Anthropic SDK setup.

### Provenance and degraded data

- Every finding carries its source station.
- Every run carries a data-completeness percentage.
- **If a station failed, every check depending on it becomes `not_run`, never `pass`.** `not_run` is a distinct state and must be modelled as one.
- Client-visible provenance is a feature: show completeness and what wasn't evaluated in the client's own view.

### Evaluation

- Golden cases with a `must_find` list of check IDs a correct run has to surface. Tornado's: the H1 template gap, the mobile viewport failure, the cannibalization cluster, the measurement gap, the service-area mismatch.
- Score recall against `must_find` and precision of the top 5.
- **Regression gate:** any change to the synthesis prompt or scoring model must clear all eval cases before merge.
- Every approve/edit/reject writes a review row capturing before, after and reason. **That table is the eval corpus, not an audit log.** It is the only path to earning autonomy later.

---

## 12. Agent execution: the highest-risk component

The owner wants approved tasks executed by agents against the client's CMS and hosting. This is a straight extension of D6, but it introduces a categorically new risk.

**The risk.** Today the worst case of a bad recommendation is an embarrassing document. With CMS and hosting write access, the worst case is a broken client site, and at Apex scale it's 250 broken sites from one bad template change. This must be designed before the first write, not after:

- Every change logged, diffable and reversible.
- **Rollback as a first-class feature**, not an afterthought.
- Blast-radius limits: one site at a time, rate-limited, hard kill switch.
- Preview or staging before production wherever the CMS supports it.
- Explicit per-client authorization scope.
- Ohno's stop-the-line becomes literal: a failed change halts the queue rather than continuing down the list.

**Integration strategy: build a WordPress plugin, not six CMS integrations.**

Tornado is WordPress + Yoast, and so is most of home services. "Connect CMS and hosting" is otherwise Wix, Squarespace, Duda and custom builds, plus five hosting panels, and it is where this project could disappear for six months. A single LVL3 plugin gives authenticated write access without anyone handing over hosting credentials, a client-side change log and rollback, and a five-minute install at onboarding. It's also a moat Omega doesn't have, because they're paid-media-first and this is unglamorous vertical plumbing. Everything non-WordPress stays handoff with a paste-ready spec.

**Task-type tiers. Start smaller than feels satisfying.**

| Tier | Task types | Policy |
|---|---|---|
| **1 — agent-executable** | Title tags, meta descriptions, H1s, alt text, schema injection, redirects | Deterministic, reversible, no judgment. Requires change log + rollback |
| **2 — later, with per-change review** | Internal links, edits to existing content | Human reviews each change before it goes live |
| **3 — never automated (D4)** | Publishing new content at scale, link acquisition | Human-led. Non-negotiable per Haynes |

Worth noting: the top two priorities from the Tornado audit were the H1 template fix and the consolidation redirects. **Both are tier 1.** The narrowest possible version of agent execution would have handled the two highest-impact items on the actual pilot.

---

## 13. Conversational onboarding

Currently a form that captures access. The owner wants a discussion that also captures client context. **This is the highest ratio of value to risk on the entire roadmap** and the right thing to build first: no write access, no client site, immediate improvement to every downstream output, and it lands at the moment a newly signed client is most anxious about whether they chose correctly.

What a form captures: credentials. What the pipeline actually needs and currently guesses at:

- What services actually make money, versus what's on the site.
- Real service radius and where technicians actually go. (Would have caught Tornado's Orange County problem on day one.)
- **Average job value by service.** This is the missing number that turns every traffic forecast into a revenue model. Currently unavailable.
- Seasonality and pre-season content timing.
- What happens to a lead after the phone rings; who answers.
- What a prior vendor built and whether the client is attached to it. (Would have surfaced Tornado's 130 AI pages immediately.)
- Brand constraints and language the client won't use.
- Who has authority to approve changes, and what needs sign-off.
- CMS and hosting reality, plus plugin install.
- Confirmation of the GBP service-area list, which the audit needs and cannot fully read.

Output becomes structured client context (extending `brand_context`) that grounds every LLM call downstream. This is the "persistent context" competitors market as a headline feature, and it's cheap: a structured conversation that writes to the database.

**Open design question:** admin-facing (the strategist runs the conversation, the portal captures it) or client-facing (the client completes it themselves). This changes the design materially and has not been decided.

---

## 14. Recommended build order

> **Superseded by [AUTOMATION-PLAN.md](AUTOMATION-PLAN.md).** That file is the working
> plan — its seven slices are what actually gets built, and where the two disagree the
> plan wins. This section is retained as the historical rationale: it records why the
> ordering was risk-first rather than the order the owner listed, and the plan's
> "Deliberately not building" section argues against several of the phases below by
> number. Do not treat the table as a queue.

Not the order the owner listed. Ordered by risk and by what unblocks what.

| # | Phase | Rationale |
|---|---|---|
| **1** | **Conversational onboarding + client context model** | Zero risk, improves everything downstream, best value-to-risk ratio, differentiated client experience at the highest-anxiety moment |
| **2** | **Make the tools callable.** Extract the hub tools (especially Vertical Benchmark) out of UI routes into headless lib functions with model-legible outputs | The true blocker. Nothing can be orchestrated until this is done. Boris's point: the interface quality is where agentic systems live or die |
| **3** | **Data model + Sitebulb ingester** | The plan object and the recommendation lifecycle. Ingester rule: `summary.xlsx` is the backbone because hint CSVs only exist for triggered hints; reading only the hints folder makes `pass` indistinguishable from `not_run` |
| **4** | **Station framework + derived analyses** | Partial-success handling and the analyses that produced the real Tornado insights |
| **5** | **Findings, scoring, synthesis, review** | The draft-gated plan. One LLM call |
| **6** | **Eval harness** — arguably belongs before step 5 | Boris's argument is that the eval *is* the spec. If synthesis output looks convincing and nothing scores it, there's no way to know when a later prompt change makes it worse |
| **7** | **Tracker surface** | Mostly surfacing the recommendation lifecycle that already exists by then |
| **8** | **WordPress plugin + tier-1 task execution** | Highest risk. Requires rollback, change log, blast-radius limits and a kill switch before the first write |
| **9** | **Scheduling, fleet-wide runs, broader CMS coverage** | Only after the pipeline is trustworthy on one client |

**Do not build more than one phase per session.** Gates after each slice: `npx tsc --noEmit`, then `npm test`, then `npm run build`. Commit and push each completed slice. Do not deploy unless told. End each phase with a fresh verification agent that did no implementation.

---

## 15. Repo conventions

Read `CLAUDE.md` and `.claude/CLAUDE-db-schema.md` first. Summarised:

- `'use server'` only in `app/actions/*.ts`. Never in `lib/`.
- `createServiceClient()` for admin ops, `createClient()` for user-scoped ops. No ORM; raw Supabase calls.
- `requireAdmin()` / `requireAuth()` from `lib/auth`. `resolveSelectedClientId(user)` from `lib/client-resolution`.
- Migrations explicit and idempotent (`if not exists`). In cloud sessions use `apply_migration` against project `zoeaifsxnaenlcdkavzf`, migration name = repo filename stem. Migration first, code second.
- `Array.from(map.entries())`, not `for...of` over a Map (TS target constraint).
- `params` / `searchParams` are Promises. Await them.
- GA4 `transactions`-backed numbers are labeled "Purchases"; "Conversions" is reserved for keyEvents-backed numbers.
- Service account = Sheets only. OAuth = GA4 + GSC.
- No new npm packages without asking. No migrations without showing the SQL first.
- RLS on every new table. Admin-only write; clients read only their own published records via the `user_client_access` pattern.
- Design system in `design-system/DESIGN.md`. LVL3 brand is the zinc + violet dark theme.

---

## 16. Immediate blockers and open questions

**Blockers, all owner-side:**
1. Tornado HVAC needs `client_type` set to `local_service`; it is currently null, so the local modules stay dark.
2. Tapps Electric is still linked to the personal GBP container, which risks cross-client data mixing. Confirmed live: `get_search_appearances` with no location filter returned **50 locations aggregated across every client** with no identifiers in the output. A required location scope is needed before that tool goes anywhere near automated reporting.
3. The stored `gbp_account_id` values for Tornado and Tapps differ while Business Profile Manager shows both as "Ungrouped" in one container. At least one is likely wrong.
4. PageSpeed API quota increase, before any fleet-wide run.
5. Re-run the Sitebulb audit with structured-data checks enabled and sitemaps/GA/GSC wired as URL sources, so `TECH-013` and orphan detection are actually covered.
6. Golden set: 3-5 past audits plus the plans that shipped, marked for what was implemented and what moved results. This is the long pole and it is entirely manual.
7. Effort rubric: one page mapping task type to effort tier. Only the owner has these numbers.

**Undecided:**
- Onboarding conversation: admin-facing or client-facing.
- Which tier-1 task types may execute without per-change approval versus with it.
- Whether the client-facing Google Sheet tracker is rendered from the portal DB or retired.
- Naming for the diagnostic component (do not use "Detect").

**Required Sitebulb audit template** (a misconfigured crawl silently produces passes): Chrome Crawler ON, `Check Similar` ON (off by default), URL sources including sitemaps + GA + GSC, structured-data checks ON, Pro or Cloud tier (Lite lacks structured data, CWV, hreflang, mobile-friendly and scheduling).

---

## 17. Failure modes to design against

Collected from what actually went wrong during this work.

1. **The silently-incomplete audit.** A missing data source producing a `pass`. The single most important thing to prevent, and invisible once baked in.
2. **Inferring capability from code.** Twice, reading source overstated what a tool returns. Build coverage claims from observed output.
3. **Trusting summaries over queries.** A metadata estimate reported an empty table that had four rows.
4. **Faulting correct configuration.** The GBP audit reported a missing address for a service-area business. An automated audit that penalizes correct setup destroys trust in every other finding.
5. **Inheriting a vendor's severity model.** Sitebulb rates the JS-visibility findings and the missing-H1 finding low. Store their severity, rank by the rubric's.
6. **Cross-client data contamination.** Demonstrated live with the GBP aggregate call. Require explicit client and location scope on every data call.
7. **Letting the LLM creep.** There is exactly one LLM call in this design. Every phase will present a convenient reason to let the model compute a score, pick a severity or estimate effort. Impact comes from data; effort comes from a table.
8. **Scope inflation.** A thin orchestrator was once specced into nine tables, seven phases and a nav redesign within a single session, immediately after reviewing a competitor. Fried and Boris were right; the pull toward the bigger version is constant.
9. **Automating a process that should be deleted.** The Tornado data shows 130 pages producing 42 clicks. A pipeline pointed at "produce more service pages" would have industrialized a failure. Delete before automating.
