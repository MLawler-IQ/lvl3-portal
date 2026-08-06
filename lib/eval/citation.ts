// Citation validity for drafted recommendations — the mechanical definition of
// "precision" the eval uses until real negative labels accumulate.
//
// Deliberately named citation-validity, not precision: on a defect fixture almost
// any finding-anchored recommendation cites SOMETHING from the manifest, so a true
// precision number needs negative labels (must_not_find hits, review-gate
// rejections). This measures what can be measured honestly today:
//
//   - every recommendation cites at least one finding id that exists in the run
//   - none cites a must_not_find check
//   - each recommendation quotes at least one concrete evidence value (the
//     vacuity guard: numberless, citation-thin prose is not a valid draft)
//
// No consumer yet — synthesis is phase 5. It lands now because the plan's rule is
// that the metric definitions predate the thing they measure.

import type { Finding } from '@/lib/findings/types'
import type { EvalManifest } from './manifest'

export interface DraftRecommendation {
  title: string
  body: string
  /** Findings this recommendation is grounded in. */
  findingIds: string[]
}

export interface CitationViolation {
  index: number
  reason: string
}

export function citationValidity(
  recommendations: DraftRecommendation[],
  findings: Finding[],
  manifest: EvalManifest,
): { valid: boolean; violations: CitationViolation[] } {
  const known = new Map(findings.map((f) => [f.checkId, f]))
  const forbidden = new Set(manifest.must_not_find)
  const violations: CitationViolation[] = []

  recommendations.forEach((rec, index) => {
    if (rec.findingIds.length === 0) {
      violations.push({ index, reason: 'cites no findings at all' })
      return
    }
    const unknown = rec.findingIds.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      violations.push({
        index,
        reason: `cites findings that do not exist in the run: ${unknown.join(', ')}`,
      })
    }
    const banned = rec.findingIds.filter((id) => forbidden.has(id))
    if (banned.length > 0) {
      violations.push({
        index,
        reason: `cites must_not_find checks: ${banned.join(', ')}`,
      })
    }
    // Vacuity guard: at least one number from the cited evidence must appear in
    // the body. Derived numbers are forbidden in drafts by policy, so a straight
    // string match is the right fidelity.
    const evidenceNumbers = rec.findingIds
      .map((id) => known.get(id))
      .filter((f): f is Finding => Boolean(f))
      .flatMap((f) => [f.evidence.affectedUrls, f.evidence.value])
      .filter((n): n is number => typeof n === 'number')
    if (evidenceNumbers.length > 0 && !evidenceNumbers.some((n) => rec.body.includes(String(n)))) {
      violations.push({
        index,
        reason: 'quotes none of the evidence values from the findings it cites',
      })
    }
  })

  return { valid: violations.length === 0, violations }
}
