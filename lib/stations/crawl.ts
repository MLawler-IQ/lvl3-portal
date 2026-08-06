// The crawl station: a Sitebulb export source → the envelope runChecks consumes.
//
// TAKES A SOURCE AND NOTHING ELSE — no ToolContext, no ServiceClient. Nothing on the
// ingest path needs auth or Postgres, and taking a context would cost twice: the station
// stops being runnable from a script with no env vars (the dry-run's whole point is that a
// CSV directory is enough), and a `service` handle lands in scope, which is how a DB read
// gets added here later and a subsequent slice's "npm test green with no Supabase env" gate
// starts failing for a reason nobody would think to look for in an ingester.
//
// NOT A CallableTool, and deliberately absent from lib/tools/callable/index.ts.
// Registration would give it a `requires` shape, and `requires` must never be authoritative
// for data availability: it says what the caller should resolve first, not what the export
// actually contained. `SitebulbCoverage` is the authority, and the engine's station gating
// is the enforcement. A `requires: { client: true }` here would read as a guarantee.
//
// ORDER INSIDE THE BODY IS LOAD-BEARING. The ingest runs first so a missing backbone is the
// error the operator reads. Read the workbook first and an export with no *_internal.csv
// reports "the workbook was unreadable" — true, and useless.

import { ingestSitebulbCrawl, type SitebulbCoverage } from '@/lib/ingest/sitebulb/crawl'
import { readSitebulbManifest } from '@/lib/ingest/sitebulb/manifest'
import type { CrawlExportSource } from '@/lib/ingest/sitebulb/source'
import { crawlDegradation } from '@/lib/stations/degradation'
import { runGuarded, toolOk } from '@/lib/tools/contract'
import type { CrawlStationData } from '@/lib/tools/crawl-record'
import type { CrawlStationRun } from '@/lib/orchestrator/types'

/**
 * Run the crawl station over one export.
 *
 * No `partial` on the backbone error. A page list built from triggered hints alone is the
 * exact artifact the backbone rule forbids — it makes a `pass` indistinguishable from a
 * check that never ran — so handing one back in `partial` would invite a caller to use it.
 * The ToolErr carries the explanation and nothing else.
 */
export async function runCrawlStation(source: CrawlExportSource): Promise<CrawlStationRun> {
  // runGuarded returns a ToolResult and can carry nothing beside it, while coverage has to
  // reach the caller structurally (slice 4 persists it to audit_runs.coverage; a string[]
  // of notes cannot carry counts). Widening the tool envelope for one station's ingest
  // metadata would put an ingest-shaped field on all sixteen tools. So the binding lives
  // out here and the guarded body assigns it — which also makes the null case exact: the
  // only way out of the body without assigning is the backbone throw, when no coverage
  // record was ever computed.
  let coverage: SitebulbCoverage | null = null

  const result = await runGuarded<CrawlStationData>(['crawl'], async () => {
    const ingest = await ingestSitebulbCrawl(source)
    coverage = ingest.coverage

    // Caught separately, and never rethrown. A bad or absent summary.xlsx is ONE note: as
    // a ToolErr it would send all eight checks to not_run because a spreadsheet failed to
    // parse, while the CSVs that back every registered check were read fine.
    let problems: readonly string[]
    try {
      problems = (await readSitebulbManifest(source)).problems
    } catch (err) {
      problems = [
        `The export manifest could not be read (${err instanceof Error ? err.message : String(err)}), ` +
          `so an untriggered hint cannot be told apart from an unexported one.`,
      ]
    }

    const { degraded, notes } = crawlDegradation(ingest.coverage, problems)

    return toolOk(ingest.data, { sources: ['crawl'], degraded, notes })
  })

  return { result, coverage }
}
