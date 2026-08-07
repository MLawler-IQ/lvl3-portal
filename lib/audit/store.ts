// The pure half of storing an audit run: result → row, row → summary.
//
// NO SUPABASE, NO next/headers, NO IO. app/actions/audit.ts owns every read and write;
// this module owns the shapes and the rules. That split is the only way the mapping is
// testable at all — an audit run is expensive to produce and impossible to produce in a
// unit test with no export, no network and no database, so the alternative is asserting
// the persistence rules against nothing.
//
// THE RULE THIS FILE EXISTS TO ENFORCE (docs/CONTEXT-LIBRARY.md §3, commit c36a9a3):
// a reader that cannot answer says so. `readStoredResult` returns null with a reason when
// the stored envelope is not the shape this build writes, and `toAuditRunSummary` then
// reports `findingCounts: null`. It does NOT return zeros. "0 fail" and "we could not
// read this run" render identically in a table, and only one of them is good news.

import { normalizeDomain } from '@/lib/normalize-domain'
import type { Finding, FindingStatus } from '@/lib/findings/types'
import type { AuditRunResult } from '@/lib/orchestrator/types'

/** Mirrors the `status` check constraint on public.audit_runs. */
export const AUDIT_RUN_STATUSES = ['complete', 'partial', 'failed'] as const
export type AuditRunStatus = (typeof AUDIT_RUN_STATUSES)[number]

/**
 * The stored run, which is `AuditRunResult` MINUS the station bundle.
 *
 * `stations` holds the entire crawled page set and every raw GSC row. It is already
 * recorded per station in `tool_runs` (lib/orchestrator/recorder.ts), and nothing that
 * reads a stored run wants it: lib/orchestrator/report-text.ts renders a run from
 * stationStatus, coverage, findings, scoring, recording and notes, and never touches
 * `stations`. `stationStatus` — the part that explains why a check reads not_run — is
 * stored in full.
 */
export type PersistedAuditRun = Omit<AuditRunResult, 'stations'>

/**
 * Adapt a stored run back to the formatter's parameter type.
 *
 * The empty bundle is a TYPE ADAPTER, not a claim that no station ran. It is safe only
 * because `formatAuditRun` provably does not read `stations`; `stationStatus`, which is
 * stored complete, is the authority on what each station did. If the formatter ever
 * starts reading the bundle this function becomes a lie and has to go.
 */
export function forReport(run: PersistedAuditRun): AuditRunResult {
  return { ...run, stations: {} }
}

/**
 * What we know about WHOSE site the uploaded export describes.
 *
 * Nothing in the pipeline validates that an export belongs to the client it is being
 * filed under — `runAudit` takes a `clientId` and a `CrawlExportSource` and never
 * compares them, and it could not: an export carries no client id. This record does not
 * fix that. It makes the mismatch VISIBLE after the fact by writing down both sides —
 * the origins the export's own page URLs carry, and the origin on the client row — plus
 * a verdict that is `unknown` rather than `match` whenever either side is missing.
 */
export interface AuditExportAttribution {
  /** The source label handed to runAudit, echoed so the header can print it. */
  label: string
  fileCount: number
  /**
   * The `*_internal.csv` entry, verbatim.
   *
   * Sitebulb prefixes every export with the crawled host, so this filename is a second
   * origin signal that survives even when the crawl station failed and there are no
   * pages to read origins from. Stored raw and NOT parsed into a hostname: the prefix
   * replaces dots with underscores, so `foo_bar_com` could be `foo-bar.com` or
   * `foo.bar.com` and there is no way to tell. A human reading it knows; a parser guesses.
   */
  backboneFile: string | null
  /** Distinct origins seen in the export's own page URLs, capped. Empty when unknown. */
  origins: string[]
  /** True when `origins` was capped, so a short list cannot read as an exhaustive one. */
  originsTruncated: boolean
  /** `clients.website_url`, verbatim. Null when the client row has none. */
  clientWebsiteUrl: string | null
  /**
   * Where the export this run read still lives, as a storage prefix.
   *
   * The retention decision is to KEEP an uploaded export, on the grounds that a
   * derived fact should point at an artifact that still exists — but a run with
   * nowhere to point makes that an argument rather than a link. Provenance was
   * otherwise an inference from a timestamp and a backbone filename, which is a
   * guess dressed as a record.
   *
   * Null for a run whose bytes never went through storage: the CLI reads a local
   * directory, and nothing there outlives the process. Null therefore means "not
   * stored", never "lost".
   */
  sourcePrefix: string | null
  verdict: 'match' | 'mismatch' | 'unknown'
  /** Why the verdict is what it is, in words, for the run header. */
  reason: string
}

