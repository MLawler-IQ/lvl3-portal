export const meta = {
  name: 'lvl3-tools-eval',
  description: 'Per-tool deep evaluation of all 16 LVL3 SEO tools + cross-tool synthesis',
  phases: [
    { title: 'Per-tool', detail: 'one agent per tool: logic, workflow, code, functionality, UI/UX' },
    { title: 'Synthesis', detail: 'cross-tool patterns, inconsistencies, shared-code opportunities' },
  ],
}

const REPO = '/Users/matthewlawler/lvl3-portal'

const TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'name', 'whatItDoes', 'dimensionScores', 'overallScore', 'strengths', 'issues', 'standout'],
  properties: {
    slug: { type: 'string' },
    name: { type: 'string' },
    whatItDoes: { type: 'string', description: '1-2 sentence plain description of what the tool does for the user' },
    dimensionScores: {
      type: 'object',
      additionalProperties: false,
      required: ['logic', 'workflow', 'codeEfficiency', 'functionality', 'uiux'],
      properties: {
        logic: { type: 'number', description: '0-10: correctness of the core algorithm/thresholds/scoring' },
        workflow: { type: 'number', description: '0-10: how smooth the user flow is (input → run → result → export)' },
        codeEfficiency: { type: 'number', description: '0-10: API call efficiency, caching, file size, duplication' },
        functionality: { type: 'number', description: '0-10: completeness, edge-case handling, error states' },
        uiux: { type: 'number', description: '0-10: clarity, states (loading/empty/error), result presentation, brand consistency' },
      },
    },
    overallScore: { type: 'number', description: '0-10 overall' },
    strengths: { type: 'array', items: { type: 'string' }, description: '2-4 genuine strengths' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dimension', 'severity', 'detail', 'evidence', 'fix'],
        properties: {
          dimension: { type: 'string', enum: ['logic', 'workflow', 'codeEfficiency', 'functionality', 'uiux'] },
          severity: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          detail: { type: 'string' },
          evidence: { type: 'string', description: 'file:line + short excerpt proving it' },
          fix: { type: 'string' },
        },
      },
    },
    standout: { type: 'string', description: 'The single most important thing to know about this tool — its best feature or worst flaw' },
  },
}

