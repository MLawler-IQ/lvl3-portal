// One audit run: stations → findings → scoring.
//
// THE BUNDLE IS BUILT FROM STATIONS ONLY. A tool's `requires` is never read as
// authoritative for what data exists, because it already is not: `ai-visibility` declares
// `requires: { client: true, gsc: true }` while its registry manifest lists
// `dataSources: ['gsc','ga4']`, so `missingRequirement` never gates it on
// `ga4_property_id` — and the tool touches GSC only. Two declarations of one fact, already
// disagreeing. This module asks each station what it produced and lets
// lib/findings/engine.ts turn absence into `not_run` with a reason.
//
// A STATION NEVER ABORTS THE RUN. Every station's failure is data: the engine converts it
// into `not_run` on exactly the checks that needed it and leaves every other check alone.
// So the only thing that can end a run early is a bug, and there is a try/catch around
// scoring for the one known case (an unregistered check id makes `rubricEntry` throw).

import { CHECKS } from '@/lib/findings/checks'
import { runChecks } from '@/lib/findings/engine'
import type { Finding, StationBundle, StationName } from '@/lib/findings/types'
import type { SitebulbCoverage } from '@/lib/ingest/sitebulb/crawl'
import { contextFromStations, scoreFindings } from '@/lib/scoring'
import type { ScoringResult } from '@/lib/scoring/types'
import { runCrawlStation } from '@/lib/stations/crawl'
// Safe to import statically, and only just: every one of lib/stations/gbp.ts's own static
// imports is type-only or pure, so this line does not pull `next/headers` into the graph
// of scripts/audit-dry-run.ts. tests/unit/gbp-station.test.ts pins that property on the
// station; the runtime proof for this module is the dry-run itself.
import { runGbpStation } from '@/lib/stations/gbp'
import { runGscStation } from '@/lib/stations/gsc'
import { runRobotsStation, withSiteFiles } from '@/lib/stations/robots'
import type { ToolContext, ToolResult } from '@/lib/tools/contract'
import { createStationRecorder, NO_RECORDER } from './recorder'
import type {
  AuditRunOptions,
  AuditRunResult,
  StationRecorder,
  StationReport,
  StationSlot,
} from './types'

/** Slugs for the station rows in `tool_runs`. */
const SLUGS = {
  crawl: 'audit.crawl',
  gsc: 'audit.gsc',
  gbp: 'audit.gbp',
  robots: 'audit.robots',
} as const

const DEFAULT_GSC_DAYS = 90

/**
 * `buildToolContext`, loaded only when a run actually needs one.
 *
 * A static import would pull lib/supabase/server.ts — and therefore `next/headers` — into
 * the module graph of every consumer, including a plain `node` script that supplies its own
 * site URL and GSC property and touches no database at all. That is not a packaging nicety:
 * `next/headers` does not resolve outside the Next runtime, so a static import makes an
 * offline run fail at LOAD time, before any of the code it was actually invoking runs.
 * Deferring it means the Supabase client is constructed only on the path that uses it.
 */
async function defaultBuildContext(
  opts: Parameters<NonNullable<AuditRunOptions['deps']>['buildContext'] & object>[0],
): Promise<ToolContext> {
  const { buildToolContext } = await import('@/lib/tools/context')
  return buildToolContext(opts)
}

function report(name: StationSlot, over: Partial<StationReport> = {}): StationReport {
  return { name, state: 'skipped', sources: [], notes: [], durationMs: 0, runId: null, ...over }
}

/**
 * The state a completed station is in.
 *
 * `degraded` comes off the envelope rather than being recomputed, because the crawl
 * station is the only thing that knows what its export was missing and
 * lib/stations/degradation.ts is the only place that rule lives.
 */
function stateOf(result: ToolResult<unknown>): StationReport['state'] {
  if (!result.ok) return 'failed'
  return result.degraded ? 'degraded' : 'ok'
}

