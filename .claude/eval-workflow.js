export const meta = {
  name: 'lvl3-portal-eval',
  description: 'Six-dimension audit of LVL3 Portal with adversarial verification and completeness critique',
  phases: [
    { title: 'Audit', detail: 'one agent per dimension, structured findings' },
    { title: 'Verify', detail: 'adversarially refute every HIGH/CRITICAL finding against the code' },
    { title: 'Critique', detail: 'completeness critic finds missed areas' },
  ],
}

const REPO = '/Users/matthewlawler/lvl3-portal'

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'summary', 'score', 'findings'],
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: '2-4 sentence overall assessment of this dimension' },
    score: { type: 'number', description: '0-10 health score for this dimension' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'evidence', 'impact', 'recommendation', 'effort'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          evidence: { type: 'string', description: 'Concrete file:line references and short code excerpts proving the finding is real' },
          impact: { type: 'string', description: 'What goes wrong / what it costs' },
          recommendation: { type: 'string', description: 'Specific fix, naming files/utilities to reuse where possible' },
          effort: { type: 'string', enum: ['S', 'M', 'L', 'XL'], description: 'S<2h, M<1d, L<3d, XL>3d' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reasoning', 'correctedSeverity'],
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'PARTIALLY_TRUE', 'REFUTED'], description: 'CONFIRMED = real and as described; PARTIALLY_TRUE = real but overstated/misdiagnosed; REFUTED = false alarm' },
    reasoning: { type: 'string', description: 'What you checked in the actual code and what you found' },
    correctedSeverity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'DROP'], description: 'Corrected severity after verification; DROP if it should be removed' },
  },
}

