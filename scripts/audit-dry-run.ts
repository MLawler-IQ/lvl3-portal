/**
 * Run the audit pipeline over a Sitebulb export and print what it found.
 *
 * Usage (from the repo root):
 *   PATH=/opt/homebrew/bin:/usr/local/bin:$PATH node --import ./scripts/ts-alias-hook.mjs \
 *     --env-file=.env.local scripts/audit-dry-run.ts <exportDir> [flags]
 *
 * The --import is not optional: it installs the module resolution that lets Node run repo
 * TypeScript with `@/` specifiers and a JSON import. See scripts/ts-alias-hook.mjs.
 * Drop --env-file when running with --offline, which needs no environment at all.
 *
 *   <exportDir>        Sitebulb export root (the directory holding *_internal.csv)
 *   --client <uuid>    resolve the client row: GSC property, site origin, attribution
 *   --site <origin>    explicit origin for robots.txt / llms.txt
 *   --gsc <property>   explicit GSC property (sc-domain:example.com | https://example.com/)
 *   --days <n>         GSC window in days (default 90)
 *   --no-gsc           skip the GSC station
 *   --no-robots        skip the site files
 *   --no-record        do not write tool_runs rows
 *   --offline          all three of the above; needs no Supabase and no network
 *   --compare          diff the run against fixtures/ingest/recorded-real-export.json
 *   --json             print the AuditRunResult as JSON instead of the tables
 *
 * WHY <exportDir> IS THE POSITIONAL AND --client IS A FLAG. AUTOMATION-PLAN.md documents
 * this as `<clientId> <dir>`, but a positional pair whose FIRST element is the optional one
 * is a trap, and the client id is precisely what you do not have in a sandbox with no
 * Supabase env. The two-positional form is still accepted so the documented command line
 * keeps working.
 *
 * Exit codes:
 *   0  the pipeline ran and the findings printed. A failed station is still 0 — an honest
 *      not_run is a legitimate result, not an error.
 *   1  usage error, or the crawl station produced nothing so there is nothing to look at.
 *   2  --compare found a figure that does not match the recorded export.
 */

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import recordedExport from '@/fixtures/ingest/recorded-real-export.json'
import { compareRecorded, comparisonExitCode } from '@/lib/audit/recorded'
import { LocalDirSource } from '@/lib/ingest/sitebulb/source'
import { formatAuditRun, formatRecordedComparison } from '@/lib/orchestrator/report-text'
import { runAudit } from '@/lib/orchestrator/run'
import type { StationName } from '@/lib/findings/types'

interface Args {
  dir: string
  clientId: string | null
  site: string | null
  gsc: string | null
  days: number | undefined
  skip: StationName[]
  robots: boolean
  record: boolean
  compare: boolean
  json: boolean
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  let clientId: string | null = null
  let site: string | null = null
  let gsc: string | null = null
  let days: number | undefined
  let noGsc = false
  let robots = true
  let record = true
  let compare = false
  let json = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} needs a value`)
      i += 1
      return next
    }
    switch (arg) {
      case '--client': clientId = value(); break
      case '--site': site = value(); break
      case '--gsc': gsc = value(); break
      case '--days': {
        const n = Number(value())
        if (!Number.isFinite(n) || n <= 0) throw new UsageError('--days needs a positive number')
        days = n
        break
      }
      case '--no-gsc': noGsc = true; break
      case '--no-robots': robots = false; break
      case '--no-record': record = false; break
      case '--offline': noGsc = true; robots = false; record = false; break
      case '--compare': compare = true; break
      case '--json': json = true; break
      case '-h':
      case '--help': throw new UsageError('help')
      default:
        if (arg.startsWith('--')) throw new UsageError(`unknown flag ${arg}`)
        positional.push(arg)
    }
  }

  // The documented `<clientId> <dir>` form. A bare uuid is never a directory, so the two
  // shapes cannot be confused.
  let dir: string
  if (positional.length === 2) {
    ;[clientId, dir] = positional
  } else if (positional.length === 1) {
    dir = positional[0]
  } else if (positional.length === 0) {
    throw new UsageError('an export directory is required')
  } else {
    throw new UsageError(`expected one export directory, got ${positional.length} arguments`)
  }

  return { dir, clientId, site, gsc, days, skip: noGsc ? ['gsc'] : [], robots, record, compare, json }
}

/**
 * What was switched off, for the header.
 *
 * Spelled out rather than printed as "offline", because a reader of the output needs to
 * know WHICH stations were skipped to know what the not_run rows mean.
 */
function describeMode(args: Args): string {
  const off: string[] = []
  if (args.skip.includes('gsc')) off.push('no-gsc')
  if (!args.robots) off.push('no-robots')
  if (!args.record) off.push('no-record')
  return off.length === 0 ? 'all stations, recording on' : off.join(' · ')
}

const USAGE = `usage: node --import ./scripts/ts-alias-hook.mjs scripts/audit-dry-run.ts <exportDir> [flags]

  --client <uuid>   --site <origin>   --gsc <property>   --days <n>
  --no-gsc   --no-robots   --no-record   --offline   --compare   --json

See the header of scripts/audit-dry-run.ts for the full description.`

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message !== 'help') console.error(`audit-dry-run: ${err.message}\n`)
      console.error(USAGE)
      return 1
    }
    throw err
  }

  const dir = resolve(args.dir)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`audit-dry-run: ${args.dir} is not a directory`)
    return 1
  }

  const result = await runAudit({
    crawl: LocalDirSource(dir),
    clientId: args.clientId,
    siteUrl: args.site,
    gscSiteUrl: args.gsc,
    gscDays: args.days,
    skip: args.skip,
    robots: args.robots,
    record: args.record,
    onProgress: (m) => process.stderr.write(`· ${m}\n`),
  })

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    // The formatter cannot derive these: the result holds a source object with no name,
    // does not echo the client id, and has no notion of a CLI mode.
    console.log(
      formatAuditRun(result, {
        exportLabel: args.dir,
        client: args.clientId,
        mode: describeMode(args),
      }),
    )
  }

  // A run with no crawl station produced no knowledge at all — every registered check
  // reports not_run — so it is a failure of the invocation rather than a finding about
  // the site.
  if (result.status === 'failed') {
    console.error('\naudit-dry-run: the crawl station produced nothing; there is no audit to read.')
    return 1
  }

  if (args.compare) {
    const rows = compareRecorded(result, recordedExport)
    if (!args.json) console.log(formatRecordedComparison(rows))
    return comparisonExitCode(rows)
  }

  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
