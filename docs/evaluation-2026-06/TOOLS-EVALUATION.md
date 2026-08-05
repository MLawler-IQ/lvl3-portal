# LVL3 Portal — Per-Tool Evaluation

**Date:** 2026-06-10 · **Commit:** `34c6935` · **Scope:** all 16 implemented SEO tools (+3 coming-soon stubs)
**Method:** one deep-eval agent per tool scoring 5 dimensions, a cross-tool synthesis pass, then **adversarial verification of every HIGH/blocking claim against the real code.**

---

## How to read this

Each tool was scored 0–10 on **logic** (is the algorithm correct?), **workflow** (is the flow smooth?), **code efficiency**, **functionality** (completeness/robustness), and **UI/UX**. Then every HIGH-severity claim went to an independent verifier that read the actual code and tried to refute it. Scores and severities below are **post-verification**.

> **Verification mattered here.** It overturned the synthesis's own #1 "blocking bug." Two findings were false positives:
> - ❌ *"Blog Image Generator uses an invalid model `gpt-image-1`, change to dall-e-3."* **Refuted** — `gpt-image-1` is a real, current OpenAI model (and returns base64 by default, which is what the code reads). Changing it to `dall-e-3` would be a regression.
> - ❌ *"Core Web Vitals uses inverted dark-theme colors, looks half-finished."* **Refuted** — `surface-900` is `#F7F6F4` (light) and `surface-100` is `#0A0A0A` (dark ink) after the v4.2 token remap, so `bg-surface-900 text-surface-100` is correct light-theme styling. The agent assumed the old LVL3 scale.
>
> Both tools' scores below are adjusted upward from the raw agent scores to remove the false-finding penalty (footnoted).

---

## Scorecard (all 16 tools)

| Tool | Logic | Workflow | Code | Func | UI/UX | Overall | Tier |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| SEO Content Engine | 7 | 8 | 7 | 7 | 8 | **7.5** | Strong |
| Keyword Quick Wins | 8 | 7 | 8 | 7 | 7 | **7.4** | Solid |
| TFK Location Generator | 8 | 7 | 6 | 7 | 8 | **7.2** | Solid |
| Competitor Gap (Semrush) | 7 | 7 | 6 | 7 | 8 | **7.0** | Solid |
| Content Gap Finder | 7 | 7 | 8 | 6 | 7 | **7.0** | Solid |
| GBP Audit | 7 | 7 | 7 | 7 | 7 | **7.0** | Solid |
| Core Web Vitals †| 6 | 7 | 7 | 7 | 7† | **6.8†** | Needs work |
| Content Refresh Finder | 7 | 7 | 6 | 6 | 7 | **6.6** | Solid |
| Backlink Overview | 7 | 5 | 8 | 6 | 7 | **6.6** | Needs work |
| Keyword Research | 7 | 6 | 7 | 6 | 6 | **6.4** | Needs work |
| Page SEO Audit | 7 | 6 | 7 | 6 | 6 | **6.4** | Needs work |
| Blog Image Generator †| 6† | 7 | 6 | 5 | 7 | **6.3†** | Needs work |
| Content Quality | 7 | 7 | 6 | 6 | 5 | **6.2** | Needs work |
| Vertical Benchmark | 6 | 7 | 6 | 5 | 6 | **6.2** | Weak |
| AI Visibility Check | 6 | 7 | 6 | 5 | 7 | **6.0** | Needs work |
| Landing Page CRO Audit | 6 | 7 | 6 | 6 | 5 | **6.0** | Weak |

† **Verification-adjusted.** Core Web Vitals UI/UX raised 5→7 (the "inverted theme" HIGH was refuted). Blog Image logic raised 5→6 (the "invalid model" HIGH was refuted). Their remaining issues are real.

---

## Tier ranking

- **Strong** — *SEO Content Engine.* Intelligent cross-run caching by topic title, NDJSON streaming with per-topic progress, proper persistence + DOCX export. The most complete tool in the suite.
- **Solid** — *Keyword Quick Wins, TFK Generator, Competitor Gap, Content Gap Finder, GBP Audit, Content Refresh Finder.* Sound logic and good architecture; gaps are export/persistence and edge cases, not correctness.
- **Needs work** — *Core Web Vitals, Backlink Overview, Keyword Research, Page SEO Audit, Blog Image Generator, Content Quality, AI Visibility.* Each has a real correctness bug or a metadata/error-handling gap plus missing persistence.
- **Weak** — *Vertical Benchmark, Landing Page CRO Audit.* Foundational issues: VB leaves failed runs stuck `running` and uses substring domain matching; CRO has hardcoded colors, naive trust-signal detection, and a stalled progress bar during the Claude call.

