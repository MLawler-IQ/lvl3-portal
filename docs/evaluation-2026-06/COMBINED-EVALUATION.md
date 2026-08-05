# LVL3 Portal — Combined Evaluation & Improvement Roadmap

**Date:** 2026-06-10 · **Commit:** `34c6935` · **Repo:** github.com/MLawler-IQ/lvl3-portal
**Scope:** whole codebase (architecture, security, performance, data, UX, tooling) **+** all 16 SEO tools, evaluated individually.

This is the master document. It consolidates the two prior reports — [EVALUATION.md](EVALUATION.md) (codebase) and [TOOLS-EVALUATION.md](TOOLS-EVALUATION.md) (per-tool) — into one prioritized roadmap, merging the places where a codebase-level finding and a tool-level finding turned out to be the **same issue seen from two angles**.

**Method.** Three layers of agents: a 6-dimension codebase audit + a 16-tool deep evaluation (one agent per tool, 5 dimensions each), then **adversarial verification of every HIGH/blocking claim against the real code**, plus a live click-through of the deployed app (desktop + mobile). Severities below are **post-verification**.

---

## Bottom line

The portal is a **capable, runtime-clean, responsive product carrying normal startup debt** — not a rewrite candidate. Across the whole authenticated app there were **zero console errors**. The 16-tool suite averages ~6.7/10 with no broken tool. The work ahead is **hardening** (member-scope security, caching, observability) and **finishing the toolkit** (persistence/export, a few correctness bugs), done as small, sequenced changes.

| Layer | Verdict |
|---|---|
| **Codebase avg** | 5.3/10 — solid foundation, clear headroom in security-scope, caching, tests/CI |
| **Tools avg** | ~6.7/10 — one Strong, six Solid, the rest Need work / Weak |
| **Live app** | Runtime-clean, responsive, no overflow; gaps are polish + one real contrast bug |

---

## Unified scorecard

**Codebase dimensions (verified):**

| Dimension | Score | One-liner |
|---|:--:|---|
| Security & AuthZ | 5.5 | Auth coverage solid; member-scope on service-client paths is the gap |
| Performance | 5 | Zero caching on third-party APIs is the headline cost/latency issue |
| Code cleanliness | 6 | A few god-files + duplicated boilerplate |
| Data & schema | 6 | Sound RLS; missing indexes + no retention bite at 107-brand scale |
| UX & a11y | 5 | Error/loading states, feedback, form a11y gaps + brand-red contrast |
| DX / testing / tooling | 4.5 | No tests, no CI gate are the weak spots |

**Tool tiers:** **Strong** — SEO Content Engine. **Solid** — Keyword Quick Wins, TFK Generator, Competitor Gap, Content Gap Finder, GBP Audit, Content Refresh Finder. **Needs work** — Core Web Vitals, Backlink Overview, Keyword Research, Page SEO Audit, Blog Image, Content Quality, AI Visibility. **Weak** — Vertical Benchmark, Landing Page CRO Audit. (Full 16×5 heatmap in [TOOLS-EVALUATION.md](TOOLS-EVALUATION.md).)

---

## The merged roadmap

Effort: **S** < 2h · **M** < 1 day · **L** < 3 days. Origin tag: `[Codebase]` · `[Tools]` · `[Both]` (appears in both evals — usually the highest-leverage).

### P0 — Security & correctness (ship first; all small)

1. **Member-scope enforcement on service-client paths.** `[Both]` *(HIGH, M)*
   This is one root vulnerability seen twice: the codebase audit found API routes that authenticate *role* then fetch by untrusted `clientId` via the RLS-bypassing service client; the tool audit found the `tool_runs` RLS read policy keys on `user_id`, so **a member can run any tool against a client they aren't assigned to and read the results back**. Add one shared guard — `if (role === 'member' && !memberHasAccess(user.id, clientId)) → 403` — applied to every multi-client API route, and tighten the `tool_runs` read policy to require client assignment.
   *Evidence:* [tool_runs migration:42-52](supabase/migrations/20260416000001_tool_runs.sql); `ask-lvl3`, `seo-content-engine`, `content-refresh-finder`, `vertical-benchmark`, `landing-page-cro-audit`, `gbp-audit` routes.
