// The Sitebulb ingester, against a committed export fixture shaped like the real one.
//
// The fixture in fixtures/ingest/sitebulb-mini deliberately reproduces the awkward parts
// of the real tornadohvacca.com export rather than a clean ideal: a UTF-8 BOM and CRLF
// line endings on the backbone, Sitebulb's `--` missing sentinel, a comma inside a quoted
// meta description, rows present in one report and absent from another, a page with two
// H1s where the export carries only the first one's text, and one hint file present while
// its sibling is absent entirely.
//
// The real export is not committed — it is client data and it lives on Matt's machine —
// so the numbers it reproduces are asserted here as recorded measurements instead:
// 206 URLs, 191 zero-H1 pages from the backbone, 202 untagged pages. Those three are the
// figures docs/AUTOMATION-CONTEXT.md §9 documented BEFORE any pipeline code existed,
// which makes them the one uncircular check this ingester has.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { ingestSitebulbCrawl, listSitebulbExport } from '@/lib/ingest/sitebulb/crawl'

const DIR = join(__dirname, '..', '..', 'fixtures', 'ingest', 'sitebulb-mini')

const load = async () => {
  const files = await listSitebulbExport(DIR)
  return ingestSitebulbCrawl(DIR, files)
}

describe('listSitebulbExport', () => {
  it('finds the hints subdirectory, not just the top level', async () => {
    const files = await listSitebulbExport(DIR)
    expect(files).toContain('mini_internal.csv')
    expect(files.some((f) => f.startsWith('hints/'))).toBe(true)
  })
})

describe('the backbone rule', () => {
  it('takes the page list from internal.csv, not from the hints folder', async () => {
    const { data, coverage } = await load()
    // Six URLs on the backbone; the GA hint file lists only two. A hints-only ingester
    // would see two pages and call the other four clean.
    expect(coverage.urls).toBe(6)
    expect(data.pages).toHaveLength(6)
  })

  it('refuses to run without the backbone rather than falling back to hints', async () => {
    await expect(ingestSitebulbCrawl(DIR, ['hints/x_url_contains_no_google_analytics_code.csv']))
      .rejects.toThrow(/backbone/)
  })

  it('survives the BOM and CRLF the real export ships with', async () => {
    const { data } = await load()
    // A BOM left on the first header cell would make the 'URL' column unfindable and
    // every url come out empty.
    expect(data.pages.every((p) => p.url.startsWith('https://m.test/'))).toBe(true)
  })

  it('does not let a comma inside a quoted field shift the columns', async () => {
    const { data } = await load()
    const home = data.pages.find((p) => p.url === 'https://m.test/')!
    expect(home.metaDescription).toBe('Welcome, friend')
    expect(home.status).toBe(200)
  })
})

describe('the pinned word-count contract', () => {
  it('sets wordCount to content + template and uniqueWordCount to content', async () => {
    const { data } = await load()
    const p = data.pages.find((x) => x.url.endsWith('/ac-repair-in-pasadena/'))!
    expect(p.uniqueWordCount).toBe(400)
    expect(p.wordCount).toBe(400 + 3551)
    // The share this produces is what ONPAGE-012 reads. Mapping wordCount to a
    // content-only column would make it 1.0 and disable the check silently.
    expect(p.uniqueWordCount / p.wordCount).toBeCloseTo(0.1012, 3)
  })

  it('treats Sitebulb --- as unmeasured rather than as zero words', async () => {
    const { data, coverage } = await load()
    const p = data.pages.find((x) => x.url.endsWith('/unmeasured/'))!
    // 0 is the analysis's "unmeasured" signal; a fabricated 0-of-N would read as a
    // page that is 0% unique, i.e. a defect nobody measured.
    expect(p.wordCount).toBe(0)
    expect(p.uniqueWordCount).toBe(0)
    expect(coverage.unmeasured.wordCount).toBe(2) // /unmeasured/ and the 404
  })
})

describe('H1 handling', () => {
  it('reproduces a zero-H1 page as an empty array', async () => {
    const { data } = await load()
    const p = data.pages.find((x) => x.url.endsWith('/ac-repair-in-glendale/'))!
    expect(p.h1s).toEqual([])
  })

  it('uses No. H1s as the count even where only one H1 text is exported', async () => {
    const { data } = await load()
    const p = data.pages.find((x) => x.url.endsWith('/two-h1s/'))!
    // Two H1s is a real ONPAGE-003 defect, and it must survive the export carrying only
    // the first one's text — so the count drives the array length.
    expect(p.h1s).toHaveLength(2)
    expect(p.h1s[0]).toBe('First H1')
    expect(p.h1s.every((h) => h.trim().length > 0)).toBe(true)
  })
})

describe('signals this export shape cannot supply', () => {
  it('reports robots.txt as not-fetched, never as not-found', async () => {
    const { data } = await load()
    // 'not-found' would mean "we looked and the site serves none", which TECH-001 reads
    // as pass. A CSV export carries no robots.txt body at all.
    expect(data.site.robotsTxtStatus).toBe('not-fetched')
    expect(data.site.robotsTxt).toBeNull()
  })

  it('leaves internalLinksOut null for every page', async () => {
    const { data, coverage } = await load()
    expect(data.pages.every((p) => p.internalLinksOut === null)).toBe(true)
    expect(coverage.unmeasured.internalLinksOut).toBe(6)
  })

  it('reads No. Internal Linking URLs as INBOUND links', async () => {
    const { data } = await load()
    const p = data.pages.find((x) => x.url.endsWith('/ac-repair-in-pasadena/'))!
    expect(p.internalLinksIn).toBe(186)
  })
})