---

## Confirmed bugs worth fixing (post-verification)

### HIGH
1. **Core Web Vitals reports a false "pass."** `cwvPass` counts CrUX `AVERAGE` as passing alongside `FAST` ([pagespeed.ts:70-73](lib/connectors/pagespeed.ts)). `AVERAGE` is Google's *needs-improvement* bucket — a page with any average metric does **not** pass CWV, but the tool says it does. *Fix:* require `=== 'FAST'` for all three metrics.
2. **AI Visibility misclassifies branded traffic.** Domain token is extracted with `clean.split('.')[0]` ([tools.ts:124](app/actions/tools.ts)) — for `shop.brand.com` it yields `"shop"`, not `"brand"`, so branded queries read as non-branded. Compounded by substring brand-matching (`includes(term)` at line 134) where slug `"shoe"` matches `"shoelace"`. *Fix:* use the existing `normalizeDomain()` helper + word-boundary matching. This makes the core metric unreliable for any subdomained or short-slug client.
3. **Vertical Benchmark leaves failed runs stuck.** The catch block emits an error event but only has a `// Mark run as failed` TODO — no DB update ([route.ts:403-406](app/api/tools/vertical-benchmark/route.ts)). Failed runs stay `status='running'` forever, polluting history. *Fix:* add the `tool_runs` update to `status='failed'` in the catch.
4. **Blog Image Generator registry metadata is wrong.** Registry says `persistsRuns: true` but the route never writes to `tool_runs`, and `dataSources: ['claude']` though it uses OpenAI exclusively ([registry.ts:141-144](lib/tools/registry.ts), [route.ts](app/api/generate-blog-images/route.ts)). *Fix:* set `persistsRuns: false` (or implement the writes) and `dataSources: ['openai']`.

### MEDIUM
5. **Content Gap Finder drops position ~10.1–10.9 queries.** The three classification branches (`>=200 imp & ctr<1%`, `pos 11–20`, `pos ≤10`) leave a hole: a query at avg position 10.5 with moderate impressions/CTR matches none and is silently excluded ([tools.ts:541-563](app/actions/tools.ts)). *Fix:* widen a boundary to 10.5 or add a catch-all.
6. **Backlink Overview (and Semrush connector) swallow errors.** `} catch { return null }` ([semrush-portal.ts:75-77,104-106](lib/connectors/semrush-portal.ts)) makes an API-key failure or rate-limit indistinguishable from "domain not indexed." *Fix:* log + return a typed error the UI can surface.
7. **Vertical Benchmark domain matching is substringy.** `r.url.includes(domain)` ([route.ts:52](app/api/tools/vertical-benchmark/route.ts)) means `example.com` matches `notexample.com`. Lower real-world risk (crawl targets are clean) but it regresses from the correct `new URL().hostname` used elsewhere in the same file. *Fix:* parse hostname.
8. **TFK Generator leans on a Buffer polyfill.** `Buffer.from(...)` in a `'use client'` component ([TfkGeneratorClient.tsx:73,96-97](app/(dashboard)/tools/tfk-generator/TfkGeneratorClient.tsx)). Next 14.2 polyfills `Buffer` so it works *today*, but it's fragile across build/version changes. *Fix:* use `atob`/`btoa` + `Uint8Array`; `XLSX.read` also accepts `{ type: 'base64' }` directly. (Not the blocking crash the first pass called it.)

### Worth a live check, not yet a confirmed bug
- **Core Web Vitals CLS display** divides `percentile / 100` ([CoreWebVitalsClient.tsx:103](app/(dashboard)/tools/core-web-vitals/CoreWebVitalsClient.tsx)). Whether that's right depends on whether the PSI API returns CLS percentile pre-multiplied by 100 (in which case it's correct) or as a raw decimal (in which case it shows 100× too small). Confirm against a live PSI response before changing.
- **Blog Image base64 handling** reads `resp.data[0].b64_json` with no `response_format`. For `gpt-image-1` that's correct (it returns base64 by default); the original "broken" claim was wrong. Just confirm against your installed `openai` SDK version on the next run.

