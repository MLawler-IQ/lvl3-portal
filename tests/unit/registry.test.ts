import { describe, expect, it } from 'vitest'

import { TOOLS, getToolBySlug } from '@/lib/tools/registry'

/**
 * Tools known to actually write tool_runs rows, derived by grepping the
 * codebase (2026-06-10):
 *
 * 1. ExportTool usages — `grep -rn 'toolSlug=' app components`:
 *    keyword-quick-wins, keyword-research, ai-visibility, content-quality,
 *    page-seo-audit, core-web-vitals, content-gaps, backlink-overview
 *    (these persist via app/actions/tool-runs.ts → persistRun)
 *
 * 2. API routes inserting into tool_runs directly —
 *    `grep -rln 'tool_runs' app/api/tools`:
 *    content-refresh-finder, gbp-audit, landing-page-cro-audit,
 *    vertical-benchmark
 *
 * If a tool starts/stops writing tool_runs, update this list AND the
 * registry's persistsRuns flag together.
 */
const KNOWN_TOOL_RUNS_WRITERS = [
  // ExportTool / persistRun
  'keyword-quick-wins',
  'keyword-research',
  'ai-visibility',
  'content-quality',
  'page-seo-audit',
  'core-web-vitals',
  'content-gaps',
  'backlink-overview',
  // Direct tool_runs writers in app/api/tools/*
  'content-refresh-finder',
  'gbp-audit',
  'landing-page-cro-audit',
  'vertical-benchmark',
]

describe('TOOLS registry structural invariants', () => {
  it('has unique slugs', () => {
    const slugs = TOOLS.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('every route is /tools/<slug>', () => {
    for (const tool of TOOLS) {
      expect(tool.route).toBe(`/tools/${tool.slug}`)
    }
  })

  it('every tool has a non-empty name, description, and at least one data source', () => {
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.dataSources.length).toBeGreaterThan(0)
    }
  })
})

describe('registry vs reality: tool_runs persistence', () => {
  it('every known tool_runs writer exists in the registry', () => {
    for (const slug of KNOWN_TOOL_RUNS_WRITERS) {
      expect(getToolBySlug(slug), `missing registry entry for ${slug}`).toBeDefined()
    }
  })

  it('every known tool_runs writer is flagged persistsRuns: true', () => {
    for (const slug of KNOWN_TOOL_RUNS_WRITERS) {
      const tool = getToolBySlug(slug)
      expect(tool?.persistsRuns, `${slug} writes tool_runs but persistsRuns !== true`).toBe(true)
    }
  })

  it('blog-image-generator uses only openai and does not persist runs', () => {
    const tool = getToolBySlug('blog-image-generator')
    expect(tool).toBeDefined()
    expect(tool?.dataSources).toEqual(['openai'])
    expect(tool?.persistsRuns).toBe(false)
  })
})
