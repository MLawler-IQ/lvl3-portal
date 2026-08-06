// The crawl degradation rule.
//
// This file exists for one assertion, and the rest is scaffolding around it: a non-empty
// `unmeasured` map, on its own, must NOT degrade the station. If that ever flips, the crawl
// station becomes permanently degraded (crawl.ts bumps 'internalLinksOut' for every page
// unconditionally, so unmeasured.internalLinksOut always equals the page count), and
// lib/findings/engine.ts caps a pass on a degraded station at `degraded` — so no
// crawl-backed check could ever return `pass` again, on any client, with no error anywhere.

import { describe, expect, it } from 'vitest'
import { crawlDegradation } from '@/lib/stations/degradation'
import { SOURCES, type SitebulbCoverage } from '@/lib/ingest/sitebulb/crawl'

/** A coverage record with everything read and nothing missing. */
function coverage(over: Partial<SitebulbCoverage> = {}): SitebulbCoverage {
  return {
    urls: 206,
    filesRead: ['internal', 'indexability', 'mobile_friendly'],
    filesMissing: [],
    unmeasured: {},
    ...over,
  }
}

/** The real export's unmeasured map, recorded on the 206-URL tornadohvacca.com crawl. */
const REAL_UNMEASURED = {
  internalLinksOut: 206,
  hasViewportMeta: 4,
  tapTargetsOk: 4,
  canonical: 4,
}

describe('unmeasured signals never degrade the station', () => {
  it('leaves a complete export undegraded despite the real export unmeasured map', () => {
    // The exact shape the real 206-URL export produces. This is the regression that
    // would cost every crawl-backed check its ability to pass.
    const { degraded } = crawlDegradation(coverage({ unmeasured: REAL_UNMEASURED }))
    expect(degraded).toBe(false)
  })

  it.each([
    ['the unconditional bump alone', { internalLinksOut: 206 }],
    ['every signal at once', { ...REAL_UNMEASURED, wordCount: 4, 'analytics.gtm': 206 }],
    ['a signal unmeasured on every single page', { canonical: 206 }],
    ['the committed mini fixture shape', { internalLinksOut: 6, 'analytics.gtm': 6 }],
    ['an empty map', {}],
  ])('stays undegraded with %s', (_label, unmeasured) => {
    expect(crawlDegradation(coverage({ unmeasured })).degraded).toBe(false)
  })

  it('gives an identical verdict whether unmeasured is empty or full', () => {
    const bare = crawlDegradation(coverage({ filesMissing: [SOURCES.mobile] }))
    const full = crawlDegradation(
      coverage({ filesMissing: [SOURCES.mobile], unmeasured: REAL_UNMEASURED }),
    )
    expect(full.degraded).toBe(bare.degraded)
    // The notes differ (the coverage sentence is added) but the flag cannot.
    expect(full.notes[0]).toBe(bare.notes[0])
  })

  it('still reports the gaps in a note, because honesty is the notes’ job', () => {
    const { notes } = crawlDegradation(coverage({ unmeasured: REAL_UNMEASURED }))
    const joined = notes.join(' ')
    expect(joined).toMatch(/Not measured on every page/)
    expect(joined).toMatch(/internalLinksOut \(206 of 206\)/)
    expect(joined).toMatch(/hasViewportMeta \(4 of 206\)/)
  })

  it('emits ONE aggregate coverage sentence, not one note per signal', () => {
    // Four signals, four notes would make the station strip a wall of text that
    // never changes — internalLinksOut is unmeasured on every export by construction.
    const { notes } = crawlDegradation(coverage({ unmeasured: REAL_UNMEASURED }))
    expect(notes).toHaveLength(1)
  })

  it('orders the coverage sentence deterministically so two runs match', () => {
    const forward = crawlDegradation(
      coverage({ unmeasured: { canonical: 4, internalLinksOut: 206, tapTargetsOk: 4 } }),
    )
    const reversed = crawlDegradation(
      coverage({ unmeasured: { tapTargetsOk: 4, internalLinksOut: 206, canonical: 4 } }),
    )
    expect(forward.notes).toEqual(reversed.notes)
    // Largest gap first, then alphabetical.
    expect(forward.notes[0]).toMatch(
      /internalLinksOut \(206 of 206\), canonical \(4 of 206\), tapTargetsOk \(4 of 206\)/,
    )
  })

  it('omits the coverage sentence entirely when nothing was unmeasured', () => {
    expect(crawlDegradation(coverage()).notes).toEqual([])
  })
})

