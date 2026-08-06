// The recorded real-export figures, checked against live code.
//
// WHAT THIS CAN AND CANNOT DO. The real 206-URL export is client data and is not
// committed, so no test can reproduce its numbers here. What a test CAN do is stop the
// record from quietly ceasing to describe the code it is about: a renamed detector, a
// renamed `bump()` key, or one figure edited without the others it implies. Before this
// file the record was a literal asserting two of its own fields, so none of those were
// caught.
//
// The one genuinely non-circular claim is the last describe: `bump('internalLinksOut')` is
// unconditional, so `unmeasured.internalLinksOut === urls` on EVERY export. That is
// asserted against both the record and a live ingest, and it is the premise the whole
// degradation rule rests on — if it ever stopped holding, degrading on `unmeasured` would
// stop being obviously wrong.
//
// Reproducing the figures themselves is Matt-side:
//   node --import ./scripts/ts-alias-hook.mjs scripts/audit-dry-run.ts <dir> --compare
// which reads this same file and exits 2 on a mismatch.

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import recorded from '@/fixtures/ingest/recorded-real-export.json'
import { CHECK_IDS } from '@/lib/findings/checks'
import { ingestSitebulbCrawl } from '@/lib/ingest/sitebulb/crawl'
import { LocalDirSource } from '@/lib/ingest/sitebulb/source'
import type { FindingStatus } from '@/lib/findings/types'

const MINI = join(__dirname, '..', '..', 'fixtures', 'ingest', 'sitebulb-mini')

const STATUSES: FindingStatus[] = ['pass', 'fail', 'degraded', 'not_run']

/**
 * Every signal name the ingester can put in `unmeasured`.
 *
 * Hand-listed rather than derived, deliberately: the point is to fail when a `bump()` key
 * is renamed, and a derived list would rename itself alongside it.
 */
const EMITTABLE_SIGNALS = new Set([
  'wordCount',
  'hasViewportMeta',
  'tapTargetsOk',
  'analytics.ga4',
  'analytics.gtm',
  'canonical',
  'internalLinksOut',
])

describe('the recorded export still describes registered checks', () => {
  it('names only checks that exist in CHECKS', () => {
    for (const id of Object.keys(recorded.checks)) {
      expect(CHECK_IDS.has(id), `${id} is in the record but not registered`).toBe(true)
    }
  })

  it('records only real finding statuses', () => {
    for (const [id, entry] of Object.entries(recorded.checks)) {
      expect(STATUSES, id).toContain(entry.status)
    }
  })
})

describe('the recorded unmeasured map names signals the ingester can emit', () => {
  it('uses only live bump() keys', () => {
    for (const signal of Object.keys(recorded.unmeasured)) {
      expect(EMITTABLE_SIGNALS.has(signal), `${signal} is not a signal crawl.ts bumps`).toBe(true)
    }
  })

  it('agrees with the keys a real ingest actually produces', async () => {
    // The mini fixture cannot exercise every signal, but every signal it DOES produce
    // must be one this test's vocabulary knows about — otherwise the guard above is
    // checking the record against a stale list.
    const { coverage } = await ingestSitebulbCrawl(LocalDirSource(MINI))
    for (const signal of Object.keys(coverage.unmeasured)) {
      expect(EMITTABLE_SIGNALS.has(signal), `${signal} is emitted but not in the vocabulary`).toBe(
        true,
      )
    }
  })
})

describe('the recorded figures are internally coherent', () => {
  it('accounts for ONPAGE-003 as the zero-H1 pages plus the several-H1 pages', () => {
    // §9's explanation of 194: 191 with none + 3 with several. If someone edits
    // zeroH1Pages without the affected count, this is what notices.
    expect(recorded.checks['ONPAGE-003'].affected).toBe(recorded.zeroH1Pages + 3)
  })

  it('never claims more measured pages than there are URLs', () => {
    expect(recorded.pagesWithMeasuredWords).toBeLessThanOrEqual(recorded.urls)
    expect(recorded.untaggedPages).toBeLessThanOrEqual(recorded.urls)
    expect(recorded.checks['TECH-011'].affected).toBeLessThanOrEqual(
      recorded.checks['TECH-011'].measured,
    )
  })

  it('ties each check to the denominator it was measured against', () => {
    // TECH-011 excludes the 4 pages missing from mobile_friendly.csv; MEAS-001 is
    // measured against the full backbone. Those two denominators differing is the
    // point of the four-state model, so pin them.
    expect(recorded.checks['TECH-011'].measured).toBe(recorded.pagesWithMeasuredWords)
    expect(recorded.checks['MEAS-001'].measured).toBe(recorded.urls)
    expect(recorded.checks['MEAS-001'].affected).toBe(recorded.untaggedPages)
    expect(recorded.unmeasured.hasViewportMeta).toBe(recorded.urls - recorded.checks['TECH-011'].measured)
  })

  it('keeps the uniqueShare quantiles ordered and inside (0, 1)', () => {
    const { min, median, max } = recorded.uniqueShare
    expect(min).toBeGreaterThan(0)
    expect(min).toBeLessThan(median)
    expect(median).toBeLessThan(max)
    expect(max).toBeLessThan(1)
  })
})

describe('the unconditional internalLinksOut bump', () => {
  // THE LOAD-BEARING PREMISE. crawl.ts bumps 'internalLinksOut' for every page with no
  // condition, because no export shape carries an outbound-link column. So
  // unmeasured.internalLinksOut equals the page count on every export, forever — which is
  // why lib/stations/degradation.ts keys off filesMissing and never off unmeasured.
  // Degrading on unmeasured would make the crawl station permanently degraded, and then no
  // crawl-backed check could ever return `pass` (lib/findings/engine.ts).

  it('holds on the recorded real export', () => {
    expect(recorded.unmeasured.internalLinksOut).toBe(recorded.urls)
  })

  it('holds on a live ingest of the committed fixture', async () => {
    const { coverage } = await ingestSitebulbCrawl(LocalDirSource(MINI))
    expect(coverage.unmeasured.internalLinksOut).toBe(coverage.urls)
  })
})
