// The measurement-coverage rule, and the three checks that now share it.
//
// The gap this closes: the four-state model was airtight at the STATION level (a failed
// or empty station forces not_run) and leaking at the FIELD level, where a signal the
// crawl never measured was indistinguishable from a measured value. The two directions
// were also inconsistent — TECH-011 invented `true` and reported pass, MEAS-001 invented
// `false` and reported fail — so both a false negative and a false positive shipped from
// the same underlying defect.
import { describe, it, expect } from 'vitest'
import {
  coverageCaveat,
  coverageReason,
  coverageStatus,
  partitionMeasured,
} from '@/lib/findings/coverage'
import { CHECKS } from '@/lib/findings/checks'
import { runChecks } from '@/lib/findings/engine'
import type { CrawlPageRecord, CrawlSiteRecord } from '@/lib/tools/crawl-record'
import type { StationBundle } from '@/lib/findings/types'
import { toolOk } from '@/lib/tools/contract'

describe('coverageStatus', () => {
  it('reports a real defect as fail even when coverage is partial', () => {
    // A found defect outranks a coverage caveat; the caveat rides in the detail.
    expect(coverageStatus({ measured: 5, unmeasured: 5, affected: 2 })).toBe('fail')
  })

  it('reports not_run when nothing was measured — never pass', () => {
    const status = coverageStatus({ measured: 0, unmeasured: 10, affected: 0 })
    expect(status).toBe('not_run')
    expect(status).not.toBe('pass')
  })

  it('reports degraded when the result is clean but coverage is partial', () => {
    expect(coverageStatus({ measured: 8, unmeasured: 2, affected: 0 })).toBe('degraded')
  })

  it('reports pass only when everything was measured and nothing failed', () => {
    expect(coverageStatus({ measured: 10, unmeasured: 0, affected: 0 })).toBe('pass')
  })
})

describe('coverageCaveat / coverageReason', () => {
  it('names the excluded pages rather than dropping them silently', () => {
    expect(coverageCaveat(3, 10, 'word count')).toContain('3 of 10')
    expect(coverageCaveat(3, 10, 'word count')).toContain('excluded')
  })

  it('is empty when nothing was excluded', () => {
    expect(coverageCaveat(0, 10, 'word count')).toBe('')
  })

  it('gives no reason for a plain fail or a clean pass', () => {
    expect(coverageReason({ measured: 5, unmeasured: 0, affected: 1 }, 'x')).toBeUndefined()
    expect(coverageReason({ measured: 5, unmeasured: 0, affected: 0 }, 'x')).toBeUndefined()
  })
})

describe('partitionMeasured', () => {
  it('splits on the predicate and keeps both sides', () => {
    const { measured, unmeasured } = partitionMeasured([1, null, 2, null], (v) => v !== null)
    expect(measured).toEqual([1, 2])
    expect(unmeasured).toEqual([null, null])
  })
})

// ── the three checks ────────────────────────────────────────────────────────────

const site = (over: Partial<CrawlSiteRecord> = {}): CrawlSiteRecord => ({
  robotsTxt: null,
  sitemapUrls: [],
  robotsTxtStatus: 'not-found',
  ...over,
})

const pg = (over: Partial<CrawlPageRecord> = {}): CrawlPageRecord => ({
  url: 'https://x.com/a',
  status: 200,
  title: 't',
  metaDescription: 'd',
  h1s: ['h'],
  canonical: null,
  robotsMeta: '',
  hasViewportMeta: true,
  tapTargetsOk: true,
  analytics: { ga4: true, gtm: true },
  internalLinksOut: 1,
  internalLinksIn: 1,
  wordCount: 900,
  uniqueWordCount: 800,
  templateGroup: null,
  targetGeo: null,
  ...over,
})

const bundle = (pages: CrawlPageRecord[], s: CrawlSiteRecord = site()): StationBundle =>
  ({ crawl: toolOk({ site: s, pages }, { sources: ['crawl'] }) }) as StationBundle

const run = (id: string, pages: CrawlPageRecord[], s?: CrawlSiteRecord) =>
  runChecks(
    CHECKS.filter((c) => c.id === id),
    bundle(pages, s),
  )[0]

describe('TECH-001: never-fetched is not the same as none-served', () => {
  it('is not_run when the crawl never fetched robots.txt', () => {
    const f = run('TECH-001', [pg()], site({ robotsTxtStatus: 'not-fetched' }))
    expect(f.status).toBe('not_run')
    expect(f.status).not.toBe('pass')
    expect(f.reason).toMatch(/did not fetch/)
  })

  it('is pass when the site genuinely serves none', () => {
    const f = run('TECH-001', [pg()], site({ robotsTxtStatus: 'not-found' }))
    expect(f.status).toBe('pass')
  })
})

describe('TECH-011: unmeasured mobile data never reads as passing', () => {
  it('is not_run when no page carried mobile-rendering data', () => {
    const pages = [pg({ hasViewportMeta: null, tapTargetsOk: null })]
    const f = run('TECH-011', pages)
    expect(f.status).toBe('not_run')
    expect(f.evidence.affectedUrls).toBeUndefined()
  })

  it('is degraded when some pages were measured and all of those are fine', () => {
    const pages = [pg(), pg({ url: 'https://x.com/b', hasViewportMeta: null, tapTargetsOk: null })]
    const f = run('TECH-011', pages)
    expect(f.status).toBe('degraded')
    expect(f.evidence.detail).toMatch(/1 of 2 pages carried no mobile-rendering data/)
  })

  it('still fails on a real defect, and names the excluded pages', () => {
    const pages = [
      pg({ tapTargetsOk: false }),
      pg({ url: 'https://x.com/b', hasViewportMeta: null, tapTargetsOk: null }),
    ]
    const f = run('TECH-011', pages)
    expect(f.status).toBe('fail')
    expect(f.evidence.affectedUrls).toBe(1)
    expect(f.evidence.detail).toMatch(/carried no mobile-rendering data/)
  })

  it('is pass only when every page was measured', () => {
    expect(run('TECH-011', [pg(), pg({ url: 'https://x.com/b' })]).status).toBe('pass')
  })
})

describe('MEAS-001: unmeasured analytics no longer reads as broken analytics', () => {
  it('is not_run when no page carried analytics data — it used to report fail', () => {
    const pages = [pg({ analytics: { ga4: null, gtm: null } })]
    const f = run('MEAS-001', pages)
    expect(f.status).toBe('not_run')
    expect(f.status).not.toBe('fail')
  })

  it('is degraded when the measured pages are all tagged but some were not measured', () => {
    const pages = [pg(), pg({ url: 'https://x.com/b', analytics: { ga4: null, gtm: null } })]
    expect(run('MEAS-001', pages).status).toBe('degraded')
  })

  it('still fails on genuinely untagged pages', () => {
    const pages = [pg({ analytics: { ga4: false, gtm: false } })]
    const f = run('MEAS-001', pages)
    expect(f.status).toBe('fail')
    expect(f.evidence.affectedUrls).toBe(1)
  })

  it('measures the untagged share against MEASURED pages, not all pages', () => {
    // 1 untagged of 2 measured is 50%, not 1 of 3 (33%) — the majority-untagged branch
    // must not be diluted by pages nobody looked at.
    const pages = [
      pg({ analytics: { ga4: false, gtm: false } }),
      pg({ url: 'https://x.com/b' }),
      pg({ url: 'https://x.com/c', analytics: { ga4: null, gtm: null } }),
    ]
    const f = run('MEAS-001', pages)
    expect(f.status).toBe('fail')
    expect(f.evidence.detail).toMatch(/1 of 2 measured pages/)
  })
})
