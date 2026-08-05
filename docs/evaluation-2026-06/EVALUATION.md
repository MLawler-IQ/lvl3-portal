# LVL3 Portal — Codebase Evaluation & Improvement Roadmap

**Date:** 2026-06-10 · **Commit:** `34c6935` · **Repo:** github.com/MLawler-IQ/lvl3-portal
**Scope:** ~30k LOC TS/TSX · Next.js 14 App Router · Supabase (Postgres + RLS + Storage) · 19-tool SEO suite · Ask LVL3 (Claude) · SEO Content Engine

---

## How to read this

This is a **prioritized improvement roadmap**, not a "rewrite it" pitch. The portal is a genuinely capable, well-organized product that's already in production. The findings below are about hardening, efficiency, and reducing future maintenance drag — sequenced so you can hand each section straight back to Claude Code as a work prompt.

**Methodology.** Six specialist audits ran in parallel (security, performance, cleanliness, data/schema, UX/a11y, DX/tooling), then **every HIGH/CRITICAL finding was handed to an independent adversarial verifier** that read the actual code and tried to refute it. That step mattered — it overturned a lot of scary-sounding-but-wrong claims. Severities below are **post-verification**, and where verification changed the picture I say so. I also independently spot-checked 10+ findings against the source myself.

**Three claims from the first pass that verification killed or corrected:**
- ❌ *".env.local is committed"* — **false.** It's gitignored and absent from history.
- ❌ *"~24 tool files still use leftover violet hex"* — **false.** The brand tokens were remapped to red, so the sweep is effectively done. Only **2** literal purple references remain (`StatusBadge.tsx:43`, `insights/page.tsx:25`).
- ❌ *"openai is imported but unused"* — **false.** It powers the blog image generator (`app/api/generate-blog-images/route.ts`).

---

## Scorecard (verified)

| Dimension | Score | One-line verdict |
|---|---|---|
| **Security & AuthZ** | 5.5/10 | Auth coverage is solid; the real gaps are member-scope enforcement on service-client paths and a confirmed `tool_runs` RLS leak. |
| **Performance & Efficiency** | 5/10 | Good `Promise.all` discipline, but **zero caching on third-party API calls** is the headline cost/latency issue. |
| **Code Cleanliness** | 6/10 | Solid structure; a few god-files and duplicated route boilerplate are the main tech debt. |
| **Data Layer & Schema** | 6/10 | Sound design and RLS; missing indexes + no retention policy will bite at 107-brand scale. |
| **UX States & A11y** | 5/10 | Real gaps in error/loading states, app-wide feedback, and form a11y — none catastrophic. |
| **DX, Testing & Tooling** | 4.5/10 | No tests and no CI gate are the weak spots; build + Vercel previews partially compensate. |

> Scores reflect *headroom*, not failure. A 5–6 here is "good product carrying normal startup debt," not "broken."

---

## The roadmap

Effort key: **S** < 2h · **M** < 1 day · **L** < 3 days · **XL** > 3 days

### P0 — Do first (security correctness, confirmed)

These are real cross-tenant / cost-exposure paths. All independently verified against the code.

