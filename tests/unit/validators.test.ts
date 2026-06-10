import { describe, expect, it } from 'vitest'

import {
  DATA_COVERAGE_THRESHOLD,
  KEYWORD_TARGETS,
  MIN_WORD_COUNT,
} from '@/lib/seo-content-engine/config'
import {
  validateBrief,
  validateDataCoverage,
  validateDraft,
  validateKeywordPlan,
} from '@/lib/seo-content-engine/validators'
import type { KeywordPlan } from '@/lib/seo-content-engine/types'

function makePlan(overrides: Partial<KeywordPlan> = {}): KeywordPlan {
  const fill = (cat: string) =>
    Array.from({ length: KEYWORD_TARGETS[cat].min }, (_, i) => `${cat}-kw-${i}`)
  return {
    primary: fill('primary'),
    secondary: fill('secondary'),
    supporting: fill('supporting'),
    questions: fill('questions'),
    clusters: [{ cluster_name: 'c1', keywords: ['a'], target_section: 'intro' }],
    rejected: [],
    rationale: 'test plan',
    metrics: {},
    ...overrides,
  }
}

const VALID_BRIEF = {
  title: 'How to Fix a Leaky Faucet',
  primary_keywords: ['leaky faucet repair'],
  outline: [{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }, { heading: 'D' }, { heading: 'E' }],
  geo_targets: ['Austin, TX'],
  citation_hooks: ['stat 1'],
  entity_definitions: ['faucet'],
  editorial_guidance: 'Be helpful.',
  meta_title: 'Fix a Leaky Faucet | Acme Plumbing',
  meta_description: 'Step-by-step faucet repair guide.',
}

describe('validateKeywordPlan', () => {
  it('passes a plan that meets all category minimums', () => {
    const result = validateKeywordPlan(makePlan())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('warns when a category is below its minimum', () => {
    const result = validateKeywordPlan(makePlan({ primary: ['only-one'] }))
    expect(result.valid).toBe(true) // count issues are warnings, not errors
    expect(result.warnings.some((w) => w.startsWith('primary keywords: 1'))).toBe(true)
  })

  it('warns when a category exceeds its maximum', () => {
    const tooMany = Array.from(
      { length: KEYWORD_TARGETS.questions.max + 1 },
      (_, i) => `q-${i}`,
    )
    const result = validateKeywordPlan(makePlan({ questions: tooMany }))
    expect(result.warnings.some((w) => w.includes('above maximum'))).toBe(true)
  })

  it('warns when no clusters are defined', () => {
    const result = validateKeywordPlan(makePlan({ clusters: [] }))
    expect(result.warnings).toContain('No semantic clusters defined')
  })
})

describe('validateBrief', () => {
  it('passes a complete brief', () => {
    const result = validateBrief(VALID_BRIEF)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('errors on missing required fields', () => {
    const { meta_title: _omit, ...partial } = VALID_BRIEF
    const result = validateBrief(partial)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Brief missing required field: meta_title')
  })

  it('treats empty strings as missing', () => {
    const result = validateBrief({ ...VALID_BRIEF, title: '' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Brief missing required field: title')
  })

  it('warns (not errors) on empty arrays', () => {
    const result = validateBrief({ ...VALID_BRIEF, geo_targets: [] })
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain("Brief field 'geo_targets' is empty array")
  })

  it('warns on a short outline', () => {
    const result = validateBrief({ ...VALID_BRIEF, outline: [{ heading: 'A' }, { heading: 'B' }] })
    expect(result.warnings.some((w) => w.includes('Outline has only 2 sections'))).toBe(true)
  })
})

describe('validateDraft', () => {
  const longDraft = (extra = '') =>
    `${extra} ${Array.from({ length: MIN_WORD_COUNT + 50 }, (_, i) => `word${i}`).join(' ')}`

  it('errors when word count is below the minimum', () => {
    const result = validateDraft('too short', { primary_keywords: [] })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes(`below minimum of ${MIN_WORD_COUNT}`))).toBe(true)
  })

  it('passes a long draft containing all primary keywords', () => {
    const result = validateDraft(longDraft('Leaky Faucet Repair guide.'), {
      primary_keywords: ['leaky faucet repair'],
    })
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('warns when primary keywords are missing (case-insensitive check)', () => {
    const result = validateDraft(longDraft(), {
      primary_keywords: ['water heater install'],
    })
    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes('water heater install'))).toBe(true)
  })
})

describe('validateDataCoverage', () => {
  it('does not warn when all primary keywords have volume data', () => {
    const plan = makePlan()
    plan.metrics = Object.fromEntries(
      plan.primary.map((kw) => [kw, { msv: 100, cpc: 1, competition: 0.5 }]),
    )
    const result = validateDataCoverage(plan)
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('warns when coverage falls below the threshold', () => {
    const plan = makePlan()
    // Only the first primary keyword has metrics → coverage well below threshold
    plan.metrics = { [plan.primary[0]]: { msv: 100, cpc: 1, competition: 0.5 } }
    const result = validateDataCoverage(plan)
    expect(result.valid).toBe(true) // coverage issues are warnings only
    expect(
      result.warnings.some((w) =>
        w.includes(`threshold: ${(DATA_COVERAGE_THRESHOLD * 100).toFixed(0)}%`),
      ),
    ).toBe(true)
  })

  it('zero msv does not count as covered', () => {
    const plan = makePlan()
    plan.metrics = Object.fromEntries(
      plan.primary.map((kw) => [kw, { msv: 0, cpc: 0, competition: 0 }]),
    )
    const result = validateDataCoverage(plan)
    expect(result.warnings.length).toBe(1)
  })
})