const DIMENSIONS = [
  {
    key: 'security',
    prompt: `You are a senior application security engineer auditing the Next.js 14 + Supabase app at ${REPO} (read-only). Dimension: SECURITY & AUTHZ.

Investigate thoroughly with real file reads (do not guess):
- Auth coverage on EVERY route in app/api/**/route.ts and every server action in app/actions/*.ts. Read lib/auth.ts (requireAuth/requireAdmin). For each API route, confirm whether it calls an auth guard before doing work. List any route that does NOT.
- Service-role client (createServiceClient in lib/supabase/server.ts) usage: grep all call sites. For each, is RLS being deliberately bypassed with a manual ownership/role check, or is it bypassing RLS with NO equivalent check (privilege escalation risk)? This is the highest-value thing to get right.
- RLS policies: read supabase/migrations/*policies*.sql and any other policy migrations. Are all sensitive tables covered? Any table with RLS disabled or overly-permissive policies?
- Admin OAuth token model: admin_google_token / admin_gbp_token single-row tables. Who can read/write them? Are tokens exposed to client components ever?
- Input validation: do API routes / actions validate untrusted input (clientId, URLs, file uploads, formData) or trust it? SSRF risk in URL-fetching tools (crawler, pagespeed, page-seo-audit)? Look at lib/connectors/crawler.ts.
- Signed URL handling, file upload validation (type/size), any IDOR (can a member/client access another client's data by passing an id?).
- Secret handling: any secret read into a client component or NEXT_PUBLIC_ that shouldn't be? Any secret logged?

Return structured findings. Be specific with file:line evidence. Score 0-10 (10 = excellent).`,
  },
  {
    key: 'performance',
    prompt: `You are a senior performance engineer auditing the Next.js 14 + Supabase app at ${REPO} (read-only). Dimension: PERFORMANCE & EFFICIENCY.

Investigate with real file reads:
- Third-party API caching: GA4 (lib/google-analytics.ts), GSC (lib/tools-gsc.ts), Semrush/KE/PSI (lib/connectors/*). Are responses cached at all (React.cache, unstable_cache, DB cache table, none)? Quantify the cost of repeated uncached calls.
- Query efficiency in app/actions/*.ts and lib/queries.ts: sequential awaits that could be Promise.all, N+1 patterns (per-client loops issuing queries), over-fetching (select * vs needed columns), missing pagination.
- Client bundle weight: which "use client" components import heavy libs (xlsx, docx, cheerio, recharts, anthropic sdk)? Anything heavy that should be server-only or dynamically imported? Count "use client" files.
- Server vs client data fetching: components doing useEffect+fetch that could be server components. router.refresh() full-page reloads where a targeted update would do.
- Suspense/streaming: are slow server components wrapped in Suspense with loading.tsx, or do they block the whole route?
- Images: next/image usage vs raw img, sharp usage, unoptimized images, missing width/height.
- Any obviously O(n^2) or repeated-work patterns in the big client components (SemrushGapClient, SeoContentEngineClient) — re-filtering/re-sorting without useMemo.

Return structured findings with file:line evidence. Score 0-10.`,
  },
  {
    key: 'cleanliness',
    prompt: `You are a staff engineer producing a concrete refactor map for the Next.js 14 app at ${REPO} (read-only). Dimension: CODE CLEANLINESS & REFACTORABILITY.

Investigate with real file reads:
- God-files: app/api/ask-lvl3/route.ts (~973L), app/(dashboard)/tools/semrush-gap/SemrushGapClient.tsx (~993L), app/(dashboard)/tools/seo-content-engine/SeoContentEngineClient.tsx (~838L), app/actions/tools.ts (~587L). For EACH, give a concrete extraction plan: what modules/dirs to split into, what the thin orchestrator keeps. Reference the existing lib/tools/registry.ts and primitives in components/tools/primitives/.
- Duplicated boilerplate: API route error handling (try/catch + Response.json), auth guard repetition, fetch+.catch patterns, repeated Supabase query shapes. Propose the shared helper(s) to extract (name them, e.g. lib/api/handler.ts).
- Ask LVL3: the ~30 inline Anthropic tool definitions + handlers — propose a typed tool-registry extraction (lib/ask-lvl3/tools/).
- Type safety: missing generated Supabase types (recommend supabase gen types path), "any" usage hot spots (lib/connectors/gbp.ts), inline "as unknown as T" casts.
- Dead/duplicate code, commented blocks, the design-system/ dir vs app usage.
- Repo hygiene: untracked local data files in repo root (mantelmount*.csv, pasha-health*.xlsx, *.docx, *.zip) — recommend .gitignore additions / a /local-data dir. NOTE: .env.local is NOT committed (already verified) — do not flag it as committed.

Return structured findings with file:line evidence and concrete extraction targets. Score 0-10.`,
  },
  {
    key: 'data-schema',
    prompt: `You are a database architect auditing the Supabase Postgres schema at ${REPO}/supabase/migrations (read-only). Dimension: DATA LAYER & SCHEMA.

Read EVERY migration file in supabase/migrations/. Investigate:
- Schema design: tables, columns, types. Appropriate use of JSONB (ask_lvl3_messages.artifacts, brand_context)? Any data that should be normalized or is over-normalized?
- Indexes: are foreign keys and common query columns (client_id, deliverable_id, conversation_id, created_at sort columns, slug lookups) indexed? Flag missing indexes that will hurt at scale (107 Apex brands + growth).
- FK constraints & ON DELETE behavior: cascade vs set null vs restrict — any orphan risk or accidental-cascade-delete risk?
- Single-row token tables (admin_google_token id=1, admin_gbp_token): is this a sound pattern or a constraint? Multi-admin implications.
- Comment threading: comments self-ref parent_id — recursion depth, resolved flag, query patterns.
- tool_runs / seo_content_engine_runs / semrush_reports growth: any retention/cleanup? Unbounded growth tables? JSONB result blobs bloating rows?
- handle_new_user trigger correctness. RLS enable flags per table (note for cross-ref with security agent).
- Migration hygiene: are migrations idempotent/ordered, any that look hand-edited/destructive?

Return structured findings with migration-file:line evidence. Score 0-10.`,
  },
  {
    key: 'ux-a11y',
    prompt: `You are a senior frontend/UX engineer auditing the Next.js 14 app at ${REPO} (read-only). Dimension: UX STATES & ACCESSIBILITY (code-level).

Investigate with real file reads:
- Error handling UX: is there a root app/error.tsx or per-segment error.tsx? global-error.tsx? Or do unhandled errors white-screen? List what exists.
- Loading states: loading.tsx coverage per route, Skeleton usage, spinner consistency.
- Feedback: is there ANY toast/notification system, or is all feedback inline/console? Find components/ui for toast. Optimistic updates vs router.refresh() jank.
- Forms: client-side validation approach (none/HTML5/Zod/RHF), error association (aria-invalid, aria-describedby), the ClientSettingsForm (~510L) and login form.
- Accessibility: skip-to-content link, focus trap in modals/command palette/slide-overs, keyboard nav, aria usage, alt text on images, heading order, color-contrast risks per design-system/DESIGN.md tokens (surface-500 on surface-900 etc).
- Mobile: sidebar->drawer, responsive grids, table overflow on small screens, touch target sizes.
- REBRAND LEFTOVERS: the app rebranded to IgniteIQ v4.2 light theme (cream/red) but tool clients reportedly still use old violet hex (#8B5CF6 #A78BFA #7C3AED). Grep app/(dashboard)/tools and components for these hex values and produce an inventory of files needing the sweep. This is a visible consistency issue.

Return structured findings with file:line evidence. Score 0-10.`,
  },
  {
    key: 'dx-tooling',
    prompt: `You are a senior platform/DX engineer auditing the Next.js 14 app at ${REPO} (read-only). Dimension: DEVELOPER EXPERIENCE, TESTING & TOOLING.

Investigate with real file reads:
- Tests: confirm there is NO test framework (check package.json, look for *.test.* / *.spec.* / __tests__). Recommend a pragmatic testing strategy for THIS app: what to test first (auth guards, RLS-bypass call sites, client-resolution, content-engine pipeline state machine, tool input validation), with which tools (vitest + RTL? Playwright e2e for auth/tool flows?). Be specific and proportionate — this is a small team, not enterprise.
- CI/CD: check for .github/workflows. Propose a minimal GitHub Actions pipeline (typecheck + lint + build on PR, optional preview deploy). Reference the CLAUDE.md note that validation today = tsc --noEmit + next build.
- Lint config: read .eslintrc / eslint config. Any architecture-enforcing rules worth adding (no client import of server-only libs, restrict 'any')?
- Env management: is there a .env.example documenting the ~18 required env vars? Recommend creating one (list the vars you can infer from process.env usage across lib/ and app/).
- Dependency currency: read package.json. Next 14.2 vs current (Next 15/16), React 18 vs 19, @anthropic-ai/sdk 0.77 vs current, openai dep that appears imported-but-mostly-unused, supabase versions. Give a safe upgrade path with risk notes (App Router breaking changes in 15, async request APIs).
- Observability: error logging strategy (currently ad-hoc console.error x21) — recommend a lib/logging.ts + optional Sentry. Build/type config (tsconfig strictness, next.config.mjs empty).

Return structured findings with evidence. Score 0-10.`,
  },
]

