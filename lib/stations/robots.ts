// The site-files station: /robots.txt and /llms.txt, fetched over the network.
//
// NOT A FOURTH StationBundle SLOT. What it produces belongs to the crawl station's
// `site` record, so it merges in via withSiteFiles. Widening the three-slot bundle would
// touch the engine's station-state handling, contextFromStations, the eval linter and both
// fixtures, for data that is site-level rather than a station of its own.
//
// WHY IT IS SEPARATE FROM runCrawlStation, given the merge. Three reasons, in order of
// how much they cost when ignored: the crawl station stays offline-pure so its unit tests
// need no network stub; a sandbox with no egress would otherwise make the whole crawl
// suite wait out a DNS timeout; and if the crawl station errored there is no `site` to
// merge into, which is only expressible if the two are separate calls.
//
// A FAILED FETCH MUST NEVER SET crawl.degraded. It sets 'not-fetched', which makes
// TECH-001 report not_run (lib/findings/checks.ts) — already the honest answer, and the
// one the four-state model exists to give. Setting `degraded` instead would cap
// ONPAGE-003, TECH-011, MEAS-001 and every other crawl-backed check at `degraded`
// (lib/findings/engine.ts) because one unrelated HTTP request failed. That is the same
// trap as degrading on `unmeasured`, one file over.

import { MAX_ROBOTS_BYTES } from '@/lib/robots'
import { runGuarded, toolOk, type ToolResult } from '@/lib/tools/contract'
import type { CrawlSiteRecord, CrawlStationData } from '@/lib/tools/crawl-record'

/** A UA some WAFs will not 403. An unidentified fetch reads as 'not-fetched' on a healthy site. */
const USER_AGENT = 'LVL3-Portal-Audit/1.0 (+https://portal.igniteiq.com)'

const DEFAULT_TIMEOUT_MS = 5000

type FileStatus = CrawlSiteRecord['robotsTxtStatus']

export interface RobotsStationData {
  robotsTxt: string | null
  robotsTxtStatus: FileStatus
  llmsTxt: string | null
  llmsTxtStatus: FileStatus
  /** HTTP status for /robots.txt, or null when the request never completed. */
  httpStatus: number | null
}