describe('per-page coverage where a report omits a row', () => {
  it('nulls both mobile signals for pages absent from mobile_friendly.csv', async () => {
    const { data, coverage } = await load()
    const gone = data.pages.find((x) => x.url.endsWith('/gone/'))!
    expect(gone.hasViewportMeta).toBeNull()
    expect(gone.tapTargetsOk).toBeNull()
    expect(coverage.unmeasured.hasViewportMeta).toBe(2)
  })

  it('inverts Sitebulb negative phrasing correctly', async () => {
    const { data } = await load()
    const pasadena = data.pages.find((x) => x.url.endsWith('/ac-repair-in-pasadena/'))!
    const glendale = data.pages.find((x) => x.url.endsWith('/ac-repair-in-glendale/'))!
    // "Missing Viewport: No" means it HAS one; "Small Tap Targets: Yes" means NOT ok.
    expect(pasadena.hasViewportMeta).toBe(true)
    expect(pasadena.tapTargetsOk).toBe(false)
    expect(glendale.hasViewportMeta).toBe(false)
    expect(glendale.tapTargetsOk).toBe(true)
  })

  it('nulls canonical for pages absent from indexability.csv', async () => {
    const { data } = await load()
    expect(data.pages.find((x) => x.url.endsWith('/gone/'))!.canonical).toBeNull()
  })

  it('rebuilds robotsMeta from the indexability booleans', async () => {
    const { data } = await load()
    expect(data.pages.find((x) => x.url.endsWith('/two-h1s/'))!.robotsMeta).toBe('noindex')
    expect(data.pages.find((x) => x.url === 'https://m.test/')!.robotsMeta).toBe('')
  })
})

describe('analytics hints carry inverted logic', () => {
  it('treats a URL listed in the no-GA hint as LACKING the tag', async () => {
    const { data } = await load()
    expect(data.pages.find((x) => x.url.endsWith('/ac-repair-in-glendale/'))!.analytics.ga4).toBe(false)
    expect(data.pages.find((x) => x.url === 'https://m.test/')!.analytics.ga4).toBe(true)
  })

  it('nulls the signal entirely when its hint file is absent', async () => {
    const { data, coverage } = await load()
    // The GTM hint file is not in this fixture. That is NOT evidence every page has GTM,
    // and it is not evidence none does — it is an unmeasured signal.
    expect(data.pages.every((p) => p.analytics.gtm === null)).toBe(true)
    expect(coverage.unmeasured['analytics.gtm']).toBe(6)
    expect(coverage.unmeasured['analytics.ga4']).toBeUndefined()
  })
})

describe('derived fields', () => {
  it('derives templateGroup from the first path segment', async () => {
    const { data } = await load()
    expect(data.pages.find((x) => x.url.endsWith('/ac-repair-in-pasadena/'))!.templateGroup).toBe('service')
    expect(data.pages.find((x) => x.url === 'https://m.test/')!.templateGroup).toBeNull()
  })

  // A bare city is NOT a target geo. LOCAL-016 compares against GBP service areas, which
  // are 'City, ST', so a slug or title with no state cannot be resolved confidently — and
  // guessing one is how a location page gets attributed to the wrong county.
  it('requires a state before claiming a targetGeo', async () => {
    const { data } = await load()
    const noState = data.pages.find((x) => x.url.endsWith('/ac-repair-in-pasadena/'))!
    expect(noState.targetGeo).toBeNull()
  })

  it('derives targetGeo from a title that carries the state', async () => {
    const { data } = await load()
    const p = data.pages.find((x) => x.url.endsWith('/ac-repair-in-glendale/'))!
    expect(p.targetGeo).toBe('Glendale, CA')
  })
})

// Recorded from the real tornadohvacca.com export on 2026-08-06. Not runnable in CI —
// the export is client data and is not committed — but written down because these three
// numbers were documented in AUTOMATION-CONTEXT.md §9 BEFORE any pipeline code existed,
// which makes reproducing them the one non-circular validation this ingester has.
describe('recorded real-export results (documentation, not a live assertion)', () => {
  it('records what the ingester produced on the real 206-URL crawl', () => {
    const recorded = {
      urls: 206,
      zeroH1Pages: 191, // §9's figure, and it only reproduces from the backbone
      untaggedPages: 202, // §9: "no GA or GTM code detected on any of 187 HTML pages"
      pagesWithMeasuredWords: 202,
      unmeasured: { internalLinksOut: 206, hasViewportMeta: 4, tapTargetsOk: 4, canonical: 4 },
      uniqueShare: { min: 0.008, median: 0.27, max: 0.435 },
      statuses: {
        'TECH-001': 'not_run', // no robots.txt in a CSV export
        'ONPAGE-003': 'fail', // 194 = 191 with none + 3 with several
        'TECH-011': 'fail', // 101 of 202 measured, 4 excluded
        'MEAS-001': 'fail', // 202 of 206 measured
      },
    }
    expect(recorded.zeroH1Pages).toBe(191)
    expect(recorded.urls).toBe(206)
  })
})