const TOOLS = [
  { slug: 'keyword-quick-wins', name: 'Keyword Quick Wins', entry: 'app/actions/tools.ts (fetchQuickWins)', lib: 'lib/tools-gsc.ts', kind: 'server-action' },
  { slug: 'ai-visibility', name: 'AI Visibility Check', entry: 'app/actions/tools.ts (checkAIVisibility)', lib: 'lib/tools-gsc.ts, lib/google-analytics.ts', kind: 'server-action' },
  { slug: 'content-gaps', name: 'Content Gap Finder', entry: 'app/actions/tools.ts (fetchContentGaps)', lib: 'lib/tools-gsc.ts', kind: 'server-action' },
  { slug: 'semrush-gap', name: 'Competitor Gap Analysis', entry: 'app/actions/tools.ts (runSemrushAnalysis)', lib: 'lib/connectors/semrush-portal.ts, lib/normalize-domain.ts', kind: 'server-action' },
  { slug: 'backlink-overview', name: 'Backlink Overview', entry: 'app/actions/tools-extended.ts (fetchBacklinkOverview)', lib: 'lib/connectors/semrush-portal.ts', kind: 'server-action' },
  { slug: 'seo-content-engine', name: 'SEO Content Engine', entry: 'app/api/seo-content-engine/route.ts', lib: 'lib/seo-content-engine/* (content-engine.ts, keyword-engine.ts, prompts.ts, validators.ts, docx-writer.ts, data-sources.ts, types.ts)', kind: 'stream-api' },
  { slug: 'tfk-generator', name: 'TFK Location Page Generator', entry: 'app/api/tfk-generator/route.ts', lib: 'lib/connectors/gbp.ts or google-places, anthropic', kind: 'stream-api' },
  { slug: 'blog-image-generator', name: 'Blog Image Generator', entry: 'app/api/generate-blog-images/route.ts', lib: 'openai SDK, sharp', kind: 'stream-api' },
  { slug: 'keyword-research', name: 'Keyword Research', entry: 'app/actions/tools-extended.ts (fetchKeywordResearch)', lib: 'lib/connectors/keywords-everywhere.ts', kind: 'server-action' },
  { slug: 'core-web-vitals', name: 'Core Web Vitals', entry: 'app/actions/tools-extended.ts (fetchCoreWebVitals)', lib: 'lib/connectors/pagespeed.ts', kind: 'server-action' },
  { slug: 'page-seo-audit', name: 'Page SEO Audit', entry: 'app/actions/tools-extended.ts (fetchPageSeoAudit)', lib: 'lib/connectors/pagespeed.ts, lib/connectors/crawler.ts, anthropic', kind: 'server-action' },
  { slug: 'content-quality', name: 'Content Quality', entry: 'app/actions/tools-extended.ts (fetchContentQuality)', lib: 'lib/connectors/crawler.ts, anthropic', kind: 'server-action' },
  { slug: 'content-refresh-finder', name: 'Content Refresh Finder', entry: 'app/api/tools/content-refresh-finder/route.ts', lib: 'lib/tools-gsc.ts, lib/google-analytics.ts, anthropic', kind: 'stream-api' },
  { slug: 'landing-page-cro-audit', name: 'Landing Page CRO Audit', entry: 'app/api/tools/landing-page-cro-audit/route.ts', lib: 'lib/connectors/pagespeed.ts, lib/connectors/crawler.ts, anthropic', kind: 'stream-api' },
  { slug: 'vertical-benchmark', name: 'Vertical Benchmark', entry: 'app/api/tools/vertical-benchmark/route.ts', lib: 'lib/connectors/semrush-portal.ts, pagespeed, anthropic', kind: 'stream-api' },
  { slug: 'gbp-audit', name: 'GBP Audit', entry: 'app/api/tools/gbp-audit/route.ts + app/actions/tools-extended.ts (fetchGBPAccounts)', lib: 'lib/connectors/gbp.ts', kind: 'stream-api' },
]

phase('Per-tool')
log(`Evaluating ${TOOLS.length} tools in parallel across 5 dimensions each...`)

const evals = await parallel(
  TOOLS.map((t) => () =>
    agent(
      `You are a senior product+SEO engineer evaluating ONE tool in the LVL3 Portal (Next.js 14 + Supabase + Claude) at ${REPO}. Read-only. Evaluate it thoroughly and score it.

TOOL: ${t.name} (slug: ${t.slug})
Execution kind: ${t.kind}
Server entry point: ${t.entry}
Supporting lib/connectors: ${t.lib}
UI lives in: ${REPO}/app/(dashboard)/tools/${t.slug}/ — glob this dir and READ the page.tsx and the *Client.tsx (and any sub-components/ dir). Read the entry point and the key lib files too. Also check its entry in lib/tools/registry.ts.

Evaluate across these perspectives and assign 0-10 scores (10 = excellent). Be a discerning critic — most tools should land 5-8; reserve 9-10 for genuinely exceptional and <4 for broken.

1. LOGIC — Is the core algorithm correct and sensible? Examples: Keyword Quick Wins should target the right position band (e.g. 4-20) and rank by realistic impact; AI Visibility's branded/non-branded split logic; Content Gaps' impression/CTR thresholds; CWV's metric thresholds (LCP/CLS/INP good/poor cutoffs); CRO/quality scoring rubrics; the content engine's phase ordering. Are thresholds hardcoded sensibly or arbitrary? Any off-by-one, wrong-direction sort, or misleading metric?

2. WORKFLOW — Is the user flow smooth? input (client-pick / URL / keywords / file upload) → run → progress feedback → result → export. Is there a run-history? Can the user re-run / change params easily? For streaming tools, is progress legible? Dead-ends or confusing steps?

3. CODE EFFICIENCY — API-call efficiency (parallel vs sequential, caching, redundant fetches), client bundle weight, file size / god-component, duplication with other tools or with lib helpers (e.g. re-implementing normalizeDomain, client-config fetch, GSC row fetch). Wasted Claude tokens / oversized prompts. Note line counts of the main files.

4. FUNCTIONALITY — Completeness and robustness. Edge cases (no data / empty GSC / API error / rate limit / missing client config / huge input). Error states surfaced to the user vs swallowed. Input validation. Does it persist runs (tool_runs)? Does export (CSV/DOCX/XLSX/ZIP) work and is it correct?

5. UI/UX — Result presentation clarity (tables/charts/cards), loading + empty + error states, brand consistency (light IgniteIQ v4.2 theme — flag any leftover violet/purple, or off-brand colors), copy quality, mobile behavior signals, accessibility of the result view.

Return the structured object. Be specific: every issue needs a file:line and a concrete fix. Pick honest scores.`,
      { label: `tool:${t.slug}`, phase: 'Per-tool', schema: TOOL_SCHEMA, agentType: 'Explore' }
    )
  )
)