export async function runAudit(options: AuditRunOptions): Promise<AuditRunResult> {
  const deps = options.deps ?? {}
  const now = deps.now ?? Date.now
  const checks = deps.checks ?? CHECKS
  const runCrawl = deps.runCrawl ?? runCrawlStation
  const runGsc = deps.runGsc ?? runGscStation
  const runGbp = deps.runGbp ?? runGbpStation
  const runRobots = deps.runRobots ?? runRobotsStation
  const buildContext = deps.buildContext ?? defaultBuildContext
  const createRecorder = deps.createRecorder ?? createStationRecorder
  const progress = options.onProgress ?? (() => {})

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const notes: string[] = []
  const skip = new Set<StationName>(options.skip ?? [])

  const stations: StationBundle = {}
  const stationStatus: Record<StationSlot, StationReport> = {
    crawl: report('crawl'),
    gsc: report('gsc'),
    gbp: report('gbp'),
    robots: report('robots'),
  }

  // ── context, best effort ─────────────────────────────────────────────────────
  // The single place Supabase and Google can fail, and it degrades rather than
  // aborting. buildToolContext resolves getAdminOAuthClient unguarded, so a missing or
  // expired admin token throws out of it — and a CSV directory needs neither to produce
  // findings, so that must not be the difference between a run and no run.
  let ctx: ToolContext | null = null
  const wantsContext = options.record !== false || options.clientId != null
  if (wantsContext) {
    try {
      ctx = await buildContext({
        clientId: options.clientId ?? null,
        invoker: { kind: 'orchestrator' },
        // STILL EXPLICIT, and still the thing to check first when a run costs more than
        // it should. Business Profile is a SEPARATE Google identity from GA4/GSC
        // (matt@ vs analytics@), so resolving it is an extra admin-token read — worth
        // paying for only when the GBP station is actually going to run. Passing the
        // literal rather than leaving it off keeps the two callers of this seam saying
        // what they mean: `false` here is now "the caller skipped gbp", not "no station
        // exists". buildToolContext already swallows a GBP token failure into
        // `gbpAuth: null`, so a true here cannot cost the run its other stations.
        needsGbp: !skip.has('gbp'),
      })
    } catch (err) {
      notes.push(
        `Client context unavailable (${message(err)}), so the run has no client-derived properties and nothing was recorded.`,
      )
    }
  }

  // ── recording ────────────────────────────────────────────────────────────────
  let recorder: StationRecorder = NO_RECORDER
  const recording: AuditRunResult['recording'] = { attempted: false, recorded: [] }
  if (deps.recorder !== undefined) {
    recorder = deps.recorder ?? NO_RECORDER
    recording.attempted = deps.recorder !== null
    if (deps.recorder === null) recording.skippedReason = 'recording disabled by the caller'
  } else if (options.record === false) {
    recording.skippedReason = 'recording disabled by the caller'
  } else if (ctx === null) {
    recording.skippedReason = 'no client context, so there is no service client to record with'
  } else {
    recorder = createRecorder(ctx.service, ctx.invoker)
    recording.attempted = true
  }

  // Attribution for the recorded rows. It rides in `input`, never in the row's
  // client_id — see lib/orchestrator/recorder.ts for why that column stays null.
  const attribution = { auditClientId: options.clientId ?? null }

  // ── crawl, gsc and gbp, concurrently ─────────────────────────────────────────
  const gscTarget = options.gscSiteUrl ?? ctx?.client?.gsc_site_url ?? null
  const gscDays = options.gscDays ?? DEFAULT_GSC_DAYS
  const gbpAccount = ctx?.client?.gbp_account_id ?? null
  const gbpGroup = locationGroupOf(ctx)

  progress('running the crawl, GSC and GBP stations')

  let coverage: SitebulbCoverage | null = null

  const crawlTask = (async () => {
    const startedStation = now()
    try {
      // The ingest runs INSIDE the recorded body, so the row's started_at/completed_at
      // bracket the actual work. Running it first and then recording an already-resolved
      // value would write a row whose duration is zero, and slice 4 reads those timings.
      // `coverage` escapes through the closure because ToolResult cannot carry it.
      const { result, runId } = await recorder.record(
        SLUGS.crawl,
        { ...attribution, export: options.crawl.label },
        async () => {
          const run = await runCrawl(options.crawl)
          coverage = run.coverage
          return run.result
        },
      )
      if (runId !== null) recording.recorded.push(SLUGS.crawl)
      stationStatus.crawl = report('crawl', {
        state: stateOf(result),
        reason: result.ok ? undefined : result.error,
        sources: result.sources,
        notes: result.ok ? (result.notes ?? []) : [],
        durationMs: now() - startedStation,
        runId,
      })
      return result
    } catch (err) {
      // The station is meant to absorb its own failures; if one escapes, it is still a
      // station result and not a dead run.
      stationStatus.crawl = report('crawl', {
        state: 'failed',
        reason: message(err),
        durationMs: now() - startedStation,
      })
      notes.push(`The crawl station threw rather than returning an error envelope: ${message(err)}.`)
      return null
    }
  })()

  const gscTask = (async () => {
    if (skip.has('gsc')) {
      stationStatus.gsc = report('gsc', {
        state: 'skipped',
        reason: 'the caller skipped the GSC station; the checks that read it report not_run',
      })
      return null
    }
    if (gscTarget === null || gscTarget.length === 0) {
      stationStatus.gsc = report('gsc', {
        state: 'unconfigured',
        reason: 'no GSC property is configured for this client',
      })
      return null
    }
    const startedStation = now()
    try {
      const { result, runId } = await recorder.record(
        SLUGS.gsc,
        { ...attribution, siteUrl: gscTarget, days: gscDays },
        () => runGsc(gscTarget, gscDays),
      )
      if (runId !== null) recording.recorded.push(SLUGS.gsc)
      stationStatus.gsc = report('gsc', {
        state: stateOf(result),
        reason: result.ok ? undefined : result.error,
        sources: result.sources,
        notes: result.ok ? (result.notes ?? []) : [],
        durationMs: now() - startedStation,
        runId,
      })
      return result
    } catch (err) {
      stationStatus.gsc = report('gsc', {
        state: 'failed',
        reason: message(err),
        durationMs: now() - startedStation,
      })
      return null
    }
  })()

  /**
   * The GBP station.
   *
   * WHAT AN AUDIT NOW COSTS GOOGLE. Three requests for the ordinary single-location
   * client: one Business Information v1 accounts.locations.list (100 locations per page),
   * then — concurrently, inside the station — one My Business v4 media.list (100 items per
   * page, capped at 10 pages) and one v4 reviews.list (50 reviews per page, capped at 20).
   * A profile with more than 100 photos or more than 50 reviews pages, so the per-audit
   * ceiling is ceil(locations/100) + 10 + 20 requests. That is against 250,000/day and
   * 600/min granted on mybusiness.googleapis.com, so quota is not the constraint; LATENCY
   * is, which is why this runs concurrently with crawl and gsc rather than after them.
   * Nothing here retries, and one audit reads one profile.
   *
   * TWO CONFIGURATION GAPS, NEITHER OF THEM A FAILURE. A client with no gbp_account_id and
   * a portal with no connected Business Profile identity are both `unconfigured` — the
   * same call the GSC station's missing gsc_site_url gets, and for the same reason: an
   * admin can fix either from a settings screen, and rendering "we chose not to look" as
   * "we looked and it broke" is exactly what StationState exists to prevent. `failed` is
   * kept for a read that reached Google and went wrong.
   *
   * The station owns everything after that, including the fail-closed scope rule and the
   * refusal to build a record out of a partial read — a failed media or reviews fetch
   * comes back as a ToolErr, which lands here as `failed` and reaches LOCAL-003 and
   * LOCAL-016 as not_run carrying the reader's own sentence.
   */
  const gbpTask = (async () => {
    if (skip.has('gbp')) {
      stationStatus.gbp = report('gbp', {
        state: 'skipped',
        reason: 'the caller skipped the GBP station; the checks that read it report not_run',
      })
      return null
    }
    if (gbpAccount === null || gbpAccount.trim().length === 0) {
      stationStatus.gbp = report('gbp', {
        state: 'unconfigured',
        reason: 'no Business Profile account is configured for this client',
      })
      return null
    }
    const gbpAuth = ctx?.gbpAuth ?? null
    if (gbpAuth === null) {
      stationStatus.gbp = report('gbp', {
        state: 'unconfigured',
        reason:
          'the Business Profile identity is not connected, so there was nothing to read the profile with',
      })
      return null
    }
    const startedStation = now()
    try {
      const { result, runId } = await recorder.record(
        SLUGS.gbp,
        { ...attribution, account: gbpAccount, locationGroup: gbpGroup },
        () => runGbp({ accountName: gbpAccount, locationGroup: gbpGroup, auth: gbpAuth }),
      )
      if (runId !== null) recording.recorded.push(SLUGS.gbp)
      stationStatus.gbp = report('gbp', {
        state: stateOf(result),
        reason: result.ok ? undefined : result.error,
        sources: result.sources,
        notes: result.ok ? (result.notes ?? []) : [],
        durationMs: now() - startedStation,
        runId,
      })
      return result
    } catch (err) {
      stationStatus.gbp = report('gbp', {
        state: 'failed',
        reason: message(err),
        durationMs: now() - startedStation,
      })
      return null
    }
  })()

  const [crawlResult, gscResult, gbpResult] = await Promise.all([crawlTask, gscTask, gbpTask])

  // A skipped station is ABSENT from the bundle rather than an empty ok. The engine
  // says "not provided" for an absent slot and "returned no data — cannot distinguish
  // clean from unseen" for an empty one, and those are different sentences: the strip
  // and the finding have to agree about which happened.
  //
  // A ToolErr is a RESULT and goes in, for all three: the engine turns a failed station
  // into not_run carrying that station's own error, which says more than "not provided".
  // Only a station that never ran at all returns null above.
  if (crawlResult !== null) stations.crawl = crawlResult
  if (gscResult !== null) stations.gsc = gscResult
  if (gbpResult !== null) stations.gbp = gbpResult

  // ── site files, after the crawl ──────────────────────────────────────────────
  // After, because the origin can come from the crawled pages when nothing else
  // supplies it — and because there is no `site` to merge into if the crawl errored.
  if (options.robots === false) {
    stationStatus.robots = report('robots', {
      state: 'skipped',
      reason: "the caller skipped the site files; robotsTxtStatus stays 'not-fetched' and TECH-001 reads not_run",
    })
  } else {
    const origin = resolveOrigin(options.siteUrl ?? ctx?.client?.website_url ?? null, stations.crawl)
    if (origin === null) {
      stationStatus.robots = report('robots', {
        state: 'unconfigured',
        reason: 'no site origin to fetch from, so robots.txt and llms.txt were not attempted',
      })
    } else {
      progress(`fetching site files from ${origin}`)
      const startedStation = now()
      try {
        const { result, runId } = await recorder.record(
          SLUGS.robots,
          { ...attribution, origin },
          () => runRobots(origin),
        )
        if (runId !== null) recording.recorded.push(SLUGS.robots)
        stationStatus.robots = report('robots', {
          state: stateOf(result),
          reason: result.ok ? undefined : result.error,
          sources: result.sources,
          notes: result.ok ? (result.notes ?? []) : [],
          durationMs: now() - startedStation,
          runId,
        })
        if (stations.crawl) stations.crawl = withSiteFiles(stations.crawl, result)
      } catch (err) {
        stationStatus.robots = report('robots', {
          state: 'failed',
          reason: message(err),
          durationMs: now() - startedStation,
        })
      }
    }
  }

  // ── findings and scoring ─────────────────────────────────────────────────────
  progress('running checks')
  const findings = runChecks(checks, stations)

  let scoring: ScoringResult
  let configVersion: string
  try {
    scoring = scoreFindings(findings, contextFromStations(stations))
    configVersion = scoring.configVersion
  } catch (err) {
    // rubricEntry throws for a check id with no rubric row. That is a real defect, but
    // losing all 8 findings to it would hide the defect behind an empty screen — the
    // findings are what an operator came for, so they still print.
    scoring = {
      items: [],
      unscored: findings.map((f) => ({
        checkId: f.checkId,
        status: f.status,
        reason: 'scoring stage failed before this finding was scored',
      })),
      configVersion: 'unavailable',
    }
    configVersion = 'unavailable'
    notes.push(`Scoring failed (${message(err)}), so the findings are unranked.`)
  }

  const completedMs = now()

  return {
    stations,
    stationStatus,
    coverage,
    findings,
    scoring,
    configVersion,
    status: runStatus(stationStatus, configVersion),
    recording,
    startedAt,
    completedAt: new Date(completedMs).toISOString(),
    durationMs: completedMs - startedMs,
    notes,
  }
}