---

## Cross-cutting patterns (the real story)

The per-tool bugs matter less than these recurring patterns — fixing them once helps the whole suite:

1. **No persistence/export on the read-only tools.** Quick Wins, AI Visibility, Content Gaps, Keyword Research, Core Web Vitals, Page SEO Audit, Content Quality, Backlink Overview all have `persistsRuns: false` and no CSV/DOCX. Users can't save a result, share it, or track a trend — a real gap for client deliverables. → Build one `ExportTool`/persistence primitive alongside the existing `BackgroundJobTool`, `ClientScopedTool`, `UrlInputTool` and adopt it across all of them.
2. **Hardcoded status colors instead of tokens.** `text-green-400`, `#34D399`, `#FBBF24`, `#F87171` recur across CRO Audit, Vertical Benchmark, Content Quality, GBP Audit, Core Web Vitals badges — bypassing `--color-success/-warning/-error`. → Extract a `statusColor()` helper mapped to CSS variables. (Note: this is *separate* from the brand-red AA contrast issue in the main report.)
3. **Silent error swallowing in connectors.** The Semrush/PSI/crawler `catch { return null }` pattern hides *why* data is missing across at least 5 tools. → Standardize a `{ ok, data, error }` connector return + logging.
4. **Naive domain handling re-implemented per tool.** `split('.')[0]` / `url.includes(domain)` appear in AI Visibility, Semrush Gap (client-side dup of `normalizeDomain`), Vertical Benchmark. → One strict, URL-parsing `normalizeDomain` imported everywhere.
5. **No loading feedback on the synchronous server-component tools.** Backlink, CWV, Page SEO, Content Quality, Keyword Research render blank during the fetch (ties to the 2–3s analytics latency in the main report). → `loading.tsx` / Suspense + skeletons.
6. **Registry metadata drifts from implementation.** Blog Image (`dataSources`, `persistsRuns`), Page SEO Audit (`dataSources: ['psi','claude']` but only crawls), Semrush Gap (`persistsRuns: false` but does persist), Content Refresh Finder ("send to Content Engine" promised, absent). → Treat the registry as a contract; add a lint/test that checks it against reality.
7. **CSV/TSV parsing duplicated** in Blog Image's client *and* its route (~72 lines). → `lib/parse-csv.ts` with RFC-4180 escaping.

---

## Shared-code opportunities (extract once, reuse everywhere)

- `lib/normalize-domain.ts` — already exists; enforce its use, make it subdomain-safe via `new URL().hostname`.
- `lib/parse-csv.ts` — dedupe the Blog Image client/route parsers; fix escaped-quote handling.
- `lib/connectors/*` error contract — `{ ok, data, error }` + logging, kills the silent-null pattern.
- `statusColor()` / status-badge helper — one mapping to `--color-success/-warning/-error`.
- `ExportTool` primitive — CSV/XLSX/DOCX download UI for the read-only analysis tools.
- A registry-vs-reality check — assert `dataSources` and `persistsRuns` match the code.

---

## Suggested sequencing

1. **Correctness first (S each):** CWV `AVERAGE`-pass (#1), AI Visibility domain/brand match (#2), Vertical Benchmark failed-status (#3), Blog Image registry metadata (#4). All small, all real.
2. **The connector error contract (#6 cross-cutting)** — unblocks honest error messages across Backlink, Semrush Gap, Keyword Research, and the AI tools at once.
3. **The persistence/export primitive (#1 cross-cutting)** — the single highest-leverage UX upgrade; turns 8 read-only snapshots into shareable, trackable deliverables.
4. **The status-color + domain helpers (#2, #4 cross-cutting)** — fold in as you touch each tool.
5. **Live-confirm** the CLS-display and Blog-Image-b64 items before changing them.

## The 3 coming-soon tools
`schema-generator`, `service-page-generator`, `indexation-monitor` are registry entries with no route implementation. They're correctly disabled in the UI (`href="#"`, `pointer-events-none`) so they don't 404 — but decide whether to build or hide them, since they still occupy prime grid slots.

---
*Per-tool findings generated by a 16-agent evaluation + cross-tool synthesis, then hardened by an 11-claim adversarial verification pass. The full raw findings (every tool, every issue, every verifier verdict) are preserved in the task outputs — nothing discarded.*