/** The jsonb document in `audit_runs.result`. Versioned so an old shape is detectable. */
export interface StoredAuditResult {
  version: 1
  run: PersistedAuditRun
  export: AuditExportAttribution
}

const STORED_RESULT_VERSION = 1

/** The insert payload for public.audit_runs. Snake case: it is a row, not a value object. */
export interface AuditRunInsert {
  client_id: string
  status: AuditRunStatus
  config_version: string
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  result: StoredAuditResult
  notes: string[]
  created_by: string | null
}

/** One row of public.audit_runs as it comes back from a select. */
export interface AuditRunRow {
  id: string
  client_id: string
  status: string
  config_version: string
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  result: unknown
  notes: string[] | null
  created_by: string | null
  created_at: string
}

export interface FindingCounts {
  total: number
  fail: number
  degraded: number
  pass: number
  not_run: number
}

export interface AuditRunSummary {
  id: string
  clientId: string
  status: AuditRunStatus
  configVersion: string
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  createdAt: string
  createdBy: string | null
  notes: string[]
  /**
   * Null means THE STORED ENVELOPE COULD NOT BE READ, never "this run found nothing".
   * `unreadableReason` says which it is. A zeroed count here would render as a clean
   * audit in a list view.
   */
  findingCounts: FindingCounts | null
  exportAttribution: AuditExportAttribution | null
  unreadableReason?: string
}