/**
 * The run's overall state.
 *
 * `failed` keys off the crawl station rather than off a thrown error: with no crawl every
 * registered check reports `not_run`, so a run that produced no knowledge is a failed run
 * even though nothing threw.
 *
 * `gbp` IS STILL EXCLUDED, FOR A NEW REASON — the old one expired when the station was
 * wired. lib/stations/gbp.ts caps every SUCCESSFUL run at `degraded` on purpose, because
 * GbpProfileRecord does not model the services and attributes LOCAL-003's rubric row also
 * lists. So gbp can never be `ok`, and counting it would make `complete` unreachable for
 * every client — a status nothing can attain reports nothing. What gbp did is not hidden
 * by this: the station strip carries its real state and LOCAL-003/LOCAL-016 carry the
 * reason, which is where a reader looks for it.
 */
function runStatus(
  stationStatus: Record<StationSlot, StationReport>,
  configVersion: string,
): AuditRunResult['status'] {
  const crawl = stationStatus.crawl.state
  if (crawl !== 'ok' && crawl !== 'degraded') return 'failed'
  if (configVersion === 'unavailable') return 'partial'
  const considered: StationSlot[] = ['crawl', 'gsc', 'robots']
  const clean = considered.every((slot) => stationStatus[slot].state === 'ok')
  return clean ? 'complete' : 'partial'
}

