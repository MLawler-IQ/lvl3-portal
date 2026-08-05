# LVL3 Portal — Roadmap Implementation Plan

## Context

The combined evaluation ([docs/evaluation-2026-06/COMBINED-EVALUATION.md](../../lvl3-portal/docs/evaluation-2026-06/COMBINED-EVALUATION.md)) produced a 30-item P0→P3 roadmap to harden and finish the portal. This plan turns that roadmap into executable, sequenced work. The portal is in production and runtime-clean, so every phase is **independently shippable** and verified with `tsc --noEmit` + `next build` (the project's existing gate — no test framework yet, added in Phase 4). Work is grouped into phases that map to the roadmap priorities; each phase ≈ one PR-sized unit.

**Repo conventions to honor throughout** (from CLAUDE.md): `'use server'` only in `app/actions/*`; `createServiceClient()` only behind a role/ownership check; run `npx tsc --noEmit` after every change set; `Array.from(map.entries())` not `for...of`; always `await` `params`/`searchParams`; never wrap `getAdminOAuthClient()` in `unstable_cache`; deploy = `vercel --prod` then `git push`.

## Prerequisites (you do these — I can't, or shouldn't, autonomously)

- **Approve new dependencies** (Phase-tagged): `zod` (P1/P2 validation), `@sentry/nextjs` (P1 observability), `vitest` + `@testing-library/react` + `@playwright/test` (P4 tests). CLAUDE.md forbids adding packages without explicit OK — approving this plan = approving these.
- **Supabase backups** (P1 #13): enable scheduled backups in the Supabase dashboard (a toggle, not code).
- **Sentry DSN** (P1 #11): create a project, give me `SENTRY_DSN` to add to env.
- **Supabase CLI** (P2 #23): `supabase gen types` needs the CLI logged in; either you run it or confirm I can.
- **Migration + deploy execution**: I'll author migration files; applying them (`supabase db push`) and `vercel --prod` stay gated on your go-ahead per existing flow.

## Approach

**Execution cadence (confirmed):** full scope with the Next 15/React 19 upgrade as the very last step (CI + tests land before it so it's regression-guarded). **Three phases — Phase 1 combines P0 + P1** (security/correctness *and* cost/resilience ship together), Phase 2 = P2, Phase 3 = P3. Phase-by-phase — I complete a phase, run `tsc --noEmit` + `build`, hand you a summary + verification checklist, and wait for your go-ahead before the next phase. Migrations (`supabase db push`) and deploys (`vercel --prod` + `git push`) stay gated on you. (Sub-item prefixes below map to roadmap tiers: `1x`=P0, `2x`=P1, `3x`=P2, `4x`=P3.)

Reuse-first. The exploration confirmed strong existing seams to build on — `requireAuth()`/`requireAdmin()` ([lib/auth.ts](../../lvl3-portal/lib/auth.ts)), `getClientById()`/`getClientListForUser()` ([lib/client-resolution.ts](../../lvl3-portal/lib/client-resolution.ts)), `normalizeDomain()` ([lib/normalize-domain.ts](../../lvl3-portal/lib/normalize-domain.ts)), the `React.cache()` pattern in [lib/queries.ts](../../lvl3-portal/lib/queries.ts), the tool primitives in `components/tools/primitives/`, `RunHistory.tsx`, and `validators.ts`. New abstractions are added only where duplication is real.

---

## Phase 1 — P0 security/correctness + P1 cost, resilience, scale (ship together)

### Part A — P0 security & correctness (small, do first within the phase)

**1a. Member-scope guard (roadmap #1).** Add `memberHasClientAccess(userId, clientId): Promise<boolean>` to [lib/auth.ts](../../lvl3-portal/lib/auth.ts) (queries `user_client_access`; admins always true; client-role checks `client_id` match). Add a route helper `requireClientAccess(user, clientId)` that 403s. Insert the check in the 5 client-scoped API routes right after each parses `clientId`: `app/api/ask-lvl3/route.ts:680`, `app/api/seo-content-engine/route.ts:48`, `app/api/tools/content-refresh-finder/route.ts:51`, `app/api/tools/vertical-benchmark/route.ts:120`, `app/api/tools/gbp-audit/route.ts:34`.

**1b. tool_runs RLS fix (roadmap #1).** New migration `supabase/migrations/20260611000000_fix_tool_runs_rls.sql`: replace the member SELECT policy (currently [20260416000001_tool_runs.sql:42-52](../../lvl3-portal/supabase/migrations/20260416000001_tool_runs.sql)) so members see runs only for clients in `user_client_access` (the current policy both leaks across clients via `user_id` and wrongly excludes member-accessible clients since members have `users.client_id = null`).

**1c. Guard the two open server actions (roadmap #2).** Add `await requireAuth()` + `requireClientAccess` to `getSheetData()` ([projects.ts:18](../../lvl3-portal/app/actions/projects.ts)) and `generateClientSummary()` ([summaries.ts:14](../../lvl3-portal/app/actions/summaries.ts)).

**1d. SSRF guard (roadmap #3).** Add `assertPublicHttpUrl(url)` to a new `lib/url-guard.ts` (require `https:`, block private/reserved/metadata IP ranges). Call it in [lib/connectors/crawler.ts](../../lvl3-portal/lib/connectors/crawler.ts) `fetchAndParse` and the PSI/CRO/page-audit entry points before any fetch.

**1e. Confirmed tool bugs (roadmap #4–7), all small:**
- CWV false-pass: require `=== 'FAST'` for all three metrics in [pagespeed.ts:70-73](../../lvl3-portal/lib/connectors/pagespeed.ts).
- AI Visibility: replace `split('.')[0]` + substring match at [tools.ts:117-134](../../lvl3-portal/app/actions/tools.ts) with `normalizeDomain()` + word-boundary brand matching.
- Vertical Benchmark stuck runs: add the missing `tool_runs` `status='failed'` update in the catch at [route.ts:403-406](../../lvl3-portal/app/api/tools/vertical-benchmark/route.ts).
- Blog Image manifest: set `persistsRuns: false` and `dataSources: ['openai']` in [registry.ts:141-144](../../lvl3-portal/lib/tools/registry.ts).

### Part B — P1 cost, resilience, scale

**2a. Cache third-party APIs (roadmap #8) — biggest win.** Wrap `fetchGA4Metrics`/`fetchGA4Report` ([google-analytics.ts](../../lvl3-portal/lib/google-analytics.ts)) and `fetchGSCRows`/`fetchGSCPageRows` ([tools-gsc.ts](../../lvl3-portal/lib/tools-gsc.ts)) in `React.cache()` (per-request dedup, mirror [lib/queries.ts](../../lvl3-portal/lib/queries.ts)). Add a TTL'd DB cache table `api_cache(key, payload jsonb, expires_at)` via migration + `lib/api-cache.ts` get/set helpers for the 24h-stale analytics reads. Do **not** wrap anything touching `getAdminOAuthClient()` in `unstable_cache`.

**2b. Connector error contract (roadmap #9).** Standardize connectors to `{ ok, data, error }` — convert the `catch { return null }` blocks in [semrush-portal.ts:75-77,104-106](../../lvl3-portal/lib/connectors/semrush-portal.ts) and align pagespeed/crawler/keywords-everywhere. Surface `error` in the tool UIs (Backlink, Semrush Gap, Keyword Research) so an API-key failure reads differently from "no data."

**2c. Cost controls + rate limiting (roadmap #10).** Add `lib/rate-limit.ts` backed by `tool_runs` (count recent runs per user/client → 429 over threshold) and log per-run token/cost. Apply in the AI/expensive tool routes.

**2d. Observability (roadmap #11).** New `lib/logging.ts` (`logError(scope, msg, detail)` / `logWarn`) wrapping the ~12 `console.error`/`console.warn` sites (listed in exploration); init `@sentry/nextjs` with `SENTRY_DSN`.

**2e. Indexes (roadmap #12).** Migration adding composite `client_id, created_at desc` indexes to `deliverables`, `comments`, `ask_lvl3_conversations`, `ask_lvl3_messages` + partial index on `comments(parent_id)`.

**2f. Backups + retention (roadmap #13).** You enable backups; I add a retention migration/edge function deleting `tool_runs` + `seo_content_engine_*` rows older than 90 days.

**2g. Error/not-found boundaries (roadmap #14).** Add `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, and `app/(dashboard)/error.tsx`, branded to the design system.

**2h. Brand-red contrast + status tokens (roadmap #15).** In [globals.css](../../lvl3-portal/app/globals.css): switch text/link usages from `--brand-500` to `--brand-600` (#DC2626, ~5.2:1) — `--nav-active`/`--sidebar-active`/`--color-primary`/`.eyebrow` (lines 51,65,73,131) and `components/sidebar.tsx:32`; keep `#EF4444` for large/non-text accents. Add `--color-success/-warning/-error` usage everywhere hardcoded `text-green-400`/`#34D399`/`#FBBF24`/`#F87171` appear (30+ spots across the tool clients listed in exploration) via a small `statusColor()` helper.

**2i. OAuth token hardening (roadmap #16).** Migration enabling RLS on `admin_google_token`/`admin_gbp_token` (deny-all to authenticated; access only via service client behind `requireAdmin`); add refresh-failure logging via `lib/logging.ts`. (Encryption-at-rest noted as a follow-up if Supabase Vault is enabled.)

**Verify (whole phase):** `tsc --noEmit` + `build`. Live app — a member account cannot run/read another client's tool; CWV shows pass only when all metrics fast; analytics route transition drops from ~2–3s to sub-second on a warm cache; force a Semrush key error and confirm the UI says so (not "no data"); trip the rate limit and confirm 429; trigger an error and confirm it lands in Sentry + a branded error page. SQL — confirm the new `tool_runs` RLS policy with a member-role test query.

---

## Phase 2 — P2 UX, tool completeness, maintainability

**3a. Persistence + export primitive (roadmap #17) — biggest tool UX win.** New `components/tools/primitives/ExportTool.tsx` (CSV/XLSX/DOCX download UI, matching the existing primitive style) + a `persistRun()` helper writing `tool_runs`. Adopt across the 8 read-only tools (Quick Wins, AI Visibility, Content Gaps, Keyword Research, Core Web Vitals, Page SEO, Content Quality, Backlink), flipping their `persistsRuns` and wiring `RunHistory.tsx`.

**3b. Loading states (roadmap #18).** Add `loading.tsx` to `/dashboard`, `/deliverables`, `/insights`, `/projects` + Suspense around the analytics fetch; skeletons for the sync server-component tools.

**3c. App-wide toasts (roadmap #19).** Extract the Toast in [comment-thread.tsx:27-56](../../lvl3-portal/components/deliverables/comment-thread.tsx) into `components/ui/ToastProvider.tsx` + `useToast()`; mount in the dashboard layout; use on saves/uploads/refreshes.

**3d. Accessibility (roadmap #20).** `aria-invalid`/`aria-describedby` + `role="alert"` on forms; label the login email input; skip-to-content link in the root layout; modal focus traps (copy CommandPalette's pattern to `new-client-modal`); `aria-modal` + background scroll-lock on the mobile drawer.

**3e. Unify domain handling + per-tool logic fixes (roadmap #21).** Replace the 6+ inline domain duplicates (semrush-gap client+page, ask-lvl3 `deriveClientDomain`, analytics `extractDomain`, vertical-benchmark) with `normalizeDomain()`; make it subdomain-safe (registrable-domain via `URL().hostname`). Fix Content Gap boundary (~pos 10.5 dropped) and Vertical Benchmark `url.includes(domain)` → hostname compare; tighten CRO trust-signal detection.

**3f. God-file refactors (roadmap #22).** Extract `hooks/usePipelineStream.ts` from SeoContentEngineClient (838L, stream consumer lines 120-300); `useSemrushSort` + `lib/csv-builder.ts` from SemrushGapClient (993L); `lib/ask-lvl3/tools/` registry + per-tool handlers from the 973L route (TOOLS array 19-307, executeTool 329-580).

**3g. Types + shared helpers (roadmap #23).** Generate `lib/supabase/database.types.ts` (`supabase gen types`); add `lib/api/route-guard.ts` (collapse the repeated auth+try/catch across the 8 routes); `lib/parse-csv.ts` (dedupe Blog Image client/route, RFC-4180 escaping); a small registry-vs-reality test asserting `dataSources`/`persistsRuns` match the code.

**3h. Zod boundary validation (roadmap #24).** Zod schemas at the `seo-content-engine`, `ask-lvl3`, `generate-blog-images` request boundaries (reuse `validators.ts` logic), returning 400 on bad input.

**3i. Remaining MEDIUM/LOW nits (roadmap #25).** TFK `Buffer`→`atob/btoa`+`Uint8Array` ([TfkGeneratorClient.tsx:73,96-97](../../lvl3-portal/app/(dashboard)/tools/tfk-generator/TfkGeneratorClient.tsx)); backlink error context; 44px touch targets; table scroll affordance; alt text; the 2 leftover purple refs (`StatusBadge.tsx:43`, `insights/page.tsx:25`).

**Verify:** `tsc`/`build`; live app — export a result from a read-only tool and reload its history; toast appears on save; keyboard-tab through a form/modal; Blog Image XLSX path works without Buffer.

---

## Phase 3 — P3 foundations & strategic (larger; upgrade is the last step)

**4a. CI gate (roadmap #27) — do this first in the phase.** `.github/workflows/validate.yml`: `tsc --noEmit` + `next lint` + `next build` on PR; branch protection.

**4b. Tests (roadmap #26).** Vitest + RTL for `lib/auth`, `lib/client-resolution`, `validators`, and the Phase-1 member-scope guard; Playwright smoke (login → client select → run a tool). Wire into CI.

**4c. ESLint architecture rules (roadmap #28).** `import/no-restricted-paths` blocking `lib/supabase/server` (service client) in client components; `@typescript-eslint/no-explicit-any` as warn; clean the ~12 existing `any`/disable sites.

**4d. Public-route correctness + coming-soon tools (roadmap #30).** `robots.txt` (disallow `/admin`,`/api`), OpenGraph metadata in root layout, security + image config in the empty [next.config.mjs](../../lvl3-portal/next.config.mjs); decide build-or-hide for the 3 coming-soon tool stubs.

**4e. Staged dependency upgrades (roadmap #29) — last, own branch, can defer.** Anthropic SDK → Supabase → TypeScript → **pause** at Next 14→15 (async request context touches `params`/`searchParams` + the `unstable_cache` note) → React 19. Build + smoke after each step.

**Verify:** CI blocks a failing PR; `npm run test` + Playwright green; lint flags a service-client import from a component; Lighthouse/OG preview check.

---

## New files this plan creates (summary)

`lib/url-guard.ts`, `lib/api-cache.ts`, `lib/rate-limit.ts`, `lib/logging.ts`, `lib/csv-builder.ts`, `lib/parse-csv.ts`, `lib/api/route-guard.ts`, `lib/ask-lvl3/tools/*`, `lib/supabase/database.types.ts`, `components/tools/primitives/ExportTool.tsx`, `components/ui/ToastProvider.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/(dashboard)/error.tsx`, several `loading.tsx`, `.github/workflows/validate.yml`, `robots.txt`, test files, and ~5 SQL migrations (RLS fix, api_cache, indexes, retention, token RLS).

## Overall verification

After each phase: `npx tsc --noEmit` and `npm run build` must pass (the established gate). Phases 1–2 each get a live-app spot check via the logged-in session (member-scope, cache latency, exports, a11y). Phase 3 adds the automated CI + test safety net so subsequent work — especially the Next.js upgrade — is regression-guarded. Migrations are authored here but applied (`supabase db push`) and deployed (`vercel --prod` + `git push`) only on your go-ahead.