export interface RobotsStationOptions {
  /** Injected in tests. A real global-fetch stub would hang on a missed case. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface FetchedFile {
  body: string | null
  status: FileStatus
  httpStatus: number | null
  notes: string[]
}

/**
 * Fetch both site files.
 *
 * Always ToolOk: neither file existing is a normal, informative outcome, not a station
 * failure. The per-file status carries what happened and the notes say it in words.
 */
export async function runRobotsStation(
  origin: string,
  opts: RobotsStationOptions = {},
): Promise<ToolResult<RobotsStationData>> {
  return runGuarded<RobotsStationData>(['crawl'], async () => {
    const fetchImpl = opts.fetchImpl ?? fetch
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    // Sequential rather than concurrent, and each with its OWN timeout signal: a shared
    // signal lets the first request's latency eat the second's budget.
    const robots = await fetchFile(origin, '/robots.txt', fetchImpl, timeoutMs)
    const llms = await fetchFile(origin, '/llms.txt', fetchImpl, timeoutMs)

    return toolOk(
      {
        robotsTxt: robots.body,
        robotsTxtStatus: robots.status,
        llmsTxt: llms.body,
        llmsTxtStatus: llms.status,
        httpStatus: robots.httpStatus,
      },
      {
        sources: ['crawl'],
        // Not degraded, ever. See the header: 'not-fetched' is the signal, and it
        // reaches TECH-001 as not_run without touching any other check's ceiling.
        degraded: false,
        notes: [...robots.notes, ...llms.notes],
      },
    )
  })
}

/**
 * Merge fetched site files into a crawl station result.
 *
 * A crawl ToolErr passes through untouched — there is no `site` to write into. The crawl
 * station's own `degraded` and `notes` are preserved and the robots notes are appended;
 * `sources` stays as the crawl station set it, because robots.txt is site data on that
 * station rather than a new provenance.
 */
export function withSiteFiles(
  crawl: ToolResult<CrawlStationData>,
  robots: ToolResult<RobotsStationData>,
): ToolResult<CrawlStationData> {
  if (!crawl.ok) return crawl

  const notes = [...(crawl.notes ?? [])]

  if (!robots.ok) {
    // The station itself failed rather than a file being absent. The crawl's site
    // record already says 'not-fetched' for both files, which is the correct state —
    // this only adds the reason so the strip is not silent about it.
    notes.push(
      `The site files could not be fetched (${robots.error}), so robots.txt and llms.txt were not evaluated.`,
    )
    return { ...crawl, notes }
  }

  const files = robots.data
  notes.push(...(robots.notes ?? []))

  return {
    ...crawl,
    // Only the four site-file fields move. pages, sitemapUrls and degraded are untouched.
    data: {
      ...crawl.data,
      site: {
        ...crawl.data.site,
        robotsTxt: files.robotsTxt,
        robotsTxtStatus: files.robotsTxtStatus,
        llmsTxt: files.llmsTxt,
        llmsTxtStatus: files.llmsTxtStatus,
      },
    },
    ...(notes.length > 0 ? { notes } : {}),
  }
}

/**
 * One file, with every failure mapped to a status rather than a throw.
 *
 * The mapping is a claim about what we can EVIDENCE, which is why 401/403 are
 * 'not-fetched' and not 'not-found': Google treats most 4xx as allow-all, but that is a
 * statement about what Google will crawl. "We were denied" is not "the site serves none",
 * and only the second is grounds for a `pass`.
 */
async function fetchFile(
  origin: string,
  path: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchedFile> {
  let url: string
  try {
    url = new URL(path, origin).toString()
  } catch {
    return {
      body: null,
      status: 'not-fetched',
      httpStatus: null,
      notes: [`${path} was not fetched: ${JSON.stringify(origin)} is not a usable site origin.`],
    }
  }

  let res: Response
  try {
    res = await fetchImpl(url, {
      // Follow redirects, including cross-origin: robots.txt redirects are common and
      // Google follows them. No hop counting — fetch caps that itself.
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain, */*' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return {
      body: null,
      status: 'not-fetched',
      httpStatus: null,
      notes: [
        timedOut
          ? `${path} was not fetched: the request timed out after ${timeoutMs} ms.`
          : `${path} was not fetched: ${reason}.`,
      ],
    }
  }

  if (res.status === 404 || res.status === 410) {
    // Fetched, and the site genuinely serves none. Blocks nothing, and needs no note:
    // it is a clean answer, not a gap.
    return { body: null, status: 'not-found', httpStatus: res.status, notes: [] }
  }

  if (!res.ok) {
    return {
      body: null,
      status: 'not-fetched',
      httpStatus: res.status,
      notes: [
        `${path} returned HTTP ${res.status}, so it could not be read. That is not evidence the site serves none.`,
      ],
    }
  }

  // arrayBuffer + truncate, never res.text(): text() decodes the whole body first, and
  // this is a file from the client's own site with no size guarantee. Truncating at
  // Google's own 500 KiB limit is also what Google does, so it is not a coverage gap.
  const raw = new Uint8Array(await res.arrayBuffer())
  const clipped = raw.byteLength > MAX_ROBOTS_BYTES
  // A cut can split a multi-byte character; TextDecoder emits U+FFFD, which affects at
  // most the final rule line of a 500 KiB file.
  const body = new TextDecoder('utf-8').decode(raw.subarray(0, MAX_ROBOTS_BYTES))
  const notes: string[] = []
  if (clipped) {
    notes.push(
      `${path} exceeds ${MAX_ROBOTS_BYTES} bytes; only the first ${MAX_ROBOTS_BYTES} were evaluated, matching Google's own limit.`,
    )
  }

  if (looksLikeHtml(res, body)) {
    // A SPA answering 200 with its index page. Feeding HTML to parseRobotsTxt yields no
    // groups, so blockedUrls returns [] and TECH-001 reports a FABRICATED pass. Treating
    // it as not-found reaches the same `pass` for the right reason, and the note makes
    // the guess visible instead of invisible.
    return {
      body: null,
      status: 'not-found',
      httpStatus: res.status,
      notes: [
        ...notes,
        `${path} returned an HTML page rather than a text file (a soft 404), so it was treated as absent.`,
      ],
    }
  }

  // An empty 200 body stays 'ok' with an empty string: that is what was served, and it
  // blocks nothing. Both it and 'not-found' reach `pass`, by different routes.
  return { body, status: 'ok', httpStatus: res.status, notes }
}

/**
 * Whether a 200 response is really an HTML page rather than the file we asked for.
 *
 * THE BODY DECIDES, NOT THE CONTENT TYPE. An earlier version returned true as soon as the
 * content type contained `text/html`, which is a fabricated pass waiting to happen:
 * serving a perfectly good robots.txt as `text/html` is routine (default-type Nginx and
 * Apache configs, WordPress rewrite handlers, some CDN transforms), and classifying it as
 * absent sets `robotsTxt: null`, which TECH-001 reads as "No robots.txt served; nothing is
 * blocked" — `pass`. A file whose first line is `Disallow: /` would have been reported as a
 * clean bill of health on a check that is critical and auto-tier. That is failure mode 1
 * exactly, and the wrong MIME type is not evidence about the file's contents.
 *
 * So: markup in the body means HTML. A body carrying robots directives is the file,
 * whatever the server labelled it.
 */
function looksLikeHtml(res: Response, body: string): boolean {
  const head = body.trimStart().slice(0, 200).toLowerCase()
  const markup =
    head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml')
  if (markup) return true

  // The content type is a tiebreaker only, for a body that says nothing either way. A
  // `text/html` response whose body holds real directives is still the real file.
  const htmlType = (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
  return htmlType && !hasRobotsDirectives(body)
}

/** Whether a body contains anything a robots.txt parser would act on. */
function hasRobotsDirectives(body: string): boolean {
  return /^\s*(user-agent|disallow|allow|sitemap|crawl-delay)\s*:/im.test(body)
}