/**
 * The origin for the site files.
 *
 * Falls back to the first crawled page because an export always carries absolute URLs,
 * so a run with no client row and no --site flag can still fetch robots.txt. Returns null
 * rather than guessing when there is nothing usable, which makes the station
 * `unconfigured` instead of producing a fabricated 'not-found'.
 */
function resolveOrigin(
  configured: string | null,
  crawl: StationBundle['crawl'],
): string | null {
  const candidates = [configured]
  if (crawl?.ok) candidates.push(crawl.data.pages[0]?.url ?? null)
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return new URL(candidate).origin
    } catch {
      continue
    }
  }
  return null
}

/**
 * `clients.gbp_location_group` off the resolved client row.
 *
 * A local read with a narrow cast rather than a field on `ToolContext['client']`, because
 * that interface lives in lib/tools/contract.ts and this pass does not own it. The value
 * is genuinely there: CLIENT_COLUMNS in lib/tools/context.ts selects the column, and
 * app/actions/dashboard-gbp.ts reads it off a client row the same way. Only the DECLARED
 * shape is behind, so widening the interface is a follow-up that changes no behaviour.
 *
 * Null is a real answer, not a fallback: decideGBPScope refuses a null group by design,
 * and the station's ToolErr names the column and what to set it to.
 */
function locationGroupOf(ctx: ToolContext | null): string | null {
  return ctx?.client?.gbp_location_group ?? null
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Re-exported so a caller can assemble a bundle without importing the engine directly. */
export type { AuditRunOptions, AuditRunResult, StationReport } from './types'
export type { Finding }
