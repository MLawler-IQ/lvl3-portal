Execute Phases 2 and 3 of the LVL3 Portal roadmap implementation, autonomously, in one shot.

## Where things stand
Phase 1 (P0 security + P1 cost/resilience) is DONE, committed (45acce7), deployed to prod,
and verified. You are picking up at Phase 2. The full plan is at:
  /Users/matthewlawler/.claude/plans/streamed-questing-star.md   ← READ THIS FIRST, in full
  (a copy also lives at ~/lvl3-portal/docs/evaluation-2026-06/IMPLEMENTATION-PLAN.md)
Supporting context (the "why" behind each item):
  ~/lvl3-portal/docs/evaluation-2026-06/COMBINED-EVALUATION.md

## Repo + conventions (from CLAUDE.md — honor all of these)
- Repo: ~/lvl3-portal (Next.js 14 App Router, TypeScript, Supabase, Tailwind v3). Branch: main.
- 'use server' only in app/actions/*. createServiceClient() only behind a role/ownership check.
- Always await params/searchParams. Use Array.from(map.entries()), not for...of.
- NEVER wrap getAdminOAuthClient() in unstable_cache (it reads cookies).
- Reuse existing utilities — don't reinvent. Key ones already built in Phase 1:
  lib/auth.ts (requireAuth/requireAdmin/userCanAccessClient), lib/api-cache.ts (cachedFetch),
  lib/logging.ts (logError/logWarn), lib/rate-limit.ts, lib/status-color.ts (statusColor/scoreLevel),
  lib/url-guard.ts, lib/normalize-domain.ts. Tool primitives: components/tools/primitives/
  (BackgroundJobTool, ClientScopedTool, UrlInputTool), components/tools/RunHistory.tsx, ToolLayoutWrapper.tsx.

## Verification gate (node/npm are NOT on PATH — use this exact prefix)
After EVERY phase, both must pass before you move on:
  cd ~/lvl3-portal && PATH=/opt/homebrew/bin:/usr/local/bin:$PATH node ./node_modules/typescript/bin/tsc --noEmit
  cd ~/lvl3-portal && PATH=/opt/homebrew/bin:/usr/local/bin:$PATH npm run build
(Do NOT use `npx tsc`.) If a phase fails the gate and you can't fix it after a reasonable
attempt, STOP and report — do not proceed to the next phase with a broken build.

## Cadence (autonomous — do NOT ask me questions)
- Do Phase 2, verify (tsc + build green), commit it. Then Phase 3, verify, commit.
- One git commit per phase, descriptive message, end with:
    Co-Authored-By: Claude <noreply@anthropic.com>
- Do NOT modify ~/lvl3-portal/docs/** or .claude/** or the stray root data files
  (mantelmount*.csv, pasha-health*.xlsx, *.docx, *.zip) — leave them untracked.

## PHASE 2 — P2 UX, tool completeness, maintainability (plan items 3a–3i)
3a. Persistence + export primitive — NEW components/tools/primitives/ExportTool.tsx (CSV/XLSX/DOCX
    download UI matching existing primitive style) + a persistRun() helper writing the existing
    tool_runs table (NO new migration — table exists). Adopt across the 8 read-only tools
    (keyword-quick-wins, ai-visibility, content-gaps, keyword-research, core-web-vitals,
    page-seo-audit, content-quality, backlink-overview): flip persistsRuns:true in lib/tools/registry.ts
    and wire RunHistory.tsx.
3b. loading.tsx for /dashboard, /deliverables, /insights, /projects + Suspense around the analytics
    fetch; skeletons for the sync server-component tools.
3c. App-wide toasts — extract the Toast in components/deliverables/comment-thread.tsx into
    components/ui/ToastProvider.tsx + useToast(); mount in the dashboard layout; use on saves/uploads/refreshes.
3d. Accessibility — aria-invalid/aria-describedby + role="alert" on forms; label the login email input;
    skip-to-content link in root layout; modal focus traps (copy CommandPalette's pattern to new-client-modal);
    aria-modal + background scroll-lock on the mobile drawer.
3e. Unify domain handling — replace the ~6 inline duplicates (semrush-gap client+page, ask-lvl3
    deriveClientDomain, analytics extractDomain, vertical-benchmark) with normalizeDomain(); make it
    subdomain-safe via URL().hostname. Fix Content Gap position-boundary (~10.1–10.9 dropped → widen to 10.5);
    Vertical Benchmark url.includes(domain) → hostname compare; tighten CRO trust-signal detection.
3f. God-file refactors — extract hooks/usePipelineStream.ts from SeoContentEngineClient (838L);
    useSemrushSort + lib/csv-builder.ts from SemrushGapClient (993L); lib/ask-lvl3/tools/ registry +
    per-tool handlers from the 973L ask-lvl3 route. Behavior-preserving only.
3g. Types + shared helpers — generate lib/supabase/database.types.ts (supabase gen types typescript
    --project-id zoeaifsxnaenlcdkavzf > lib/supabase/database.types.ts; this is read-only against the DB);
    lib/api/route-guard.ts (collapse repeated auth+try/catch across the 8 API routes); lib/parse-csv.ts
    (dedupe Blog Image client/route, RFC-4180 escaping); a test asserting registry dataSources/persistsRuns
    match the code.
3h. Zod boundary validation at seo-content-engine, ask-lvl3, generate-blog-images request parsing
    (reuse lib/seo-content-engine/validators.ts logic), 400 on bad input. Requires the `zod` package —
    install it: PATH=/opt/homebrew/bin:/usr/local/bin:$PATH npm i zod
3i. Remaining nits — TFK Buffer→atob/btoa+Uint8Array (TfkGeneratorClient.tsx:73,96-97); backlink error
    context; 44px touch targets; table scroll affordance; alt text; the 2 leftover purple refs
    (components/ui/StatusBadge.tsx:43, app/(dashboard)/insights/page.tsx:25).
ALSO fold in the two items deferred out of Phase 1:
  - The status-color sweep: replace hardcoded text-green-400/#34D399/#FBBF24/#F87171/#D97706 across the
    tool clients with lib/status-color.ts (statusColor()) — ~30 spots; grep for them.
  - Connector {ok,data,error} contract: standardize lib/connectors/* return shapes and surface errors in
    the Backlink/Semrush-Gap/Keyword-Research UIs (Phase 1 only added logging).

## PHASE 3 — P3 foundations & strategic (plan items 4a–4e)
4a. CI gate FIRST — .github/workflows/validate.yml: tsc --noEmit + next lint + next build on PR.
4b. Tests — install vitest + @testing-library/react + @playwright/test. Vitest+RTL for lib/auth,
    lib/client-resolution, validators, and the Phase-1 member-scope guard (userCanAccessClient).
    Playwright smoke: login → client select → run a tool. Wire into CI.
4c. ESLint rules — import/no-restricted-paths blocking lib/supabase/server (service client) in client
    components; @typescript-eslint/no-explicit-any as warn; clean the ~12 existing any/disable sites.
4d. Public-route correctness — robots.txt (disallow /admin,/api), OpenGraph metadata in root layout,
    security + image config in the empty next.config.mjs. Decide build-or-hide for the 3 coming-soon
    tool stubs (schema-generator, service-page-generator, indexation-monitor) — recommend hiding from the
    grid until built; implement whichever you choose.
4e. Dependency upgrades LAST, on a SEPARATE branch (phase3-deps), NOT on main: Anthropic SDK → Supabase
    JS/SSR → TypeScript, build+smoke after each. Then ATTEMPT Next 14→15 (async request context touches
    params/searchParams + the unstable_cache note) and React 18→19. If the framework jump breaks the build
    and isn't trivially fixable, STOP, keep it on the branch, and report — do NOT merge or deploy a broken
    upgrade. The non-framework bumps can merge to main if green.

## Deploy
After Phase 2 verifies green: commit, then deploy — `vercel --prod --yes` then `git push origin main`
(both needed). Same after Phase 3's main-branch work (everything except 4e if 4e stayed on its branch).
Smoke-test prod after each deploy (curl /login, /dashboard should 307 to login unauthenticated, no 500s).
No new DB migrations are expected in these phases; if you find you need one, author it, apply it via the
Supabase MCP (project id zoeaifsxnaenlcdkavzf), run get_advisors after, and note it.

## Guardrails — do NOT re-introduce these verification-killed false positives
- gpt-image-1 IS a real, current OpenAI model — do NOT change it to dall-e-3.
- surface-900 = #F7F6F4 (light) and surface-100 = #0A0A0A (ink) after the v4.2 token remap — bg-surface-900
  + text-surface-100 is CORRECT light-theme styling, not "inverted." Don't "fix" it.
- .env.local is correctly gitignored — don't touch it.
- Sentry is intentionally deferred (logging works via Vercel logs). Do NOT add @sentry/nextjs.

## When done
Give me one summary: what shipped per phase, what's deployed vs. on a branch, any item you skipped or
couldn't complete and why, and the final tsc/build/test status.
```

---

## Notes on baked-in choices
- **Deploys autonomously** after each phase verifies green (per "without involving me"). To make it
  stop at green builds instead, delete the Deploy section.
- **The Next 15 / React 19 upgrade is fenced to its own `phase3-deps` branch** and told not to
  merge/deploy if broken — so a fresh session can't push a broken framework jump to prod.
- **No new DB migrations expected** in Phases 2–3 (the one DB call is read-only `supabase gen types`).
- **Carries forward the two Phase-1 deferrals**: the status-color sweep and the connector
  {ok,data,error} contract.