const tools = evals.filter(Boolean)

phase('Synthesis')
const digest = tools
  .map((t) => `### ${t.name} (${t.slug}) — overall ${t.overallScore}/10\nLogic ${t.dimensionScores.logic} · Workflow ${t.dimensionScores.workflow} · Code ${t.dimensionScores.codeEfficiency} · Func ${t.dimensionScores.functionality} · UI/UX ${t.dimensionScores.uiux}\nStandout: ${t.standout}\nTop issues: ${t.issues.filter((i) => i.severity === 'HIGH' || i.severity === 'MEDIUM').slice(0, 4).map((i) => `[${i.severity}/${i.dimension}] ${i.detail}`).join(' | ')}`)
  .join('\n\n')

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['crossCuttingPatterns', 'sharedCodeOpportunities', 'inconsistencies', 'ranking', 'topPriorities'],
  properties: {
    crossCuttingPatterns: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['pattern', 'affectedTools', 'recommendation'], properties: { pattern: { type: 'string' }, affectedTools: { type: 'string' }, recommendation: { type: 'string' } } }, description: 'Issues that recur across many tools' },
    sharedCodeOpportunities: { type: 'array', items: { type: 'string' }, description: 'Duplicated logic across tools that should be extracted to a shared helper/primitive' },
    inconsistencies: { type: 'array', items: { type: 'string' }, description: 'Where tools diverge in pattern, UX, or quality without good reason' },
    ranking: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tier', 'tools', 'why'], properties: { tier: { type: 'string', enum: ['Strong', 'Solid', 'Needs work', 'Weak'] }, tools: { type: 'string' }, why: { type: 'string' } } }, description: 'Group the tools into quality tiers' },
    topPriorities: { type: 'array', items: { type: 'string' }, description: 'The 5-7 highest-leverage fixes across the whole toolkit, ordered' },
  },
}

const synthesis = await agent(
  `You are a principal engineer reviewing per-tool evaluations of all 16 SEO tools in the LVL3 Portal at ${REPO}. Below is a digest of every tool's scores and top issues. Identify the CROSS-CUTTING story: patterns that recur across many tools, duplicated logic that should be extracted to shared helpers/primitives (note: components/tools/primitives/ already exists — ClientScopedTool, UrlInputTool, BackgroundJobTool; lib/normalize-domain.ts and lib/tools-gsc.ts exist), inconsistencies in pattern/UX/quality across tools, a quality-tier ranking of the tools, and the 5-7 highest-leverage fixes for the whole toolkit. Read files to confirm shared-code claims. Be concrete.

DIGEST:
${digest}`,
  { label: 'cross-tool-synthesis', phase: 'Synthesis', schema: SYNTH_SCHEMA, agentType: 'Explore' }
)

return { tools, synthesis }