/** A stored run, loaded. `run` is null when the envelope was unreadable. */
export interface StoredAuditRun extends AuditRunSummary {
  run: PersistedAuditRun | null
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/**
 * The backbone suffix, matched EXACTLY as lib/ingest/sitebulb/crawl.ts matches it.
 *
 * That file builds `_${suffix}.csv` from `SOURCES.internal` and locates the file with
 * `endsWith`, so a name like `internal.csv` with no host prefix does not match there and
 * must not match here either. The duplication is deliberate and bounded: the point of
 * checking up front is that an operator who uploaded the wrong folder is told so before a
 * run is attempted and a row is written, and reaching into the ingester to ask would mean
 * importing the ingest path into the validation path. If the ingester's matching rule ever
 * changes, tests/unit/audit-store.test.ts and tests/unit/sitebulb-ingest.test.ts both
 * pin the same string.
 */
const BACKBONE_SUFFIX = '_internal.csv'

/** The `*_internal.csv` entry in an upload, or null when there is none. */
export function findBackboneFile(names: readonly string[]): string | null {
  return names.find((n) => n.endsWith(BACKBONE_SUFFIX)) ?? null
}

/**
 * Why this upload cannot be audited, or null when it can be.
 *
 * NAMES WHAT IS MISSING AND WHAT ARRIVED. "Invalid export" sends an operator back to
 * Sitebulb with no idea what to change; a message that says the backbone is absent and
 * lists the four CSVs that were uploaded lets them see they exported the hints folder,
 * or dragged in the reports subdirectory, or picked the wrong crawl.
 *
 * This is the documented failure (lib/ingest/sitebulb/crawl.ts:151): without the backbone
 * the page list would come from triggered hints only, and a `pass` over a hint-derived
 * page list is indistinguishable from a check that never ran.
 */
export function describeMissingBackbone(names: readonly string[]): string | null {
  if (names.length === 0) {
    return 'No files were uploaded. A Sitebulb export needs at least its *_internal.csv, which is the page backbone.'
  }
  if (findBackboneFile(names) !== null) return null

  const listed = names.slice(0, 12).join(', ')
  const more = names.length > 12 ? `, and ${names.length - 12} more` : ''
  return (
    `This upload has no *_internal.csv, so there is no audit to run. That file is the page ` +
    `backbone: without it the page list would come from triggered hints only, and a pass ` +
    `would be indistinguishable from a check that never ran. ` +
    `Uploaded: ${listed}${more}.`
  )
}

/**
 * Build the file map `BufferSource` takes, with names forward-slashed.
 *
 * Backslashes are converted rather than rejected because a Windows-produced zip writes
 * them, and `crawl.ts` matches `hints/x.csv` by suffix — a backslashed entry would simply
 * never match any report and the export would look empty rather than mis-named.
 *
 * A duplicate name is REPORTED, not silently collapsed. A Map keeps the last write, so two
 * entries called `..._internal.csv` mean the audit ran over one of them and nobody knows
 * which; that belongs in the run's notes.
 */
export function buildExportFiles(
  files: readonly { name: string; bytes: Uint8Array }[],
): { files: Map<string, Uint8Array>; duplicates: string[] } {
  const map = new Map<string, Uint8Array>()
  const duplicates: string[] = []
  for (const file of files) {
    const name = file.name.replace(/\\/g, '/').replace(/^\.\//, '')
    if (map.has(name)) duplicates.push(name)
    map.set(name, file.bytes)
  }
  return { files: map, duplicates }
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/** More than this and the list stops being readable; a real crawl has one. */
const MAX_ORIGINS = 5

/**
 * Compare the export against the client row it is being filed under.
 *
 * Hosts are compared through `normalizeDomain`, so `https://www.example.com` and
 * `https://example.com` match — that difference is a redirect, not a different client.
 * Scheme is deliberately NOT compared: an http-vs-https difference is a site fact, not an
 * attribution fact, and flagging it as a mismatch would train an operator to ignore the
 * verdict. Both raw values are kept in the record so a human can still see it.
 */
export function describeExport(
  result: AuditRunResult,
  opts: {
    label: string
    fileCount: number
    backboneFile: string | null
    clientWebsiteUrl: string | null
    /** Storage prefix the export is retained under, or null when it was never stored. */
    sourcePrefix?: string | null
  },
): AuditExportAttribution {
  const crawl = result.stations.crawl
  const seen = new Set<string>()
  if (crawl?.ok) {
    for (const page of crawl.data.pages) {
      try {
        seen.add(new URL(page.url).origin)
      } catch {
        // A page URL that does not parse is a crawl-ingest problem, not an attribution
        // one, and it is already visible in the coverage block. Skipping it here keeps
        // one unparseable row from emptying the origin list.
      }
    }
  }

  const all = Array.from(seen).sort()
  const origins = all.slice(0, MAX_ORIGINS)
  const clientWebsiteUrl = opts.clientWebsiteUrl?.trim() || null

  const base = {
    label: opts.label,
    fileCount: opts.fileCount,
    backboneFile: opts.backboneFile,
    origins,
    originsTruncated: all.length > origins.length,
    clientWebsiteUrl,
    sourcePrefix: opts.sourcePrefix ?? null,
  }

  if (all.length === 0) {
    return {
      ...base,
      verdict: 'unknown',
      reason:
        'The export produced no readable page URLs, so which site it describes cannot be established from the export itself. Check the backbone filename, which Sitebulb prefixes with the crawled host.',
    }
  }
  if (clientWebsiteUrl === null) {
    return {
      ...base,
      verdict: 'unknown',
      reason: `This client has no website_url, so there is nothing to compare the export's origin (${all.join(', ')}) against.`,
    }
  }

  const clientHost = normalizeDomain(clientWebsiteUrl)
  const exportHosts = Array.from(new Set(all.map((o) => normalizeDomain(o))))
  const off = exportHosts.filter((h) => h !== clientHost)

  if (off.length === 0) {
    return {
      ...base,
      verdict: 'match',
      reason: `Every crawled URL is on ${clientHost}, which is this client's website_url.`,
    }
  }
  return {
    ...base,
    verdict: 'mismatch',
    reason:
      `This client's website_url is ${clientHost}, but the export crawled ${off.join(', ')}. ` +
      `Nothing prevented this upload from being filed here — the pipeline cannot check that an ` +
      `export belongs to a client — so treat every finding in this run as being about ${off.join(', ')}.`,
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Result → row.
 *
 * EVERY run maps, including `status: 'failed'`. A failed run is the record that an export
 * was unusable on a given day, and discarding it is how the same broken export gets
 * uploaded a second time and fails the same way. The row still carries the station strip
 * that says which station produced nothing and why.
 */
export function toAuditRunInsert(input: {
  result: AuditRunResult
  clientId: string
  createdBy: string | null
  attribution: AuditExportAttribution
  /** Notes about the INTAKE rather than about the run — duplicate entries, and so on. */
  intakeNotes?: readonly string[]
}): AuditRunInsert {
  // Omit-by-destructure: `stations` is the raw substrate (every crawled page,
  // every GSC row) and is already written per station to tool_runs by
  // lib/orchestrator/recorder.ts. Copying it here would duplicate the largest
  // payload in the system into a second table with no reader.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stations: _stations, ...run } = input.result

  return {
    client_id: input.clientId,
    status: input.result.status,
    config_version: input.result.configVersion,
    started_at: input.result.startedAt,
    completed_at: input.result.completedAt,
    duration_ms: input.result.durationMs,
    result: { version: STORED_RESULT_VERSION, run, export: input.attribution },
    // The run's own notes plus the intake's. The attribution reason rides along when it
    // is not a clean match, so a mismatch is legible in a list view that never opens the
    // stored document.
    notes: [
      ...input.result.notes,
      ...(input.attribution.verdict === 'match' ? [] : [`Export attribution: ${input.attribution.reason}`]),
      ...(input.intakeNotes ?? []),
    ],
    created_by: input.createdBy,
  }
}

/**
 * Read the stored envelope, or say why it could not be read.
 *
 * Structural, not a zod schema: the payload is a document this same module wrote, and the
 * question being asked is "is this the shape this build understands", which the version
 * plus a handful of field probes answers. A full schema over AuditRunResult would have to
 * be maintained in parallel with the types and would fail the whole document over a field
 * nothing reads.
 */
export function readStoredResult(
  raw: unknown,
): { ok: true; stored: StoredAuditResult } | { ok: false; reason: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'the stored result is not an object' }
  }
  const doc = raw as Partial<StoredAuditResult>
  if (doc.version !== STORED_RESULT_VERSION) {
    return {
      ok: false,
      reason: `the stored result is version ${JSON.stringify(doc.version)}, and this build writes version ${STORED_RESULT_VERSION}`,
    }
  }
  if (doc.run === null || typeof doc.run !== 'object' || !Array.isArray(doc.run.findings)) {
    return { ok: false, reason: 'the stored result has no findings array' }
  }
  return { ok: true, stored: doc as StoredAuditResult }
}

const COUNTED_STATUSES: readonly FindingStatus[] = ['fail', 'degraded', 'pass', 'not_run']

/**
 * Counts by status. All four keys always present — "0 not_run" is information.
 *
 * The membership test is a RUNTIME one even though the type says it cannot fail: these
 * findings were parsed out of jsonb, so a row written by a different build can carry a
 * status this one has no bucket for. Such a finding counts toward `total` and toward no
 * bucket, which makes the four buckets visibly fail to sum — better than a default branch
 * quietly filing an unknown status under `pass`.
 */
export function countFindings(findings: readonly Finding[]): FindingCounts {
  const counts: FindingCounts = { total: findings.length, fail: 0, degraded: 0, pass: 0, not_run: 0 }
  for (const finding of findings) {
    if (COUNTED_STATUSES.includes(finding.status)) counts[finding.status] += 1
  }
  return counts
}

/** Row → summary. Never throws: a list view must render every row it was given. */
export function toAuditRunSummary(row: AuditRunRow): AuditRunSummary {
  const parsed = readStoredResult(row.result)
  const base: AuditRunSummary = {
    id: row.id,
    clientId: row.client_id,
    // The column is constrained to these three, so an unexpected value means the
    // constraint was changed without this file. Saying `failed` would be a fabricated
    // verdict; `partial` is the honest "something here is not fully known".
    status: isAuditRunStatus(row.status) ? row.status : 'partial',
    configVersion: row.config_version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    createdBy: row.created_by,
    notes: row.notes ?? [],
    findingCounts: null,
    exportAttribution: null,
  }

  if (!parsed.ok) return { ...base, unreadableReason: parsed.reason }

  return {
    ...base,
    findingCounts: countFindings(parsed.stored.run.findings),
    exportAttribution: parsed.stored.export ?? null,
  }
}

/** Row → the full stored run. `run` is null exactly when the envelope was unreadable. */
export function toStoredAuditRun(row: AuditRunRow): StoredAuditRun {
  const parsed = readStoredResult(row.result)
  return { ...toAuditRunSummary(row), run: parsed.ok ? parsed.stored.run : null }
}

function isAuditRunStatus(value: string): value is AuditRunStatus {
  return (AUDIT_RUN_STATUSES as readonly string[]).includes(value)
}

/**
 * The context-library title for a stored run.
 *
 * Carries the status and the date because the library lists items by title, and "Audit
 * run" repeated five times is a list nobody can navigate.
 */
export function auditReportTitle(summary: {
  status: AuditRunStatus
  startedAt: string
  findingCounts?: FindingCounts | null
}): string {
  const day = summary.startedAt.slice(0, 10)
  const counts = summary.findingCounts
  const tail = counts ? ` · ${counts.fail} fail, ${counts.not_run} not_run` : ''
  return `Audit run ${day} · ${summary.status}${tail}`
}
