// The orchestrator's shared shapes.
//
// Split out from run.ts so the report formatter, the station recorder and the dry-run
// script depend on the CONTRACT rather than on the implementation — and so none of them
// has to import run.ts, which reaches the whole check registry and the scoring config.
//
// Nothing here has a body. If a rule needs code, it belongs in the module that owns it.

import type { CheckDefinition, Finding, StationBundle, StationName } from '@/lib/findings/types'
import type { ScoringResult } from '@/lib/scoring/types'
import type { SitebulbCoverage } from '@/lib/ingest/sitebulb/crawl'
import type { CrawlExportSource } from '@/lib/ingest/sitebulb/source'
import type { GSCRow } from '@/lib/tools-gsc'
import type {
  ServiceClient,
  ToolContext,
  ToolResult,
  ToolSource,
} from '@/lib/tools/contract'
import type { CrawlStationData, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { RobotsStationData } from '@/lib/stations/robots'

/** Every slot the station strip reports on. `robots` merges into crawl's `site` record. */
export type StationSlot = StationName | 'robots'

/**
 * What happened to one station.
 *
 * `skipped`, `unconfigured` and `unavailable` are deliberately distinct from `failed`:
 * they are the three ways a station can produce nothing WITHOUT anything going wrong, and
 * collapsing them is how "we chose not to look" comes to read as "we looked and it broke".
 *
 *   ok            ran, complete
 *   degraded      ran, incomplete — for crawl this means filesMissing.length > 0, and
 *                 NOTHING else (see lib/stations/degradation.ts). The GBP station reports
 *                 this on EVERY successful run by design: GbpProfileRecord does not model
 *                 the services and attributes LOCAL-003's rubric row also lists.
 *   failed        attempted, returned a ToolErr
 *   skipped       the caller asked us not to run it
 *   unconfigured  nothing to point it at (no gsc_site_url, no gbp_account_id, no
 *                 Business Profile identity, no site origin)
 *   unavailable   no such station exists in this pipeline. NOTHING PRODUCES THIS ANY
 *                 MORE — it was gbp's permanent state until lib/stations/gbp.ts was wired
 *                 into lib/orchestrator/run.ts. It stays in the union because audit_runs
 *                 rows persisted before that still carry it, and a stored run must keep
 *                 rendering the state it was actually in.
 */
export type StationState =
  | 'ok'
  | 'degraded'
  | 'failed'
  | 'skipped'
  | 'unconfigured'
  | 'unavailable'

export interface StationReport {
  name: StationSlot
  state: StationState
  /**
   * Why, in words. For a station the engine will report on, this should echo what the
   * finding's `reason` will say, so the strip and the findings table cannot disagree.
   */
  reason?: string
  sources: ToolSource[]
  notes: string[]
  durationMs: number
  /** tool_runs.id, or null when recording was skipped, unavailable, or failed. */
  runId: string | null
}

export interface AuditRunOptions {
  /**
   * The export. A SOURCE, never a directory path — slice 3's upload route parses a zip
   * in-request with no directory anywhere, and a Vercel function has no writable tree.
   */
  crawl: CrawlExportSource
  /**
   * Client row id. Optional: it is needed only to resolve gsc_site_url/website_url and for
   * attribution, and both can be passed directly. Requiring it would make Supabase and a
   * working Google token prerequisites for turning a CSV directory into findings.
   */
  clientId?: string | null
  /** Origin for the site files. Falls back to the client's website_url, then to pages[0]. */
  siteUrl?: string | null
  /** GSC property. Falls back to the client's gsc_site_url, then the station is unconfigured. */
  gscSiteUrl?: string | null
  gscDays?: number
  /** Positive opt-outs. A skipped station is ABSENT from the bundle, never an empty ok. */
  skip?: readonly StationName[]
  robots?: boolean
  /** Best-effort even when true: recording never gates producing findings. */
  record?: boolean
  onProgress?: (message: string) => void
  deps?: AuditRunDeps
}

export interface AuditRunResult {
  /**
   * Exactly what runChecks consumed. A slot is absent whenever its station was skipped,
   * unconfigured, or failed — including gbp, which is absent for every client with no
   * gbp_account_id and for every run that could not read the profile.
   */
  stations: StationBundle
  /** All four slots, always present, so the strip can never omit one silently. */
  stationStatus: Record<StationSlot, StationReport>
  coverage: SitebulbCoverage | null
  findings: Finding[]
  scoring: ScoringResult
  /** Mirrors scoring.configVersion; 'unavailable' when scoring could not run. */
  configVersion: string
  status: 'complete' | 'partial' | 'failed'
  recording: { attempted: boolean; recorded: string[]; skippedReason?: string }
  startedAt: string
  completedAt: string
  durationMs: number
  /** Degradations of the RUN itself, as opposed to of any one station. */
  notes: string[]
}

/**
 * Records a station run to `tool_runs`.
 *
 * A seam rather than a direct startRun/finishRun pair so the orchestrator runs with no
 * Supabase at all — and so `client_id: null` is structural. See lib/orchestrator/recorder.ts.
 */
export interface StationRecorder {
  record<T>(
    slug: string,
    input: Record<string, unknown>,
    body: () => Promise<ToolResult<T>>,
  ): Promise<{ result: ToolResult<T>; runId: string | null }>
}

export type BuildStationRecorder = (
  service: ServiceClient,
  invoker: ToolContext['invoker'],
) => StationRecorder

/**
 * What the crawl station returns.
 *
 * `coverage` is structural rather than only living in ToolOk.notes because slice 4
 * persists it to audit_runs.coverage and the dry-run prints it; a string[] cannot carry
 * it. Null when the ingest failed before any coverage existed.
 */
export interface CrawlStationRun {
  result: ToolResult<CrawlStationData>
  coverage: SitebulbCoverage | null
}

/**
 * Injection points. Every one exists so a test can run with no env and no network.
 *
 * The station signatures are written out structurally rather than as `typeof import(…)`
 * so this contract does not depend on the modules that satisfy it — which is what lets the
 * formatter, the recorder and the stations be built against it independently.
 */
export interface AuditRunDeps {
  checks?: CheckDefinition[]
  buildContext?: (opts: {
    clientId?: string | null
    invoker: ToolContext['invoker']
    needsGbp?: boolean
  }) => Promise<ToolContext>
  runCrawl?: (source: CrawlExportSource) => Promise<CrawlStationRun>
  runGsc?: (siteUrl: string | null, days?: number) => Promise<ToolResult<GSCRow[]>>
  /**
   * The GBP station. Structural, like the others — the second argument is
   * lib/stations/gbp.ts's own injection bag and is left off here deliberately: the
   * orchestrator never supplies it, so declaring it would put the station's internal
   * seams in this contract.
   *
   * `auth` is `ToolContext['gbpAuth']` rather than a fresh `OAuth2Client` import so this
   * file gains no dependency for one parameter, and so the slot cannot drift from the
   * context field the orchestrator actually passes it.
   */
  runGbp?: (input: {
    accountName: string | null
    locationGroup: string | null
    auth: ToolContext['gbpAuth']
  }) => Promise<ToolResult<GbpProfileRecord>>
  runRobots?: (
    origin: string,
    opts?: { fetchImpl?: typeof fetch; timeoutMs?: number },
  ) => Promise<ToolResult<RobotsStationData>>
  createRecorder?: BuildStationRecorder
  /** null means "explicitly do not record", as opposed to "could not". */
  recorder?: StationRecorder | null
  /** Defaults to Date.now. Injected so two runs can be compared byte for byte. */
  now?: () => number
}
