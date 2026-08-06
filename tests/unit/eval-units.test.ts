import { describe, it, expect } from 'vitest'
import { runChecks } from '@/lib/findings/engine'
import { CHECKS } from '@/lib/findings/checks'
import type { CheckDefinition, StationBundle } from '@/lib/findings/types'
import { toolOk, toolErr } from '@/lib/tools/contract'
import { citationValidity } from '@/lib/eval/citation'
import type { EvalManifest } from '@/lib/eval/manifest'
import type { GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'

const check = (id: string) => CHECKS.find((c) => c.id === id)!

const gbpProfile = (over: Partial<GbpProfileRecord> = {}): GbpProfileRecord => ({
  name: 'Test Co',
  primaryCategory: 'Plumber',
  isServiceAreaBusiness: true,
  storefrontAddress: null,
  businessCity: 'Pasadena, CA',
  serviceAreas: ['Altadena, CA'],
  hoursComplete: true,
  phone: '+1-626-555-0100',
  websiteUri: 'https://test.example',
  description: 'desc',
  photoCount: 10,
  rating: 4.8,
  reviewCount: 40,
  ...over,
})

const gscRow = (query: string, page: string, impressions = 100): GSCRow => ({
  query,
  page,
  impressions,
  clicks: 1,
  ctr: 1,
  position: 10,
})

describe('engine station gating', () => {
  const dummy: CheckDefinition = {
    id: 'DUMMY-001',
    requires: ['gsc'],
    absenceType: true,
    evaluate: () => ({
      checkId: 'DUMMY-001',
      status: 'pass',
      evidence: { detail: 'evaluated' },
      source: 'gsc',
    }),
  }

  it('a missing station is not_run, naming the station', () => {
    const [f] = runChecks([dummy], {})
    expect(f.status).toBe('not_run')
    expect(f.reason).toContain('gsc station not provided')
  })

  it('a failed station is not_run with the error, never a pass', () => {
    const [f] = runChecks([dummy], { gsc: toolErr('token expired', { sources: ['gsc'] }) })
    expect(f.status).toBe('not_run')
    expect(f.reason).toContain('token expired')
  })

  it('an empty-success station is not_run — the §17 line', () => {
    const [f] = runChecks([dummy], { gsc: toolOk([], { sources: ['gsc'] }) })
    expect(f.status).toBe('not_run')
    expect(f.reason).toContain('cannot distinguish')
  })

  it('a degraded station caps a pass at degraded', () => {
    const [f] = runChecks([dummy], {
      gsc: toolOk([gscRow('q', '/p')], { sources: ['gsc'], degraded: true }),
    })
    expect(f.status).toBe('degraded')
    expect(f.reason).toContain('partial')
  })

  it('a crashing check becomes not_run, not a thrown error', () => {
    const crasher: CheckDefinition = {
      ...dummy,
      id: 'CRASH-001',
      evaluate: () => {
        throw new Error('boom')
      },
    }
    const [f] = runChecks([crasher], { gsc: toolOk([gscRow('q', '/p')], { sources: ['gsc'] }) })
    expect(f.status).toBe('not_run')
    expect(f.reason).toContain('boom')
  })
})

describe('LOCAL-003: the SAB false-positive guard', () => {
  const run = (profile: GbpProfileRecord) =>
    runChecks([check('LOCAL-003')], { gbp: toolOk(profile, { sources: ['gbp'] }) })[0]

  it('a service-area business with a hidden address is COMPLETE', () => {
    const f = run(gbpProfile())
    expect(f.status).toBe('pass')
    expect(f.evidence.detail).toContain('hidden address is correct')
  })

  it('a storefront business missing its address is incomplete', () => {
    const f = run(gbpProfile({ isServiceAreaBusiness: false }))
    expect(f.status).toBe('fail')
    expect(f.evidence.detail).toContain('storefront address')
  })

  it('an SAB still fails on genuinely missing fields', () => {
    const f = run(gbpProfile({ phone: null, photoCount: 0 }))
    expect(f.status).toBe('fail')
    expect(f.evidence.detail).toContain('phone')
    expect(f.evidence.detail).not.toContain('storefront address')
  })
})

describe('ONPAGE-006: cannibalisation thresholds', () => {
  const run = (rows: GSCRow[]) =>
    runChecks([check('ONPAGE-006')], { gsc: toolOk(rows, { sources: ['gsc'] }) })[0]

  it('ignores rows under the impression floor', () => {
    const f = run([gscRow('same query', '/a', 40), gscRow('same query', '/b', 30)])
    expect(f.status).toBe('pass')
  })

  it('tolerates a single multi-URL query as a possible variant', () => {
    const f = run([
      gscRow('one query', '/a'),
      gscRow('one query', '/b'),
      gscRow('other query', '/c'),
    ])
    expect(f.status).toBe('pass')
  })

  it('fails on a pattern of competing pages, with the cluster count as magnitude', () => {
    const f = run([
      gscRow('q1', '/a'),
      gscRow('q1', '/b'),
      gscRow('q2', '/c'),
      gscRow('q2', '/d'),
    ])
    expect(f.status).toBe('fail')
    expect(f.evidence.value).toBe(2)
  })
})

describe('LOCAL-016: service-area coherence', () => {
  it('targeting the business own city is coherent even when unlisted', () => {
    const stations: StationBundle = {
      crawl: toolOk(
        {
          site: { robotsTxt: null, sitemapUrls: [] },
          pages: [
            {
              url: 'https://t.example/areas/pasadena/',
              status: 200,
              title: 't',
              metaDescription: 'd',
              h1s: ['Plumber in Pasadena'],
              canonical: null,
              robotsMeta: '',
              hasViewportMeta: true,
              tapTargetsOk: true,
              analytics: { ga4: true, gtm: false },
              internalLinksOut: 3,
              wordCount: 900,
              templateGroup: 'area',
              targetGeo: 'Pasadena, CA', // = businessCity, NOT in serviceAreas
            },
          ],
        },
        { sources: ['crawl'] },
      ),
      gbp: toolOk(gbpProfile(), { sources: ['gbp'] }),
    }
    const [f] = runChecks([check('LOCAL-016')], stations)
    expect(f.status).toBe('pass')
  })
})

describe('citationValidity', () => {
  const manifest: EvalManifest = {
    case: 't',
    description: 'd',
    must_find: [{ id: 'ONPAGE-003' }],
    must_not_find: ['LOCAL-003'],
    must_pass: [],
  }
  const findings = [
    {
      checkId: 'ONPAGE-003',
      status: 'fail' as const,
      evidence: { affectedUrls: 191, detail: '191 of 206 pages missing H1' },
      source: 'crawl' as const,
    },
    {
      checkId: 'LOCAL-003',
      status: 'pass' as const,
      evidence: { detail: 'complete' },
      source: 'gbp' as const,
    },
  ]

  it('accepts a grounded recommendation that quotes its evidence', () => {
    const out = citationValidity(
      [{ title: 'Fix the H1 template', body: 'One template change fixes 191 pages.', findingIds: ['ONPAGE-003'] }],
      findings,
      manifest,
    )
    expect(out.valid).toBe(true)
  })

  it('rejects a recommendation citing nothing', () => {
    const out = citationValidity([{ title: 't', body: 'b', findingIds: [] }], findings, manifest)
    expect(out.violations[0].reason).toContain('cites no findings')
  })

  it('rejects a citation of a finding that does not exist in the run', () => {
    const out = citationValidity(
      [{ title: 't', body: '191', findingIds: ['GEO-001'] }],
      findings,
      manifest,
    )
    expect(out.violations[0].reason).toContain('do not exist')
  })

  it('rejects a citation of a must_not_find check', () => {
    const out = citationValidity(
      [{ title: 't', body: 'b', findingIds: ['LOCAL-003'] }],
      findings,
      manifest,
    )
    expect(out.violations.some((v) => v.reason.includes('must_not_find'))).toBe(true)
  })

  it('rejects numberless prose citing numeric evidence — the vacuity guard', () => {
    const out = citationValidity(
      [{ title: 't', body: 'Many pages lack an H1 and it should be fixed.', findingIds: ['ONPAGE-003'] }],
      findings,
      manifest,
    )
    expect(out.violations.some((v) => v.reason.includes('quotes none'))).toBe(true)
  })
})

describe('contract: degraded is now required', () => {
  it('toolOk defaults degraded to false explicitly, never undefined', () => {
    const ok = toolOk([1], { sources: ['gsc'] })
    expect(ok.degraded).toBe(false)
    const deg = toolOk([1], { sources: ['gsc'], degraded: true })
    expect(deg.degraded).toBe(true)
  })
})