2. **Two exported server actions run unguarded on the service client.** `[Codebase]` *(HIGH, S)*
   `getSheetData(sheetId)` ([projects.ts:18](app/actions/projects.ts)) reads any Google Sheet by id; `generateClientSummary(clientId)` ([summaries.ts:14](app/actions/summaries.ts)) fires a paid Claude call + writes `ai_summary` to any client — both with no `requireAuth`. Add the guard (+ client-scope check). ~10 lines each.
3. **SSRF guard on URL-fetching tools.** `[Both]` *(MEDIUM, S)*
   The crawler ([crawler.ts](lib/connectors/crawler.ts)) and the PSI/CRO/page-audit routes fetch user-supplied URLs with no host validation — internal IPs and cloud-metadata endpoints reachable. Require `https:` and block private/reserved ranges before fetch. (The tool audit also wants content-type validation here.)
4. **Core Web Vitals reports a false "pass."** `[Tools]` *(HIGH, S)*
   `cwvPass` counts CrUX `AVERAGE` as passing alongside `FAST` ([pagespeed.ts:70-73](lib/connectors/pagespeed.ts)). `AVERAGE` = needs-improvement, so the tool tells clients a page passes CWV when it doesn't. Require `=== 'FAST'` for all three metrics.
5. **AI Visibility misclassifies branded traffic.** `[Tools]` *(HIGH, S)*
   `clean.split('.')[0]` yields `"shop"` for `shop.brand.com` ([tools.ts:124](app/actions/tools.ts)); plus substring brand-matching (`"shoe"` matches `"shoelace"`). Core metric unreliable for subdomained/short-slug clients. Use the existing `normalizeDomain()` + word-boundary matching.
6. **Vertical Benchmark leaves failed runs stuck `running`.** `[Tools]` *(HIGH, S)*
   The catch block emits an error event but only has a `// Mark run as failed` TODO — no DB update ([route.ts:403-406](app/api/tools/vertical-benchmark/route.ts)). Add the `tool_runs` update to `status='failed'`.
7. **Blog Image registry metadata is wrong.** `[Tools]` *(HIGH, S)*
   `persistsRuns: true` but the route never writes `tool_runs`; `dataSources: ['claude']` but it uses OpenAI ([registry.ts:141-144](lib/tools/registry.ts)). Set `persistsRuns: false` and `dataSources: ['openai']`.

### P1 — High leverage (cost, resilience, scale)

