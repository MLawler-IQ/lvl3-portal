// THE ONLY PLACE THE CRAWL DEGRADATION RULE LIVES.
//
//   degraded  iff  coverage.filesMissing.length > 0
//
// WHY IT IS NOT `unmeasured`, which is the tempting answer and is wrong. crawl.ts bumps
// 'internalLinksOut' for every page with no condition, because no Sitebulb export shape
// carries an outbound-link column. So `unmeasured.internalLinksOut` equals the page count
// on every export, forever. Degrade on `unmeasured` and the crawl station is PERMANENTLY
// degraded — and lib/findings/engine.ts caps a `pass` on a degraded station at `degraded`,
// so no crawl-backed check could ever return `pass` again. TECH-001, ONPAGE-003, TECH-011
// and MEAS-001 would all lose their clean state, on every client, silently. The
// four-state model would still be there; it would just have three reachable states.
//
// `filesMissing` is the right signal because it can only ever hold a file that BACKS A
// REGISTERED CHECK: crawl.ts pushes to it in exactly two places, for `indexability` and
// `mobile_friendly`, and an untriggered hint never lands there. A missing mobile_friendly
// export genuinely means TECH-011 saw part of the site; a missing outbound-link column
// means nothing was lost, because nothing consumes it.
//
// The rule is computed on the FIRST statement of the body, before `unmeasured` or the
// manifest problems are read at all, so the invariant is carried by control flow rather
// than by this comment.

import { SOURCES, type SitebulbCoverage } from '@/lib/ingest/sitebulb/crawl'

export interface StationDegradation {
  degraded: boolean
  /** Client-readable, in a fixed order. Becomes ToolOk.notes verbatim. */
  notes: string[]
}

/**
 * What each missing file costs, in the words a client would read.
 *
 * Keyed on the only two values `filesMissing` can hold. A test pins that vocabulary
 * against SOURCES, so adding a third export file forces a decision here rather than
 * silently producing a degraded station with no explanation of what was lost.
 */
const MISSING_FILE_NOTES: Readonly<Record<string, string>> = Object.freeze({
  [SOURCES.indexability]:
    'The indexability export is missing, so canonical URLs and robots meta directives could not be read for any page.',
  [SOURCES.mobile]:
    'The mobile-friendly export is missing, so viewport and tap-target checks could not be evaluated on any page.',
})

/**
 * The crawl station's degraded flag and notes.
 *
 * `manifestProblems` are reported but never degrade — a missing summary.xlsx means an
 * untriggered hint cannot be told apart from an unexported one, which is worth saying and
 * is not a partial measurement of anything a registered check reads. The committed mini
 * fixture has no summary workbook, so degrading on it would make that fixture permanently
 * degraded and turn the eval gate red.
 */
export function crawlDegradation(
  coverage: SitebulbCoverage,
  manifestProblems: readonly string[] = [],
): StationDegradation {
  // THE RULE. First statement, from filesMissing alone. Do not add a second term here.
  const degraded = coverage.filesMissing.length > 0

  const notes: string[] = []

  for (const file of coverage.filesMissing) {
    notes.push(
      MISSING_FILE_NOTES[file] ??
        `The ${file} export is missing, so the signals it backs could not be evaluated.`,
    )
  }

  notes.push(...manifestProblems)

  // One aggregate line, not one note per signal. `internalLinksOut` is unmeasured on
  // every export by construction, so a note per signal would make the station strip
  // read as a wall of problems that never changes and never means anything.
  const unmeasuredNote = describeUnmeasured(coverage)
  if (unmeasuredNote !== null) notes.push(unmeasuredNote)

  return { degraded, notes }
}

/**
 * The per-page coverage gaps, as one sentence, or null when there are none.
 *
 * Reported for honesty and NEVER used for the flag. Sorted by count then name so the
 * sentence is stable across runs — an unstable note would make two identical runs produce
 * different persisted station payloads.
 */
function describeUnmeasured(coverage: SitebulbCoverage): string | null {
  const entries = Object.entries(coverage.unmeasured).filter(([, n]) => n > 0)
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const parts = entries.map(([signal, n]) => `${signal} (${n} of ${coverage.urls})`)
  return `Not measured on every page: ${parts.join(', ')}.`
}
