// The question panel, rendered.
//
// WHY A DOM TEST, when tests/unit/audit-questions.test.ts already pins the arithmetic:
// slice 1's deliverable is a SCREEN — "the result view leads with seven question rows" —
// and a pure test of the coverage function cannot fail if the panel is never mounted. The
// 2026-08-07 session log names that failure three times over: a change that compiled,
// passed its tests, and was never invoked, because "absence has no error". `/tools/audit`
// itself shipped unreachable for exactly this reason.
//
// It is also the only automated proof available. The panel sits behind requireAdmin() on a
// page that needs a selected client and a stored run, so nobody can eyeball it without
// logging in, and CLAUDE.md puts live checks on Matt.
//
// This is the first *.test.tsx in the repo. The infrastructure was already here and
// unused — vitest.config.ts includes the pattern, installs the react plugin, and sets
// jsdom — which is the same shape of dead wiring, one level up.

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AuditResultView from '@/components/audit/AuditResultView'
import type { AuditSummary } from '@/components/audit/AuditResultView'
import type { Finding, FindingStatus } from '@/lib/findings/types'
import { QUESTIONS, questionCoverage } from '@/lib/audit/questions'

afterEach(cleanup)

function finding(checkId: string, status: FindingStatus): Finding {
  return { checkId, status, evidence: { detail: `${checkId} ${status}` }, source: 'crawl' }
}

function summary(findings: Finding[] = []): AuditSummary {
  return { status: 'complete', configVersion: 'scoring-test.1', findings }
}

describe('AuditResultView question panel', () => {
  it('asks all seven questions in words, not as a criteria count', () => {
    render(<AuditResultView summary={summary()} />)

    for (const q of QUESTIONS) {
      expect(screen.getByText(q.question), `question ${q.key} is not on the screen`).toBeTruthy()
    }
  })

  it('gives every question its own denominator on its own row', () => {
    // The regression this guards is the panel collapsing back to one global fraction. A
    // single count cannot say "competition: 9 criteria, none evaluated" — and it is the
    // per-question denominator, not the global one, that makes the gap actionable. Asserted
    // per ROW rather than per document, because "9" appearing somewhere on the page would
    // pass even if every denominator were replaced by one total.
    const report = questionCoverage([])
    render(<AuditResultView summary={summary()} />)

    for (const q of report.questions) {
      const row = screen.getByText(q.question).closest('tr')
      expect(row, `no row for ${q.key}`).toBeTruthy()
      const cells = Array.from(row!.querySelectorAll('td')).map((td) => td.textContent?.trim())
      expect(cells, `${q.key} row does not carry its own total`).toContain(String(q.total))
    }
  })

  it('leads with the questions, before the findings table', () => {
    // Position is the argument. A reader who meets eight finding rows first reads them as
    // the audit rather than as the sliver of it that could run.
    const { container } = render(<AuditResultView summary={summary([finding('TECH-001', 'fail')])} />)
    const text = container.textContent ?? ''

    expect(text.indexOf('What this run answers')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('What this run answers')).toBeLessThan(text.indexOf('Findings'))
  })

  it('says "not measured" rather than a zero for a question nothing evaluated', () => {
    render(<AuditResultView summary={summary()} />)

    // Every question is unevaluated on an empty run, so all seven verdicts say so. A "0"
    // in a table cell is easy to read past; this sentence is not.
    expect(screen.getAllByText(/not measured/).length).toBe(QUESTIONS.length)
  })

  it('keeps every denominator on screen when the run evaluated nothing', () => {
    // The rule the whole panel exists for: an empty run does not get to look small.
    render(<AuditResultView summary={summary()} />)
    // 70 active plus 10 retired since the slice-2 re-cut; the retired ten are counted in no
    // denominator and the sentence says so.
    expect(
      screen.getByText(/70 active criteria across 7 questions, plus 10 retired/),
    ).toBeTruthy()
  })

  it('reports a fraction once something was evaluated, and only for that question', () => {
    render(<AuditResultView summary={summary([finding('MEAS-001', 'fail')])} />)

    // 'of 6', not 'of 7': MEAS-006 (GSC generative-AI monitoring) was retired by the re-cut.
    expect(screen.getByText('1 of 6 evaluated')).toBeTruthy()
    expect(screen.getAllByText(/not measured/).length).toBe(QUESTIONS.length - 1)
  })

  it('separates a check that could not answer from one nothing evaluated', () => {
    // not_run is "we attempted and could not answer" — a distinct claim from silence, and
    // the panel must not render them as the same cell.
    render(<AuditResultView summary={summary([finding('LOCAL-016', 'not_run')])} />)
    expect(screen.getByText(/1 of 14 attempted/)).toBeTruthy()
  })

  it('names a finding whose check id is in no rubric row', () => {
    render(<AuditResultView summary={summary([finding('MADE-UP-001', 'fail')])} />)

    // Scoped to the panel's own warning: the id is legitimately on screen twice, because
    // the findings table renders the finding too. Asserting it globally would pass on the
    // findings row alone and prove nothing about the panel.
    const warning = screen.getByText(/in no rubric row/)
    expect(warning.textContent).toContain('MADE-UP-001')
  })

  it('renders on a summary with no findings key at all', () => {
    // The view takes a widened shape because the same object may have round-tripped through
    // audit_runs.result jsonb. A stored run written before this panel existed must still
    // render it, not throw.
    expect(() => render(<AuditResultView summary={{ status: 'partial' }} />)).not.toThrow()
    expect(screen.getByText(/70 active criteria/)).toBeTruthy()
  })
})