8. **Cache third-party API responses.** `[Both]` *(HIGH, M)* — **biggest single win, reinforced by both evals.**
   GA4/GSC/Semrush/PSI/KE have zero caching ([google-analytics.ts](lib/google-analytics.ts), [tools-gsc.ts](lib/tools-gsc.ts), [connectors/*](lib/connectors)). The live review confirmed the cost: analytics route transitions take **2–3s** (dashboard RSC 2928ms) and the read-only tools render blank during the fetch. Wrap reads in `React.cache()` + a TTL'd DB cache for the 24h-stale analytics data. ~80% fewer API calls + the blank-render UX problem largely disappears.
9. **Stop silent error swallowing — one connector error contract.** `[Both]` *(HIGH/MEDIUM, M)*
   `} catch { return null }` across Semrush/PSI/crawler ([semrush-portal.ts:75-77,104-106](lib/connectors/semrush-portal.ts)) makes an API-key failure look like "no data" in Backlink Overview, Semrush Gap, Keyword Research, and the AI tools. Standardize a `{ ok, data, error }` return + logging. (Pairs with #16.)
10. **Cost controls + rate limiting on AI/expensive tools.** `[Both]` *(HIGH, M)*
    No per-user/client throttle or token budget on Anthropic/OpenAI/Semrush; one mis-scoped batch can run an untracked bill. Add a `tool_runs`-backed rate limit (→ 429) and per-run cost logging.
11. **Production observability.** `[Codebase]` *(HIGH, M)*
    Errors go to `console` only — no aggregation/alerting. Add a thin `lib/logging.ts` over the ~12 `console.error` sites + Sentry (free tier) + release tracking.
12. **Add the missing scale indexes.** `[Codebase]` *(MEDIUM, S)*
    Composite `client_id`/`created_at` indexes on `deliverables`, `comments`, `ask_lvl3_conversations`, `ask_lvl3_messages`, + `comments(parent_id)`. (`tool_runs`/`semrush_reports` already have them.) One migration, big payoff at 107 brands.
13. **DB backups + retention.** `[Codebase]` *(HIGH, M)*
    Enable Supabase scheduled backups; 90-day retention on `tool_runs` and `seo_content_engine_*` JSONB-blob tables.
14. **Error & not-found boundaries.** `[Codebase]` *(MEDIUM, S)*
    No `app/error.tsx` / `global-error.tsx` / `not-found.tsx`. Add three branded boundaries.
15. **Fix the brand-red contrast + tokenize status colors.** `[Both]` *(MEDIUM, S)*
    Live review: link/active red `#EF4444` on the cream canvas is **3.64:1 — fails WCAG AA** for body text. Switch text/link red to `brand-600 #DC2626` (~5.2:1), keep `#EF4444` for large text/non-text accents. Same pass: replace hardcoded `text-green-400`/`#34D399`/`#FBBF24` status colors across CRO, Vertical Benchmark, Content Quality, GBP, CWV badges with `--color-success/-warning/-error` tokens.
16. **OAuth token hardening.** `[Codebase]` *(MEDIUM, M)*
    `admin_google_token`/`admin_gbp_token` have no RLS and are plaintext; add RLS as defense-in-depth, encrypt at rest, alert on refresh failure.

### P2 — UX polish, tool completeness & maintainability

17. **Persistence + export primitive for the 8 read-only tools.** `[Tools]` *(MEDIUM, M)* — highest-value tool UX upgrade.
    Quick Wins, AI Visibility, Content Gaps, Keyword Research, Core Web Vitals, Page SEO, Content Quality, Backlink Overview have no save/export. Build one `ExportTool`/persistence primitive (alongside `BackgroundJobTool`, `ClientScopedTool`, `UrlInputTool`) → turns 8 snapshots into shareable, trackable deliverables.
18. **Loading states across routes & tools.** `[Both]` *(MEDIUM, M)* — pairs with #8. Add `loading.tsx`/Suspense + skeletons to dashboard, deliverables, insights, projects, and the sync server-component tools.
19. **App-wide toast system.** `[Codebase]` *(MEDIUM, M)* — promote the existing `comment-thread` Toast to a provider; confirm saves/uploads/refreshes.
20. **Form accessibility.** `[Codebase]` *(MEDIUM, M)* — `aria-invalid`/`aria-describedby`, login email label (confirmed missing live), skip link, modal focus traps (copy CommandPalette), drawer `aria-modal` + background scroll-lock (confirmed missing on mobile).
21. **Unify domain handling + per-tool logic fixes.** `[Tools]` *(MEDIUM, S–M)* — one strict URL-parsing `normalizeDomain` everywhere; fix Content Gap boundary (~pos 10.5 dropped), Vertical Benchmark substring match, CRO naive trust-signal detection.
22. **God-file refactors.** `[Codebase]` *(MEDIUM, M)* — `usePipelineStream` from SeoContentEngineClient (838L), `useSemrushSort`+CSV from SemrushGapClient (993L), `lib/ask-lvl3/tools/` registry from the 973L route. Readability/testability, not bugs.
23. **Generated Supabase types + shared helpers.** `[Both]` *(MEDIUM, S)* — `supabase gen types`; `lib/api/route-guard.ts` (dedupe 8 routes' auth+try/catch); `lib/parse-csv.ts` (dedupe Blog Image client/route); a registry-vs-reality lint check.
24. **Zod input validation at the HTTP boundary.** `[Both]` *(MEDIUM, M)* — `seo-content-engine`, `ask-lvl3`, `generate-blog-images` fail fast with 400 on malformed input.
25. **Remaining tool MEDIUMs + a11y nits.** `[Both]` *(S each)* — TFK `Buffer`→`atob/btoa`, backlink error context, 44px touch targets, table scroll affordance, alt text, the 2 leftover purple refs.

### P3 — Foundations & strategic

26. **Testing (start small, high-value).** `[Codebase]` *(L)* — vitest for `lib/auth`, `client-resolution`, content-engine validators, and the P0 member-scope checks; Playwright smoke for login → select → run-a-tool.
27. **CI gate.** `[Codebase]` *(S)* — `.github/workflows`: `tsc --noEmit` + lint + build on PR + branch protection. Cheapest insurance before the Next upgrade.
28. **ESLint architecture rules.** `[Codebase]` *(S)* — block `createServiceClient` in client components; flag `any`.
29. **Staged dependency upgrades.** `[Codebase]` *(M)* — Anthropic SDK → Supabase → TS → pause at Next 14→15 (async request ctx) → React 19. Reported vulns are dev-only.
30. **Public-route correctness + coming-soon tools.** `[Both]` *(S)* — `robots.txt` (disallow `/admin` `/api`), OpenGraph metadata, security headers in the empty `next.config.mjs`; and decide whether to build or hide the 3 coming-soon tool stubs (they occupy prime grid slots).

---

## What verification corrected (don't re-introduce these)

The adversarial passes killed five false alarms — worth recording so they don't resurface:

| Claimed | Reality |
|---|---|
| `.env.local` is committed | Gitignored, absent from history. No exposure. |
| ~24 tool files still use leftover violet | Brand tokens were remapped to red; only **2** literal purple refs remain. |
| `openai` is imported but unused | Powers the blog image generator. |
| Blog Image uses an invalid model `gpt-image-1` (was flagged the #1 blocking bug) | `gpt-image-1` is a real, current OpenAI model; the code reads its base64 output correctly. `dall-e-3` would regress it. |
| Core Web Vitals theme is "inverted/half-finished" | `surface-900` = `#F7F6F4` (light), `surface-100` = `#0A0A0A` (ink) after the v4.2 remap — styling is correct. |
| "No error boundaries → white screen" (CRITICAL) | Next ships default error pages; real gap is unbranded/no-recovery → MEDIUM. |
| Heavy libs bloat every tools-tab bundle (HIGH) | Only `jszip` is client-bundled and route-split → LOW. |

**Live-verify before changing:** CWV CLS display (`percentile/100` may be correct if PSI returns it pre-multiplied), and the Blog Image base64 handling (correct for `gpt-image-1`).

---

## What's genuinely good — keep it

- **Auth architecture** — 3-role model, `requireAuth`/`requireAdmin`, the `get_my_role()` SECURITY DEFINER fixing RLS recursion, clean user-vs-service client split.
- **SEO Content Engine** — cross-run caching by topic title + NDJSON streaming + DOCX export; the strongest tool and a model to copy.
- **Design-system discipline** — CSS-variable theming meant the whole dark→light rebrand happened by remapping tokens (the "leftover violet" was a near-non-issue).
- **Runtime quality** — zero console errors across the authenticated app; responsive with no horizontal overflow; coming-soon tools correctly disabled.
- **Type discipline** — strict TS, 9 `any`s (localized), zero `@ts-ignore` outside one spot.

---

## Suggested sequencing

1. **Week 1 — P0 (items 1–7).** All S/M, self-contained, all real after verification. Security-scope + the 4 confirmed tool bugs.
2. **Week 2 — P1 cost/resilience (8–16).** Caching (#8) and the connector error contract (#9) are the leverage points — they fix the live-confirmed 2–3s blank renders *and* the "no data" mystery errors at once. Then observability, indexes, backups, contrast.
3. **Ongoing — P2 as you touch each tool.** Lead with the persistence/export primitive (#17) — it's the biggest felt upgrade for client deliverables.
4. **Before the next Next.js bump — P3 #27 CI + #26 auth tests** so the framework jump has a safety net.

---

## Deliverables in this folder
- **COMBINED-EVALUATION.md** — this master document.
- [combined-dashboard.html](combined-dashboard.html) — unified visual: codebase scorecard + tool heatmap + the merged roadmap.
- [EVALUATION.md](EVALUATION.md) / [dashboard.html](dashboard.html) — the codebase-only report (full detail + live-review findings).
- [TOOLS-EVALUATION.md](TOOLS-EVALUATION.md) / [tools-dashboard.html](tools-dashboard.html) — the per-tool report (full 16×5 detail).

*Nothing was discarded — the standalone reports remain for full per-area detail; this document is the single prioritized view across both.*
