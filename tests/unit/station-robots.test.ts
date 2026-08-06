// The site-files station: status mapping, and what reaches TECH-001.
//
// fetchImpl is injected rather than stubbing global fetch. With a global stub a case the
// test forgot to handle makes a real network call and hangs for the full timeout; with an
// injected impl "this test cannot reach the network" is a property of the call site.
//
// The assertions that matter most are at the bottom: a failed fetch must reach TECH-001 as
// not_run, and must leave every OTHER crawl-backed check's ceiling alone. Setting degraded
// on a robots failure would cap ONPAGE-003 and TECH-011 at degraded because one unrelated
// HTTP request failed.

import { describe, expect, it, vi } from 'vitest'
import { runRobotsStation, withSiteFiles } from '@/lib/stations/robots'
import { MAX_ROBOTS_BYTES } from '@/lib/robots'
import { toolErr, toolOk, type ToolResult } from '@/lib/tools/contract'
import type { CrawlPageRecord, CrawlStationData } from '@/lib/tools/crawl-record'
import { runChecks } from '@/lib/findings/engine'
import { CHECKS } from '@/lib/findings/checks'
import type { Finding } from '@/lib/findings/types'

const ORIGIN = 'https://example-plumbing.com'

/** A fetch that answers per-path, and throws for a path the test did not anticipate. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    const route = routes[path]
    if (!route) throw new Error(`unrouted request to ${path}`)
    return route()
  }) as typeof fetch
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    ...init,
  })
}

/** Routes that answer robots.txt as given and 404 llms.txt. */
function robotsOnly(robots: () => Response | Promise<Response>): typeof fetch {
  return fakeFetch({
    '/robots.txt': robots,
    '/llms.txt': () => new Response(null, { status: 404 }),
  })
}

async function station(robots: () => Response | Promise<Response>) {
  const result = await runRobotsStation(ORIGIN, { fetchImpl: robotsOnly(robots) })
  if (!result.ok) throw new Error(`expected ToolOk, got ${result.error}`)
  return result
}

