// The findings model — the object phases 3-5 are built around.
//
// One row per rubric check per run. Four states, and the distinction between them
// is the load-bearing part (AUTOMATION-CONTEXT.md §17 calls the silently-incomplete
// audit the single most important failure to prevent):
//
//   pass      the check ran against real data and found nothing wrong
//   fail      the check ran and found the defect; evidence says how big
//   degraded  the check ran on partial data; its answer is usable but incomplete
//   not_run   the check COULD NOT run — missing station, empty data, failed auth.
//             Never conflated with pass: "we didn't look" is not "it's fine".

import type { ToolResult } from '@/lib/tools/contract'
import type { CrawlStationData, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'

export type FindingStatus = 'pass' | 'fail' | 'degraded' | 'not_run'

export interface FindingEvidence {
  /** How many URLs the defect touches, where that's the natural magnitude. */
  affectedUrls?: number
  /** A scalar magnitude where URL count isn't the natural unit (cluster count…). */
  value?: number
  /** Human-readable one-liner. Every number a client sees traces back to here. */
  detail: string
  /** Up to a handful of example URLs/queries, for the reviewer. */
  examples?: string[]
}

export interface Finding {
  checkId: string
  status: FindingStatus
  evidence: FindingEvidence
  /** Which station's data produced this. */
  source: 'crawl' | 'gsc' | 'ga4' | 'gbp' | 'derived'
  /** Why the check is not_run/degraded, when it is. */
  reason?: string
}

/**
 * The station bundle a check run consumes.
 *
 * Each station is a ToolResult envelope, so "the station failed" and "the station
 * returned nothing" are both first-class, distinguishable inputs — which is what
 * lets the engine enforce that neither ever turns into a pass.
 */
export interface StationBundle {
  crawl?: ToolResult<CrawlStationData>
  gsc?: ToolResult<GSCRow[]>
  gbp?: ToolResult<GbpProfileRecord>
}

export type StationName = keyof StationBundle

export interface CheckDefinition {
  id: string
  /** Stations this check reads. All must be ok (and non-empty) to evaluate. */
  requires: StationName[]
  /**
   * Runs only after the engine has verified every required station is present,
   * ok, and non-empty — so the body can read `stations.crawl!.data` without
   * re-checking. The engine, not the check, owns the not_run rules.
   */
  evaluate: (stations: StationBundle) => Finding
}