1. **`tool_runs` RLS lets a member read another client's tool results.** *(verified HIGH, S)*
   The policy is `user_id = auth.uid() OR (client_id matches users.client_id)`. Members have `client_id = NULL` (they're scoped via `user_client_access`), so the second clause never fires — but the first clause means **any run a member triggered is readable by them regardless of which client it belongs to**, and the tool API routes don't check the member is assigned to the `clientId` they pass. Result: a member can run a tool against a client they're not assigned to, then read the competitive analysis back.
   *Evidence:* `supabase/migrations/20260416000001_tool_runs.sql:42-52`; tool routes e.g. `app/api/tools/content-refresh-finder/route.ts`.
   *Fix:* add a `user_client_access` membership check in the tool API routes before creating a run, and tighten the RLS read policy to require client assignment (not just `user_id` match).

2. **Two exported server actions run with no auth guard on the RLS-bypassing service client.** *(verified HIGH, S)*
   - `getSheetData(sheetId)` — `app/actions/projects.ts:18` — no `requireAuth`, fetches **any** Google Sheet the service account can read by passing an arbitrary id.
   - `generateClientSummary(clientId)` — `app/actions/summaries.ts:14` — no guard, accepts any `clientId`, triggers a **paid Anthropic call**, and writes `ai_summary` back to that client. The admin gate exists only in the `syncSheet` *wrapper* (`projects.ts:56`), not in the action itself — and Next.js server actions are independently invocable endpoints.
   *Fix:* add `await requireAuth()` (+ client-scope check) at the top of both actions. ~10 lines each.

3. **Member-scope enforcement on service-client API routes (IDOR).** *(verified MEDIUM, M)*
   Several tool/AI routes authenticate *role* (`admin`/`member`) then fetch by untrusted `clientId` via `createServiceClient()` with no ownership check. For **admins** this is by-design; for **members** it bypasses their `user_client_access` assignment. Apply one shared guard: `if (role === 'member' && !memberHasAccess(user.id, clientId)) return 403`.
   *Evidence:* `ask-lvl3/route.ts`, `seo-content-engine/route.ts`, `tfk-generator/route.ts`, `content-refresh-finder`, `vertical-benchmark`, `landing-page-cro-audit`, `gbp-audit`.

4. **SSRF guard on URL-fetching tools.** *(verified MEDIUM, S)*
   `lib/connectors/crawler.ts` and PageSpeed/CRO/page-audit routes fetch user-supplied URLs with no host validation — internal IPs and cloud metadata endpoints (`169.254.169.254`) are reachable. Add a URL allowlist: require `https:`, block private/reserved ranges before fetch.

### P1 — High leverage (cost, resilience, scale)

5. **Cache third-party API responses.** *(verified HIGH, M)* — *biggest single win.*
   GA4, GSC, Semrush, PageSpeed, and Keywords Everywhere calls have **zero** caching (`lib/google-analytics.ts`, `lib/tools-gsc.ts`, `lib/connectors/*`). Every dashboard load / refresh re-hits the APIs, burning quota and adding 2–5s latency. Wrap read functions in `React.cache()` for request-dedup, and add a TTL'd DB cache table (`cache_ga4`, `cache_gsc`) for the 24h-stale-anyway analytics data. Est. ~80% reduction in API calls.

6. **Cost controls + rate limiting on AI/expensive tools.** *(HIGH, M)*
   No per-user/per-client throttle or budget on Anthropic / OpenAI / Semrush. One mis-scoped SEO Content Engine batch can run a large, untracked bill. Add per-run token-budget + a `tool_runs`-backed rate limit (e.g. N runs/hour/user → 429), and log cost-per-run.

7. **Production observability.** *(HIGH, M)*
   Errors today go to `console.error` (lost on container restart) and the DB for pipeline failures, but there's **no aggregation or alerting** — you learn about prod breakage from user complaints. Add a thin `lib/logging.ts` wrapper over the 12 `console.error` sites + Sentry (free tier). Add release tracking so errors map to deploys.

8. **Add the missing scale indexes.** *(verified MEDIUM → cheap & high-value at 107 brands, S)*
   `client_id` / `created_at` composite indexes are missing on `deliverables`, `comments`, `ask_lvl3_conversations`, `ask_lvl3_messages`, plus `comments(parent_id)` for thread traversal. (`tool_runs` and `semrush_reports` already have them — verification confirmed.) One migration, big future payoff.

9. **Database backups + retention for unbounded tables.** *(HIGH, M)*
   Enable Supabase scheduled backups (prod is currently unprotected against corruption/delete). Add a 90-day retention job for `tool_runs` and the `seo_content_engine_*` JSONB-blob tables, which otherwise grow unbounded.

10. **Error & not-found boundaries.** *(verified MEDIUM, S)*
    No `app/error.tsx`, `global-error.tsx`, or `not-found.tsx`. (Next ships defaults so it's not a white-screen — verification corrected the "CRITICAL" framing — but you get an unbranded generic page with no recovery path.) Add three branded boundaries.

11. **OAuth token hardening.** *(verified MEDIUM, M)*
    `admin_google_token` / `admin_gbp_token` have no RLS and are plaintext. Access is gated by `requireAdmin()` + service client today (so not an open door — verification downgraded from CRITICAL), but add RLS as defense-in-depth, encrypt at rest (Supabase Vault), and add a refresh-failure alert so a revoked token doesn't fail silently.

### P2 — UX polish & maintainability

12. **App-wide toast/feedback system.** *(verified MEDIUM, M)* — a Toast component already exists in `comment-thread.tsx`; promote it to a `ToastProvider` in `LayoutShell` and use it for form saves, uploads, and analytics refreshes (which currently give no success confirmation, just `router.refresh()`).
13. **Loading states across routes.** *(verified MEDIUM, M)* — only `tools/loading.tsx` exists. Add `loading.tsx` (+ Suspense around the slow GA4/GSC fetch) to dashboard, deliverables, insights, projects.
14. **Accessibility pass.** *(verified MEDIUM, M)* — add `aria-invalid`/`aria-describedby` + `role="alert"` error associations, a label/`aria-label` on the login email input (confirmed missing live), a skip-to-content link, focus traps on modals (CommandPalette already does this — copy the pattern to `new-client-modal`), and `aria-label` on the mobile drawer.
    - **Elevated to P1-worthy by the live review:** the brand red `#EF4444` on the cream canvas is **3.64:1 — fails WCAG AA** for body-size text wherever it's used as a link/active-nav color. Switch text/link red to `brand-600` `#DC2626` (~5.2:1); keep `#EF4444` for large text and non-text accents. Small change, app-wide reach, client-facing compliance.
15. **Generate Supabase types.** *(verified MEDIUM, S)* — `npx supabase gen types typescript > lib/supabase/database.types.ts`, replace hand-rolled row types. Catches schema drift at compile time.
16. **Extract shared API route guard/error helper.** *(verified MEDIUM, S)* — `lib/api/route-guard.ts` to collapse the ~20-line auth+try/catch block duplicated across 8 routes.
17. **God-file refactors.** *(verified MEDIUM/LOW, M each)* — pull a `usePipelineStream` hook out of `SeoContentEngineClient` (838L), `useSemrushSort` + `csv-export` out of `SemrushGapClient` (993L), and a `lib/ask-lvl3/tools/` registry out of the 973L Ask LVL3 route. Real readability/testability wins; none are bugs.
18. **Input validation at the HTTP boundary.** *(verified MEDIUM, M)* — add Zod schemas to `seo-content-engine`, `ask-lvl3`, `generate-blog-images` request parsing so malformed topics fail fast with a 400 instead of mid-pipeline.
19. **Smaller a11y/UX nits.** *(S each)* — bump touch targets to 44px on refresh buttons, add scroll-shadow affordance on overflowing tables, descriptive `alt` text, and replace the 2 leftover purple references with brand tokens.

### P3 — Foundations & strategic

20. **Testing (start small, high-value).** *(L)* — vitest for `lib/auth.ts` + `lib/client-resolution.ts` + content-engine validators; Playwright smoke tests for login → client-select → run-a-tool. Prioritize auth guards and the member-scope checks from P0.
21. **CI gate.** *(S)* — `.github/workflows/validate.yml`: `tsc --noEmit` + `next lint` + `next build` on PR, with branch protection. Cheapest insurance against the Next-upgrade breakage in #23.
22. **ESLint architecture rules.** *(S)* — `import/no-restricted-paths` to stop `createServiceClient` ever being imported into a client component; flag `any`.
23. **Dependency upgrade path.** *(verified MEDIUM, M)* — staged: Anthropic SDK 0.77→latest, then Supabase JS/SSR, then TypeScript, then **pause at Next 14→15** for a code-review of the async request-context changes (touches `params`/`searchParams` and the `unstable_cache` note in CLAUDE.md), then React 19. The reported npm vulns are in dev-only transitive deps, so this is maintenance, not an emergency.
24. **Public-route correctness.** *(S)* — `robots.txt` disallowing `/admin` `/api`, OpenGraph/Twitter metadata in root layout, security headers in the empty `next.config.mjs`.
25. **Schema tidy (optional).** *(L)* — the `clients` table has grown to ~20 columns; splitting analytics-config and insights into satellite tables keeps the hot auth-path row lean. Defer unless it bites.

---

## What's genuinely good (keep it)

- **Auth architecture.** Three-role model, `requireAuth`/`requireAdmin` helpers, the `get_my_role()` SECURITY DEFINER function that fixes RLS recursion, and clean `createClient` vs `createServiceClient` separation. The gaps above are scope-enforcement details, not a broken foundation.
- **Streaming pipelines.** The NDJSON event model for long-running tools (SEO Content Engine, CRO audit) with a typed `PipelineEvent` discriminated union is a strong pattern — verification specifically praised its clarity.
- **Design-system discipline.** CSS-variable theming meant the entire dark→light IgniteIQ v4.2 rebrand happened by remapping tokens, leaving almost no leftovers. That's the system working as intended.
- **Feature completeness.** 12 stable tools + Ask LVL3 + the full client/deliverables/insights surface is a lot of working product. Coming-soon tools are correctly disabled (not broken links — verified).
- **Type discipline.** Strict TS, only 9 `any` usages (localized to the Google API connector), zero `@ts-ignore` outside one spot.

## Suggested sequencing

1. **Week 1 — P0 security.** Items 1–4 are all S/M and self-contained. Ship behind the existing auth.
2. **Week 2 — P1 cost + resilience.** Caching (#5) and cost controls (#6) pay for themselves immediately; observability (#7), indexes (#8), backups (#9) de-risk the 107-brand scale.
3. **Ongoing — P2 as you touch each surface.** Fold the toast/loading/a11y/refactor items in when you're already in that file, rather than as a big-bang pass.
4. **Before the next Next.js upgrade — P3 #21 CI + #20 auth tests.** So the framework jump has a safety net.

## Live-app review (completed)

A logged-in click-through of `lvl3-portal.vercel.app` was run across all seven authenticated routes (home → dashboard → insights → tools → ask-lvl3 → deliverables → admin) as an admin, instrumenting the real page with a persistent console/error capture and the Performance API.

**Headline positive — the app is runtime-clean.** **Zero console errors and zero warnings** across every route. No horizontal overflow at desktop width, mobile nav drawer present in the DOM, the deliverables view-toggle exposes `aria-pressed`, and coming-soon tools are correctly non-navigable (`href="#"`). TTFB ~400ms, login loads in ~1.1s.

**New finding the static audit only guessed at — brand red fails WCAG AA for text.**
The active-nav / link red `#EF4444` (`rgb(239,68,68)`) at 14px on the cream canvas `#FCFBF9` measures **3.64:1 contrast — below the 4.5:1 AA floor for normal-size text.** This affects every red link, active nav item, and body-size accent across the app. (The static audit worried about `surface-500`; the live measurement shows muted body text is actually **6.56:1 — passing** — so the real issue is the brand accent, not the grays.)
*Fix:* use `brand-600` `#DC2626` (~5.2:1) for text/links and reserve `#EF4444` for large text or non-text accents (icons, bars, borders). This is a **P1/a11y** item for a client-facing product — small change, broad reach.

**Confirmed live (matches code findings):**
- **Analytics route transitions take 2–3s** with no loading skeleton — dashboard RSC fetch **2928ms**, home **2733ms**. This is the uncached-GA4/GSC finding (#5) and the missing-loading-states finding (#10 / #13) showing up together as real felt latency. Highest-impact perceived-performance issue.
- **Sub-44px touch targets** — "Refresh summary" button is 30px tall; the three "?" info icons are 16px.
- **Missing image alt text** — 1 of 2 images on the home hero lacks `alt`.
- **Login email input has no associated label** (no `<label for>`, no `aria-label`) and there's no skip-to-content link — confirms the form-a11y finding on the public entry page.

**Mobile pass (completed at 390px / retina via device emulation):** responsive layout is genuinely solid. **No horizontal overflow on any route tested** (admin, home, deliverables, tools), the sidebar correctly collapses to a working hamburger drawer with a backdrop, tool cards stack to single-column (342px), and the analytics/KPI sections stack cleanly. The mobile-specific gaps are polish, not breakage:
- **Drawer a11y:** the mobile nav drawer has **no `role="dialog"` / `aria-modal="true"`** and **does not scroll-lock the background** while open (focus + scroll bleed). Confirms the code-level drawer finding.
- **Touch targets:** at phone width, ~12 of 16 visible tap targets are under 40px tall — the sub-44px issue matters more here than on desktop.
- **Micro-text:** ~21 visible text elements render below ~11.5px (eyebrow labels, badges, meta) — borderline for small-screen readability.

There are no remaining gaps in the review — desktop and mobile are both covered.

---
*Generated by a 29-agent audit workflow with adversarial verification. Raw structured findings (every finding + its verifier verdict) are preserved in the task output; nothing was discarded.*