describe('status mapping', () => {
  it('maps a 200 text body to ok, verbatim', async () => {
    const body = 'User-agent: *\nDisallow: /wp-admin/\n'
    const { data, notes } = await station(() => textResponse(body))
    expect(data.robotsTxtStatus).toBe('ok')
    expect(data.robotsTxt).toBe(body)
    expect(data.httpStatus).toBe(200)
    expect(notes ?? []).toEqual([])
  })

  it('maps an empty 200 body to ok with an empty string, not to not-found', async () => {
    // That is what was served. It blocks nothing, and reaches pass by a different
    // route than not-found does — conflating them loses a real distinction.
    const { data } = await station(() => textResponse(''))
    expect(data.robotsTxtStatus).toBe('ok')
    expect(data.robotsTxt).toBe('')
  })

  it.each([404, 410])('maps %i to not-found with no note, because it is a clean answer', async (status) => {
    const { data, notes } = await station(() => new Response(null, { status }))
    expect(data.robotsTxtStatus).toBe('not-found')
    expect(data.robotsTxt).toBeNull()
    expect(notes ?? []).toEqual([])
  })

  it.each([401, 403, 429, 500, 503])('maps %i to not-fetched, naming the status', async (status) => {
    // "We were denied" is not "the site serves none". Only the second grounds a pass.
    const { data, notes } = await station(() => new Response(null, { status }))
    expect(data.robotsTxtStatus).toBe('not-fetched')
    expect(data.robotsTxt).toBeNull()
    expect((notes ?? []).join(' ')).toMatch(new RegExp(`HTTP ${status}`))
    expect((notes ?? []).join(' ')).toMatch(/not evidence the site serves none/)
  })

  it('maps a thrown fetch to not-fetched with the reason', async () => {
    const { data, notes } = await station(() => {
      throw new Error('getaddrinfo ENOTFOUND example-plumbing.com')
    })
    expect(data.robotsTxtStatus).toBe('not-fetched')
    expect((notes ?? []).join(' ')).toMatch(/ENOTFOUND/)
  })

  it('maps a timeout to not-fetched, naming the budget', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    const result = await runRobotsStation(ORIGIN, {
      fetchImpl: robotsOnly(() => {
        throw timeout
      }),
      timeoutMs: 250,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.robotsTxtStatus).toBe('not-fetched')
    expect((result.notes ?? []).join(' ')).toMatch(/timed out after 250 ms/)
  })

  it('maps an unusable origin to not-fetched rather than throwing', async () => {
    const result = await runRobotsStation('not a url', { fetchImpl: fakeFetch({}) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.robotsTxtStatus).toBe('not-fetched')
    expect((result.notes ?? []).join(' ')).toMatch(/not a usable site origin/)
  })

  it('never returns a ToolErr, because a missing robots.txt is not a station failure', async () => {
    for (const status of [200, 404, 403, 500]) {
      const result = await runRobotsStation(ORIGIN, {
        fetchImpl: robotsOnly(() => new Response('x', { status })),
      })
      expect(result.ok, `status ${status}`).toBe(true)
    }
  })

  it('is never degraded, whatever happened', async () => {
    // The whole point: 'not-fetched' carries the failure to TECH-001 alone. degraded
    // would cap every other crawl-backed check.
    const ok = await station(() => textResponse('User-agent: *\n'))
    const failed = await station(() => new Response(null, { status: 500 }))
    expect(ok.degraded).toBe(false)
    expect(failed.degraded).toBe(false)
  })
})

describe('the soft-404 guard', () => {
  it('treats a 200 HTML page as absent, and says so', async () => {
    // Feeding HTML to parseRobotsTxt yields no groups, so blockedUrls returns [] and
    // TECH-001 passes on a page that is not a robots.txt at all.
    const { data, notes } = await station(() =>
      textResponse('<!DOCTYPE html><html><body>Not found</body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
    expect(data.robotsTxtStatus).toBe('not-found')
    expect(data.robotsTxt).toBeNull()
    expect((notes ?? []).join(' ')).toMatch(/HTML page rather than a text file/)
  })

  it('catches an HTML body served with a text content type', async () => {
    const { data } = await station(() => textResponse('  <html><head></head></html>'))
    expect(data.robotsTxtStatus).toBe('not-found')
  })

  it('does not mistake a real robots.txt for HTML', async () => {
    const { data } = await station(() => textResponse('# comment\nUser-agent: *\nDisallow: /x/\n'))
    expect(data.robotsTxtStatus).toBe('ok')
  })
})

describe('the byte cap', () => {
  it('truncates at Google’s limit and says so, without degrading', async () => {
    const oversize = `User-agent: *\n${'#'.repeat(MAX_ROBOTS_BYTES)}\nDisallow: /late/\n`
    const { data, notes, degraded } = await station(() => textResponse(oversize))
    expect(data.robotsTxtStatus).toBe('ok')
    expect(data.robotsTxt).toHaveLength(MAX_ROBOTS_BYTES)
    expect((notes ?? []).join(' ')).toMatch(/exceeds \d+ bytes/)
    // Honouring rules Google would never read is the false positive; truncating is
    // Google's own behaviour, so it is not a coverage gap.
    expect(degraded).toBe(false)
  })

  it('leaves a body under the limit untouched', async () => {
    const body = 'User-agent: *\nDisallow: /a/\n'
    const { data, notes } = await station(() => textResponse(body))
    expect(data.robotsTxt).toBe(body)
    expect((notes ?? []).join(' ')).not.toMatch(/exceeds/)
  })
})

describe('llms.txt is tracked independently', () => {
  it('records its own status without touching robots.txt', async () => {
    const result = await runRobotsStation(ORIGIN, {
      fetchImpl: fakeFetch({
        '/robots.txt': () => textResponse('User-agent: *\n'),
        '/llms.txt': () => textResponse('# Example Plumbing\n'),
      }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.robotsTxtStatus).toBe('ok')
    expect(result.data.llmsTxtStatus).toBe('ok')
    expect(result.data.llmsTxt).toBe('# Example Plumbing\n')
  })

  it('leaves robots.txt ok when llms.txt fails outright', async () => {
    const result = await runRobotsStation(ORIGIN, {
      fetchImpl: fakeFetch({
        '/robots.txt': () => textResponse('User-agent: *\n'),
        '/llms.txt': () => {
          throw new Error('connection reset')
        },
      }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.robotsTxtStatus).toBe('ok')
    expect(result.data.llmsTxtStatus).toBe('not-fetched')
  })

  it('gives each request its own timeout budget', async () => {
    // A shared signal lets a slow robots.txt consume llms.txt's budget entirely.
    const signals: (AbortSignal | null | undefined)[] = []
    const spy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal)
      return textResponse('x')
    })
    await runRobotsStation(ORIGIN, { fetchImpl: spy as unknown as typeof fetch })
    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
  })

  it('identifies itself, because an unnamed fetch gets 403d by some WAFs', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('user-agent')).toMatch(/LVL3-Portal-Audit/)
      return textResponse('x')
    })
    await runRobotsStation(ORIGIN, { fetchImpl: spy as unknown as typeof fetch })
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

// ── the merge, and what it reaches ──────────────────────────────────────────────

function page(over: Partial<CrawlPageRecord> & { url: string }): CrawlPageRecord {
  return {
    status: 200,
    title: 'Page',
    metaDescription: 'd',
    h1s: ['H1'],
    canonical: over.url,
    robotsMeta: '',
    hasViewportMeta: true,
    tapTargetsOk: true,
    analytics: { ga4: true, gtm: true },
    internalLinksOut: 5,
    internalLinksIn: 5,
    wordCount: 800,
    uniqueWordCount: 600,
    templateGroup: null,
    targetGeo: null,
    ...over,
  }
}

function crawlOk(over: Partial<CrawlStationData['site']> = {}): ToolResult<CrawlStationData> {
  return toolOk(
    {
      site: {
        robotsTxt: null,
        robotsTxtStatus: 'not-fetched',
        llmsTxt: null,
        llmsTxtStatus: 'not-fetched',
        sitemapUrls: [],
        ...over,
      },
      pages: [page({ url: `${ORIGIN}/` }), page({ url: `${ORIGIN}/services/repair/` })],
    },
    { sources: ['crawl'] },
  )
}

const findingFor = (findings: Finding[], id: string): Finding =>
  findings.find((f) => f.checkId === id)!

describe('withSiteFiles', () => {
  it('replaces only the four site-file fields', async () => {
    const crawl = crawlOk({ sitemapUrls: [`${ORIGIN}/sitemap.xml`] })
    const merged = withSiteFiles(crawl, await station(() => textResponse('User-agent: *\n')))
    expect(merged.ok).toBe(true)
    if (!merged.ok || !crawl.ok) return
    expect(merged.data.site.robotsTxt).toBe('User-agent: *\n')
    expect(merged.data.site.robotsTxtStatus).toBe('ok')
    // Untouched.
    expect(merged.data.site.sitemapUrls).toEqual([`${ORIGIN}/sitemap.xml`])
    expect(merged.data.pages).toBe(crawl.data.pages)
    expect(merged.sources).toEqual(['crawl'])
  })

  it('does not mutate the crawl result it was handed', async () => {
    const crawl = crawlOk()
    withSiteFiles(crawl, await station(() => textResponse('User-agent: *\n')))
    expect(crawl.ok && crawl.data.site.robotsTxtStatus).toBe('not-fetched')
  })

  it('leaves degraded exactly as the crawl station set it', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A robots failure must not cost every other
    // crawl-backed check its ability to pass.
    const degradedCrawl = toolOk(
      { site: crawlOk().ok ? (crawlOk() as { data: CrawlStationData }).data.site : ({} as never), pages: [] },
      { sources: ['crawl'], degraded: true, notes: ['mobile export missing'] },
    )
    const failed = await station(() => new Response(null, { status: 500 }))
    const mergedDegraded = withSiteFiles(degradedCrawl, failed)
    expect(mergedDegraded.ok && mergedDegraded.degraded).toBe(true)

    const clean = withSiteFiles(crawlOk(), failed)
    expect(clean.ok && clean.degraded).toBe(false)
  })

  it('appends the robots notes and keeps the crawl’s own first', async () => {
    const crawl = toolOk(crawlOk().ok ? (crawlOk() as { data: CrawlStationData }).data : ({} as never), {
      sources: ['crawl'],
      degraded: true,
      notes: ['the mobile-friendly export is missing'],
    })
    const merged = withSiteFiles(crawl, await station(() => new Response(null, { status: 503 })))
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.notes?.[0]).toMatch(/mobile-friendly/)
    expect((merged.notes ?? []).join(' ')).toMatch(/HTTP 503/)
  })

  it('passes a crawl ToolErr through untouched — there is no site to write into', () => {
    const err = toolErr<CrawlStationData>('no *_internal.csv', { sources: ['crawl'] })
    const merged = withSiteFiles(err, toolOk(
      { robotsTxt: 'x', robotsTxtStatus: 'ok', llmsTxt: null, llmsTxtStatus: 'not-found', httpStatus: 200 },
      { sources: ['crawl'] },
    ))
    expect(merged).toBe(err)
  })

  it('notes a station-level robots failure instead of silently leaving not-fetched', () => {
    const merged = withSiteFiles(crawlOk(), toolErr<never>('station crashed', { sources: ['crawl'] }))
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.data.site.robotsTxtStatus).toBe('not-fetched')
    expect((merged.notes ?? []).join(' ')).toMatch(/could not be fetched/)
    expect(merged.degraded).toBe(false)
  })
})

describe('what the merge reaches in the findings engine', () => {
  it('not-fetched makes TECH-001 not_run, and leaves other checks alone', async () => {
    const merged = withSiteFiles(crawlOk(), await station(() => new Response(null, { status: 500 })))
    const findings = runChecks(CHECKS, { crawl: merged })
    expect(findingFor(findings, 'TECH-001').status).toBe('not_run')
    expect(findingFor(findings, 'TECH-001').reason).toMatch(/did not fetch robots\.txt/)
    // The pages are clean, so these must still be able to reach pass.
    expect(findingFor(findings, 'ONPAGE-003').status).toBe('pass')
    expect(findingFor(findings, 'TECH-011').status).toBe('pass')
  })

  it('not-found makes TECH-001 pass, because nothing is blocked', async () => {
    const merged = withSiteFiles(crawlOk(), await station(() => new Response(null, { status: 404 })))
    const findings = runChecks(CHECKS, { crawl: merged })
    expect(findingFor(findings, 'TECH-001').status).toBe('pass')
  })

  it('a Disallow that covers crawled URLs makes TECH-001 fail', async () => {
    const merged = withSiteFiles(
      crawlOk(),
      await station(() => textResponse('User-agent: *\nDisallow: /\n')),
    )
    const findings = runChecks(CHECKS, { crawl: merged })
    const tech001 = findingFor(findings, 'TECH-001')
    expect(tech001.status).toBe('fail')
    expect(tech001.evidence.affectedUrls).toBe(2)
  })

  it('a permissive robots.txt makes TECH-001 pass on real body content', async () => {
    const merged = withSiteFiles(
      crawlOk(),
      await station(() => textResponse('User-agent: *\nDisallow: /wp-admin/\n')),
    )
    const findings = runChecks(CHECKS, { crawl: merged })
    expect(findingFor(findings, 'TECH-001').status).toBe('pass')
  })
})