describe('a missing file degrades, and the note names it', () => {
  it('degrades when the mobile-friendly export is absent', () => {
    const { degraded, notes } = crawlDegradation(coverage({ filesMissing: [SOURCES.mobile] }))
    expect(degraded).toBe(true)
    expect(notes[0]).toMatch(/mobile-friendly export is missing/)
    // The check it costs, named — otherwise "degraded" is a flag with no consequence.
    expect(notes[0]).toMatch(/viewport and tap-target/)
  })

  it('degrades when the indexability export is absent, naming what it cost', () => {
    const { degraded, notes } = crawlDegradation(
      coverage({ filesMissing: [SOURCES.indexability] }),
    )
    expect(degraded).toBe(true)
    expect(notes[0]).toMatch(/indexability export is missing/)
    expect(notes[0]).toMatch(/canonical URLs and robots meta/)
  })

  it('names every missing file when more than one is absent', () => {
    const { degraded, notes } = crawlDegradation(
      coverage({ filesMissing: [SOURCES.indexability, SOURCES.mobile] }),
    )
    expect(degraded).toBe(true)
    expect(notes.filter((n) => n.includes('is missing'))).toHaveLength(2)
  })

  it('still produces a note for a file the vocabulary does not know', () => {
    // A silent degradation is worse than a generic sentence.
    const { degraded, notes } = crawlDegradation(coverage({ filesMissing: ['structured_data'] }))
    expect(degraded).toBe(true)
    expect(notes[0]).toMatch(/structured_data export is missing/)
  })
})

describe('manifest problems are notes, never a degradation', () => {
  it('reports a missing summary workbook without degrading', () => {
    // The mini fixture has no summary.xlsx, so readSitebulbManifest ALWAYS returns a
    // problem for it. Wire notes to the flag and the committed fixture becomes
    // permanently degraded — the same regression, arriving through the back door.
    const problems = ['summary.xlsx is absent: an untriggered hint cannot be told apart…']
    const { degraded, notes } = crawlDegradation(coverage(), problems)
    expect(degraded).toBe(false)
    expect(notes).toEqual(problems)
  })

  it('keeps the missing-file notes ahead of the manifest problems', () => {
    const { notes } = crawlDegradation(coverage({ filesMissing: [SOURCES.mobile] }), ['a problem'])
    expect(notes[0]).toMatch(/mobile-friendly/)
    expect(notes[1]).toBe('a problem')
  })

  it('passes problems through verbatim rather than rewording them', () => {
    // They are already client-readable by their own contract in manifest.ts.
    const problems = ['one', 'two', 'three']
    expect(crawlDegradation(coverage(), problems).notes).toEqual(problems)
  })
})

describe('the filesMissing vocabulary', () => {
  it('is exactly the three files crawl.ts reads', () => {
    // If a fourth export file is added, this fails — which is the point. The new file
    // needs a MISSING_FILE_NOTES entry saying what its absence costs, or the station
    // degrades with a generic sentence and nobody notices the check it silenced.
    expect(new Set(Object.values(SOURCES))).toEqual(
      new Set(['internal', 'indexability', 'mobile_friendly']),
    )
  })

  it('cannot report the backbone as missing, because that is an error not a degradation', () => {
    // crawl.ts throws when internal.csv is absent; it never reaches filesMissing.
    // The station turns that throw into a ToolErr, and every check reads not_run.
    const { degraded, notes } = crawlDegradation(coverage())
    expect(degraded).toBe(false)
    expect(notes.join(' ')).not.toMatch(/internal export is missing/)
  })
})
