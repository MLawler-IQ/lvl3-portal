// The question partition, and the rule that a denominator never shrinks.
//
// What this file is really guarding: coverage used to be expressible only as "N of 80",
// and the two ways that number lies are (a) shrinking the denominator so an unbuilt
// detector stops counting, and (b) growing the numerator with cheap detectors that change
// no answer. tests/unit/eval-gate.test.ts already prevents (a) INSIDE the eval harness
// ("a check quietly going not_run can never inflate recall by shrinking what it is measured
// against"); these assertions prevent the same move one level up, where the audience is a
// client rather than a test.
//
// The partition assertions are deliberately arithmetic rather than a snapshot of the
// current mapping. A snapshot would have to be re-baselined every time a row moves
// question, and re-baselining is exactly the moment a row goes missing unnoticed.

import { describe, it, expect } from 'vitest'
import {
  QUESTIONS,
  QUESTION_KEYS,
  partitionRubricByQuestion,
  questionCoverage,
  questionOf,
  summariseQuestion,
} from '@/lib/audit/questions'
import { CHECKS } from '@/lib/findings/checks'
import rubricJson from '@/docs/rubric/rubric.json'
import type { Finding, FindingStatus } from '@/lib/findings/types'

const RUBRIC = rubricJson as ReadonlyArray<Record<string, unknown>>

/**
 * The active-row count, asserted as a literal.
 *
 * 80 today. Slice 2 of docs/AUDIT-REDESIGN-PLAN.md retires ten rows and this becomes 70 —
 * a deliberate one-line edit made while reading the retire list, which is the point. A test
 * that derived this number from the rubric would pass whether ten rows were retired on
 * purpose or one was deleted by accident.
 */
const ACTIVE_ROWS = 80

function finding(checkId: string, status: FindingStatus): Finding {
  return { checkId, status, evidence: { detail: `${checkId} ${status}` }, source: 'crawl' }
}