phase('Audit')
log(`Auditing ${DIMENSIONS.length} dimensions of LVL3 Portal in parallel...`)

// Phase 1 + 2 pipelined: each dimension's HIGH/CRITICAL findings get adversarially verified
// as soon as that dimension's audit completes (no barrier between audit and verify).
const audited = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA, agentType: 'Explore' }),
  async (report, d) => {
    if (!report) return null
    const toVerify = report.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
    if (toVerify.length === 0) return { ...report, key: d.key }
    const verdicts = await parallel(
      toVerify.map((f) => () =>
        agent(
          `You are an adversarial verifier. A security/quality audit of the Next.js+Supabase app at ${REPO} produced this ${f.severity} finding. Your job is to REFUTE it by checking the ACTUAL code. Default to skepticism — many audit findings are overstated or based on misreading. A real cautionary example from this same audit: an agent claimed ".env.local is committed to git" but it is NOT tracked (git ls-files confirms). Do not let plausible-sounding claims through without checking the files.

FINDING TITLE: ${f.title}
CLAIMED EVIDENCE: ${f.evidence}
CLAIMED IMPACT: ${f.impact}

Read the referenced files/lines yourself. Determine: is this CONFIRMED (real and accurately described), PARTIALLY_TRUE (real but overstated or misdiagnosed — explain how), or REFUTED (false alarm — explain why). Set correctedSeverity (or DROP if it should be removed entirely).`,
          { label: `verify:${d.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' }
        ).then((v) => ({ finding: f, verdict: v }))
      )
    )
    return { ...report, key: d.key, verifications: verdicts.filter(Boolean) }
  }
)

const reports = audited.filter(Boolean)

// Phase 3: completeness critic — given everything found, what whole areas were missed?
phase('Critique')
const digest = reports
  .map((r) => `## ${r.dimension} (score ${r.score})\n${r.summary}\nFindings: ${r.findings.map((f) => `[${f.severity}] ${f.title}`).join('; ')}`)
  .join('\n\n')

const critique = await agent(
  `You are a completeness critic reviewing a 6-dimension audit of the Next.js 14 + Supabase app at ${REPO}. Below is a digest of what the audit found. Your job: identify what is MISSING — whole categories, files, or risks the auditors did not cover. Examples to consider: SEO/metadata correctness, observability/monitoring, rate limiting / abuse of expensive AI+API tools, cost controls on Anthropic/Semrush calls, concurrency/race conditions in the streaming pipelines, data privacy/PII in chat artifacts and tool_runs, backup/disaster recovery, multi-tenant data isolation correctness beyond RLS, the OpenAI dep that's imported but unused, deployment/secrets rotation, the 'coming soon' tool stubs, onboarding/docs. Read files to confirm any gap you assert is real (don't invent). Return the genuinely missing items as findings.

AUDIT DIGEST:
${digest}`,
  { label: 'completeness-critic', phase: 'Critique', schema: FINDINGS_SCHEMA, agentType: 'Explore' }
)

return { reports, critique }
