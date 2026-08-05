export const meta = {
  name: 'lvl3-tools-verify',
  description: 'Adversarially verify every blocking/HIGH per-tool finding against the real code',
  phases: [{ title: 'Verify', detail: 'one skeptic per claim, reads the actual files' }],
}

const REPO = '/Users/matthewlawler/lvl3-portal'

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'correctedSeverity', 'reasoning'],
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'PARTIALLY_TRUE', 'REFUTED'] },
    correctedSeverity: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW', 'DROP'] },
    reasoning: { type: 'string', description: 'What you found in the actual code — quote the relevant lines' },
  },
}

const CLAIMS = [
  {
    id: 'blog-gpt-image-1',
    tool: 'blog-image-generator',
    claim: "The OpenAI image model 'gpt-image-1' (app/api/generate-blog-images/route.ts:~83) is INVALID / does not exist and will fail every call; should be changed to 'dall-e-3'.",
    note: "CRITICAL skepticism required: gpt-image-1 IS a real, current OpenAI image-generation model (released April 2025) — it is NOT invalid. Changing it to dall-e-3 would be a REGRESSION. Verify the model string and how it's called. The real question is only whether the images.generate() call shape (params like size, quality, response_format/b64) matches what gpt-image-1 expects — assess that, not the model's existence. If the only issue claimed is 'model doesn't exist', REFUTE it.",
  },
  {
    id: 'cwv-theme-inverted',
    tool: 'core-web-vitals',
    claim: "CoreWebVitalsClient.tsx uses dark-theme colors (bg-surface-900, text-surface-100) that are 'inverted' from the IgniteIQ light brand and look half-finished (rated uiux HIGH).",
    note: "CRITICAL skepticism: the app rebranded to IgniteIQ v4.2 by REMAPPING the surface-* tokens. Read app/globals.css and tailwind.config.ts: confirm what --surface-900 and --surface-100 actually resolve to. If surface-900 is a LIGHT value (~#F7F6F4) and surface-100 is DARK ink (~#0A0A0A), then bg-surface-900 + text-surface-100 = light card with dark text = CORRECT for the light theme, and this finding is a misread. Determine whether the tool genuinely looks wrong or whether the agent assumed surface-900=dark.",
  },
  {
    id: 'cwv-average-pass',
    tool: 'core-web-vitals',
    claim: "lib/connectors/pagespeed.ts:~70-73 treats CrUX category AVERAGE as PASSING Core Web Vitals; Google's 'good' standard requires all metrics FAST. (logic HIGH)",
    note: "Read pagespeed.ts around the cwvPass computation. Confirm whether AVERAGE is OR'd into the pass condition. Note: 'AVERAGE' is CrUX's needs-improvement bucket, so counting it as a pass overstates CWV health — assess whether that's truly the logic.",
  },
  {
    id: 'cwv-cls-divide',
    tool: 'core-web-vitals',
    claim: "CoreWebVitalsClient.tsx:~103 divides the CLS percentile by 100 (value={result.crux.cls.percentile / 100}), misrepresenting the score. (logic MEDIUM)",
    note: "Read the CLS rendering line and the pagespeed connector's percentile field. Determine what units percentile is in (raw CLS like 0.08, or an integer?) and whether /100 is wrong. Be careful: confirm what value the connector actually stores before judging.",
  },
  {
    id: 'aivis-subdomain',
    tool: 'ai-visibility',
    claim: "app/actions/tools.ts (checkAIVisibility, ~lines 117-134) extracts the brand token via split('.')[0] which misclassifies branded vs non-branded traffic for subdomained sites. (logic HIGH)",
    note: "Read the actual domain-extraction + brand-matching logic in checkAIVisibility. Confirm whether split('.')[0] is used and whether it genuinely breaks for common cases. Also check the substring brand-match claim (slug 'shoe' matching 'shoelace').",
  },
  {
    id: 'gaps-boundary',
    tool: 'content-gaps',
    claim: "app/actions/tools.ts (fetchContentGaps) has a position-boundary gap: 'ranking-but-weak' requires position <= 10 and 'near-page-one' requires position >= 11, so queries with avg position 10.1-10.9 match NEITHER and are silently dropped. (logic HIGH)",
    note: "Read the actual classification conditions in fetchContentGaps. Confirm the exact operators/thresholds and whether a 10.1-10.9 query truly falls through all branches (also check if there's a catch-all category that would still include it).",
  },
  {
    id: 'vbench-domain-includes',
    tool: 'vertical-benchmark',
    claim: "app/api/tools/vertical-benchmark/route.ts:~52 filters competitor pages with r.url.includes(domain), so 'example.com' wrongly matches 'notexample.com'. (logic HIGH)",
    note: "Read the actual filter line. Confirm it's a naive substring includes() on the full URL and assess the real-world collision risk.",
  },
  {
    id: 'vbench-failed-status',
    tool: 'vertical-benchmark',
    claim: "app/api/tools/vertical-benchmark/route.ts:~403-406 catch block emits an error event but never updates the tool_runs row to status='failed' — failed runs stay 'running' forever. (functionality HIGH)",
    note: "Read the catch block and the surrounding run-status update logic. Confirm whether a status='failed' update is genuinely missing (check the whole catch block and any finally).",
  },
  {
    id: 'tfk-buffer',
    tool: 'tfk-generator',
    claim: "TfkGeneratorClient.tsx (~lines 73, 96-97) uses the Node Buffer API in a 'use client' browser component, which will crash when loading/exporting XLSX. (codeEfficiency HIGH / blocking)",
    note: "Read those lines. Confirm Buffer is actually referenced in client-executed code (not in a server import). Note: Next.js may polyfill Buffer in some bundling configs — assess whether it actually throws at runtime in the browser or is polyfilled/avoided.",
  },
  {
    id: 'blog-persists-mismatch',
    tool: 'blog-image-generator',
    claim: "Registry marks blog-image-generator persistsRuns:true but the API never writes to tool_runs, and dataSources is ['claude'] though it uses OpenAI. (functionality HIGH + metadata)",
    note: "Read lib/tools/registry.ts blog-image-generator entry and app/api/generate-blog-images/route.ts. Confirm persistsRuns value, whether any tool_runs insert exists, and the dataSources value vs actual SDK used.",
  },
  {
    id: 'backlink-silent-error',
    tool: 'backlink-overview',
    claim: "lib/connectors/semrush-portal.ts:~75-77,104-106 catch blocks return null with no logging, so Semrush API failures appear to the user as 'no data available'. (functionality HIGH)",
    note: "Read those catch blocks. Confirm they swallow errors (return null, no log, no error propagation) and that the UI can't distinguish API failure from empty result.",
  },
]

phase('Verify')
log(`Adversarially verifying ${CLAIMS.length} blocking/HIGH per-tool claims against the real code...`)

const results = await parallel(
  CLAIMS.map((c) => () =>
    agent(
      `You are an adversarial verifier checking a finding from a tool audit of the Next.js+Supabase app at ${REPO}. Read the ACTUAL referenced code and decide whether the claim holds. Default to skepticism — audit agents frequently misread remapped design tokens, flag valid library APIs as invalid because of stale training data, or overstate severity.

TOOL: ${c.tool}
CLAIM: ${c.claim}

VERIFIER NOTE (read carefully — this often determines the verdict): ${c.note}

Read the real files/lines yourself with Read/Grep. Return CONFIRMED (real and accurately described), PARTIALLY_TRUE (real but overstated/misdiagnosed — explain), or REFUTED (false). Set correctedSeverity (HIGH/MEDIUM/LOW, or DROP to remove). Quote the actual lines you read in your reasoning.`,
      { label: `verify:${c.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' }
    ).then((v) => ({ id: c.id, tool: c.tool, claim: c.claim, ...v }))
  )
)

return { verifications: results.filter(Boolean) }