describe('the seven questions', () => {
  it('exposes exactly seven, numbered 1-7 in QUESTION_KEYS order', () => {
    expect(QUESTION_KEYS).toHaveLength(7)
    expect(QUESTIONS).toHaveLength(7)
    expect(QUESTIONS.map((q) => q.key)).toEqual([...QUESTION_KEYS])
    expect(QUESTIONS.map((q) => q.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('asks measurement first and hygiene last', () => {
    // Not cosmetic. If GA4/GSC/call tracking are not capturing outcomes, every number
    // downstream is unfalsifiable — the 80-check critique's one structural complaint about
    // the old category order was that measurement readiness sat last. Hygiene is last
    // because past a floor it stops changing outcomes.
    expect(QUESTIONS[0]?.key).toBe('measurement')
    expect(QUESTIONS[6]?.key).toBe('hygiene')
  })

  it('gives every question a distinct label and a question sentence', () => {
    const labels = new Set(QUESTIONS.map((q) => q.label))
    expect(labels.size).toBe(7)
    for (const q of QUESTIONS) {
      expect(q.question.endsWith('?')).toBe(true)
      expect(q.label.length).toBeGreaterThan(0)
    }
  })
})

describe('the rubric partition', () => {
  it('puts every active row in exactly one question', () => {
    const { active, retired } = partitionRubricByQuestion()
    const ids = QUESTION_KEYS.flatMap((k) => [...(active.get(k) ?? [])])

    expect(new Set(ids).size).toBe(ids.length) // no row counted twice
    expect(ids).toHaveLength(ACTIVE_ROWS)
    expect(ids.length + retired.length).toBe(RUBRIC.length)
  })

  it('accounts for every rubric row, active or retired', () => {
    const { active, retired } = partitionRubricByQuestion()
    const accounted = new Set([
      ...QUESTION_KEYS.flatMap((k) => [...(active.get(k) ?? [])]),
      ...retired,
    ])
    const all = RUBRIC.map((r) => String(r.id))

    expect(accounted.size).toBe(all.length)
    for (const id of all) expect(accounted.has(id)).toBe(true)
  })

  it('has no empty question — every question earns its place in the report', () => {
    const { active } = partitionRubricByQuestion()
    for (const key of QUESTION_KEYS) {
      expect((active.get(key) ?? []).length, `question ${key} has no criteria`).toBeGreaterThan(0)
    }
  })

  it('resolves a known id and returns null rather than guessing for an unknown one', () => {
    expect(questionOf('MEAS-001')).toBe('measurement')
    expect(questionOf('CRO-001')).toBe('conversion')
    expect(questionOf('NOPE-999')).toBeNull()
  })

  it('places the criteria the redesign plan calls out by name', () => {
    // These six are the non-obvious placements docs/AUDIT-REDESIGN-PLAN.md documents. They
    // are asserted because each one is a judgement someone will later be tempted to
    // "correct" back to its old category, and the reasoning belongs next to the assertion.
    expect(questionOf('TECH-002')).toBe('risk') // indexability of money content, not hygiene
    expect(questionOf('TECH-004')).toBe('risk') // raw-HTML content: invisible to AI crawlers
    expect(questionOf('TECH-011')).toBe('conversion') // mobile rendering on a phone-driven business
    expect(questionOf('LOCAL-001')).toBe('visibility') // GBP primary category is the pack's #1 factor
    expect(questionOf('LOCAL-016')).toBe('visibility') // the rankable-radius row
    expect(questionOf('ONPAGE-005')).toBe('demand') // intent match is a demand question
  })
})

describe('questionCoverage', () => {
  it('reports every question even when the run found nothing', () => {
    const report = questionCoverage([])

    expect(report.questions).toHaveLength(7)
    expect(report.activeRows).toBe(ACTIVE_ROWS)
    expect(report.unknownCheckIds).toEqual([])
    // Nothing evaluated, and the denominators are unchanged. This is the assertion the
    // whole file exists for: an empty run does not get to look small.
    for (const q of report.questions) {
      expect(q.evaluated).toEqual([])
      expect(q.total).toBeGreaterThan(0)
    }
  })

  it('buckets the four states exhaustively and exclusively', () => {
    const report = questionCoverage([
      finding('MEAS-001', 'fail'),
      finding('LOCAL-003', 'degraded'),
      finding('LOCAL-016', 'not_run'),
      finding('TECH-001', 'pass'),
    ])

    for (const q of report.questions) {
      const sum =
        q.evaluated.length + q.dataMissing.length + q.notEvaluated.length + q.humanJudgement.length
      expect(sum, `question ${q.key} buckets do not sum to its total`).toBe(q.total)

      // And no id appears in two buckets.
      const all = [...q.evaluated, ...q.dataMissing, ...q.notEvaluated, ...q.humanJudgement]
      expect(new Set(all).size).toBe(all.length)
    }

    const measurement = report.questions.find((q) => q.key === 'measurement')!
    expect(measurement.evaluated).toContain('MEAS-001')

    const visibility = report.questions.find((q) => q.key === 'visibility')!
    expect(visibility.evaluated).toContain('LOCAL-003') // degraded is a verdict
    expect(visibility.dataMissing).toContain('LOCAL-016') // not_run is not
    expect(visibility.evaluated).not.toContain('LOCAL-016')
  })

  it('counts pass, fail and degraded as evaluated and not_run as data missing', () => {
    const evaluated = (status: FindingStatus) => {
      const report = questionCoverage([finding('TECH-001', status)])
      return report.questions.find((q) => q.key === 'risk')!
    }

    for (const status of ['pass', 'fail', 'degraded'] as const) {
      expect(evaluated(status).evaluated, status).toContain('TECH-001')
    }
    expect(evaluated('not_run').dataMissing).toContain('TECH-001')
    expect(evaluated('not_run').evaluated).not.toContain('TECH-001')
  })

  it('separates auto criteria nothing evaluated from criteria that need a strategist', () => {
    // Collapsing these two reports roughly thirty judgement calls as tooling debt. The
    // rubric's own `automation` tier is the only thing that decides which is which.
    const report = questionCoverage([])
    const byId = new Map(RUBRIC.map((r) => [String(r.id), String(r.automation)]))

    for (const q of report.questions) {
      for (const id of q.notEvaluated) expect(byId.get(id), id).toBe('auto')
      for (const id of q.humanJudgement) expect(byId.get(id), id).toBe('assisted')
    }
  })

  it('names a finding whose check id is in no rubric row instead of dropping it', () => {
    const report = questionCoverage([finding('MADE-UP-001', 'fail'), finding('MEAS-001', 'fail')])

    expect(report.unknownCheckIds).toEqual(['MADE-UP-001'])
    // And it is in nobody's counts, so the totals still add up.
    for (const q of report.questions) {
      const all = [...q.evaluated, ...q.dataMissing, ...q.notEvaluated, ...q.humanJudgement]
      expect(all).not.toContain('MADE-UP-001')
      expect(all).toHaveLength(q.total)
    }
  })

  it('does not double-count a check id that appears in two findings', () => {
    const report = questionCoverage([finding('TECH-001', 'fail'), finding('TECH-001', 'fail')])
    const risk = report.questions.find((q) => q.key === 'risk')!

    expect(risk.evaluated.filter((id) => id === 'TECH-001')).toHaveLength(1)
    expect(
      risk.evaluated.length + risk.dataMissing.length + risk.notEvaluated.length + risk.humanJudgement.length,
    ).toBe(risk.total)
  })

  it('tolerates a malformed findings array rather than blanking the screen', () => {
    // The caller is a renderer holding a run out of audit_runs.result jsonb. lib/audit/store.ts
    // decides whether the envelope was readable at all; a single junk row inside a readable
    // envelope must not throw, because the alternative is an empty page for one bad id.
    const junk = [undefined, null, {}, { checkId: '' }] as unknown as Finding[]
    expect(() => questionCoverage(junk)).not.toThrow()
    expect(questionCoverage(junk).activeRows).toBe(ACTIVE_ROWS)
  })
})

describe('the registry seen through the questions', () => {
  it('tags every registered check with a question', () => {
    // A detector whose id is not in the rubric cannot be scored (lib/scoring/rubric.ts
    // throws) and would land in unknownCheckIds here. Asserting it up front means the
    // failure surfaces on the check that was added, not on the next audit run.
    for (const check of CHECKS) {
      expect(questionOf(check.id), `${check.id} has no question`).not.toBeNull()
    }
  })

  it('leaves competition entirely unevaluated by the current registry', () => {
    // Not a defect to fix in this slice — it is the finding. The three Tier-1 gaps the
    // research names (visibility, demand, competition) are exactly the questions this
    // pipeline cannot answer yet, and the panel now says so in those words instead of
    // burying it in "8 of 80". If a later slice registers a competition detector, this
    // assertion is meant to fail and be rewritten.
    const report = questionCoverage(CHECKS.map((c) => finding(c.id, 'fail')))
    const competition = report.questions.find((q) => q.key === 'competition')!

    expect(competition.evaluated).toEqual([])
    expect(competition.total).toBeGreaterThan(0)
    expect(summariseQuestion(competition)).toContain('not measured')
  })
})

describe('summariseQuestion', () => {
  it('says "not measured" rather than a zero when nothing was evaluated', () => {
    const report = questionCoverage([])
    const conversion = report.questions.find((q) => q.key === 'conversion')!

    // "0 of 10" is easy to read past; "not measured" is not, which is the entire reason
    // this helper exists rather than the renderers formatting counts themselves.
    const text = summariseQuestion(conversion)
    expect(text).toContain('not measured')
    expect(text).toContain(String(conversion.total))
  })

  it('distinguishes never-attempted from attempted-and-unanswerable', () => {
    const attempted = questionCoverage([finding('CRO-001', 'not_run')]).questions.find(
      (q) => q.key === 'conversion',
    )!
    expect(summariseQuestion(attempted)).toContain('attempted')

    const untouched = questionCoverage([]).questions.find((q) => q.key === 'conversion')!
    expect(summariseQuestion(untouched)).not.toContain('attempted')
  })

  it('reports the fraction once something was evaluated', () => {
    const report = questionCoverage([finding('MEAS-001', 'fail')])
    const measurement = report.questions.find((q) => q.key === 'measurement')!
    expect(summariseQuestion(measurement)).toBe(`1 of ${measurement.total} evaluated`)
  })
})
