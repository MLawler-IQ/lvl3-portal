'use server'

// Run an audit from the portal, and keep the run.
//
// Until this file existed the only way to produce an audit was
// `node --import ./scripts/ts-alias-hook.mjs scripts/audit-dry-run.ts <dir> --client <uuid>`
// against a directory on someone's laptop, and the result printed to a terminal and was
// gone. `runAudit` had exactly two callers, both offline (docs/CONTEXT-LIBRARY.md §1).
//
// THE UPLOAD IS IN MEMORY, END TO END. There is no storage bucket and no writable tree on
// a Vercel function, which is why `CrawlExportSource` exists at all — `BufferSource` takes
// the uploaded bytes as a Map and the ingesters read from it exactly as they read a local
// fixture directory. Nothing is written to disk at any point.
//
// ORDER: STORE THE RUN, THEN DERIVE THE LIBRARY ITEM. Same rule as the Zoom import
// (app/actions/zoom-context.ts) and for the same reason, pointed the other way: there the
// transcript is the evidence and the extraction is a derived reading, here the run is the
// record and the report text is a derived reading of it. A failure in the second step must
// never cost the first.

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logging'
import { BufferSource } from '@/lib/ingest/sitebulb/source'
import { runAudit } from '@/lib/orchestrator/run'
import { formatAuditRun } from '@/lib/orchestrator/report-text'
import {
  auditReportTitle,
  buildExportFiles,
  describeExport,
  describeMissingBackbone,
  findBackboneFile,
  forReport,
  toAuditRunInsert,
  toAuditRunSummary,
  toStoredAuditRun,
  type AuditExportAttribution,
  type AuditRunRow,
  type AuditRunSummary,
  type StoredAuditRun,
} from '@/lib/audit/store'
import type { AuditRunResult } from '@/lib/orchestrator/types'
import type { ServiceClient } from '@/lib/tools/contract'

/** The columns a summary needs. Spelled out so `result` is fetched once, not twice. */
const RUN_COLUMNS =
  'id, client_id, status, config_version, started_at, completed_at, duration_ms, result, notes, created_by, created_at'

export interface RunClientAuditInput {
  clientId: string
  /**
   * The export's entries. `name` is source-relative and forward-slashed — the same
   * convention `CrawlExportSource.list()` promises, because these names go straight into
   * a `BufferSource` and `lib/ingest/sitebulb/crawl.ts` locates every report by suffix.
   * A nested `hints/foo.csv` is expected and a top-level export directory prefix is fine.
   */
  files: { name: string; bytes: Uint8Array }[]
}

export interface RunClientAuditResult {
  error?: string
  runId?: string
  summary?: AuditRunSummary
}

/**
 * Run an audit for a client over an uploaded Sitebulb export, and store it.
 *
 * WHAT THIS CANNOT ENFORCE. Nothing checks that the export actually belongs to
 * `clientId`. It cannot: a Sitebulb export carries no client identity, `runAudit` never
 * compares its source against its clientId, and an admin uploading the wrong folder is
 * indistinguishable from one uploading the right one. What is done instead is to write
 * BOTH sides down — the origins the export's own page URLs carry and the client row's
 * `website_url` — and store a verdict of `match`, `mismatch` or `unknown`. A mismatch is
 * visible afterwards on the run and in its notes; it is not prevented, and this action
 * does not refuse the run over it, because a legitimate mismatch exists (a client whose
 * `website_url` is stale) and refusing would train an operator to fix the symptom.
 */
export async function runClientAudit(input: RunClientAuditInput): Promise<RunClientAuditResult> {
  try {
    const { user } = await requireAdmin()

    if (!input.clientId) return { error: 'Pick a client first.' }

    const names = input.files.map((f) => f.name)

    // Rejected BEFORE the run, so an operator who uploaded the wrong folder gets the
    // message about their upload rather than a stored `failed` run whose crawl station
    // says the same thing one screen deeper. The rule is the ingester's
    // (lib/ingest/sitebulb/crawl.ts), and the wording says which file and what was sent.
    const missing = describeMissingBackbone(names)
    if (missing !== null) return { error: missing }

    const service = await createServiceClient()
    const { data: client, error: clientErr } = await service
      .from('clients')
      .select('id, name, website_url')
      .eq('id', input.clientId)
      .maybeSingle()

    if (clientErr) return { error: `Could not read the client: ${clientErr.message}` }
    if (!client) return { error: 'Client not found.' }

    const backboneFile = findBackboneFile(names)
    const { files, duplicates } = buildExportFiles(input.files)

    // The label is what the ingester interpolates into its own error messages and what the
    // report header prints, so it names the backbone file: Sitebulb prefixes every export
    // with the crawled host, which makes the label itself an attribution signal.
    const label = `uploaded export ${backboneFile ?? '(unnamed)'} · ${files.size} files`

    const result = await runAudit({
      crawl: BufferSource(files, label),
      clientId: input.clientId,
      // siteUrl / gscSiteUrl are left to resolve off the client row, which is the whole
      // point of running this from the portal rather than from the CLI.
    })

    const attribution = describeExport(result, {
      label,
      fileCount: files.size,
      backboneFile,
      clientWebsiteUrl: (client.website_url as string | null) ?? null,
    })

    const intakeNotes: string[] = []
    if (duplicates.length > 0) {
      // A Map keeps the last write, so the audit ran over one of the duplicates and there
      // is no way to say which. That belongs on the record.
      intakeNotes.push(
        `The upload contained more than one entry named ${duplicates.join(', ')}; only the last of each was read.`,
      )
    }

    // ── the run is the record ────────────────────────────────────────────────────
    // Stored even when `status: 'failed'`. A failed run is the evidence that this export
    // was unusable on this day; discarding it is how the same export gets uploaded again.
    const { data: stored, error: insertErr } = await service
      .from('audit_runs')
      .insert(toAuditRunInsert({ result, clientId: input.clientId, createdBy: user.id, attribution, intakeNotes }))
      .select(RUN_COLUMNS)
      .single()

    if (insertErr || !stored) {
      logError('audit.store', 'The audit ran but could not be stored', {
        clientId: input.clientId,
        error: insertErr?.message,
      })
      return {
        error: `The audit ran (${result.status}) but could not be stored: ${insertErr?.message ?? 'no row returned'}. Nothing was kept — run it again.`,
      }
    }

    const summary = toAuditRunSummary(stored as AuditRunRow)

    // ── the library item is a derived read of the record ─────────────────────────
    const libraryError = await storeAuditReport({
      service,
      clientId: input.clientId,
      clientName: (client.name as string | null) ?? null,
      runId: summary.id,
      result,
      summary,
      attribution,
      addedBy: user.id,
    })

    if (libraryError !== null) {
      // The run is already durable, so this is a note on it rather than a failure of it.
      // Written back to the row so the record and the returned summary agree — a note that
      // exists only in this response disappears on the next page load.
      const notes = [...summary.notes, `The report could not be written to the context library: ${libraryError}`]
      summary.notes = notes
      const { error: noteErr } = await service.from('audit_runs').update({ notes }).eq('id', summary.id)
      if (noteErr) {
        logError('audit.notes', 'Could not annotate the stored run', { runId: summary.id, error: noteErr.message })
      }
    }

    revalidatePath(`/clients/${input.clientId}`)

    return { runId: summary.id, summary }
  } catch (err) {
    logError('audit.run', 'Audit run failed', {
      clientId: input.clientId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { error: err instanceof Error ? err.message : 'The audit could not be run.' }
  }
}

/**
 * Write the run's report into the context library.
 *
 * AN AUDIT RUN IS DERIVED DATA, NOT TESTIMONY. docs/CONTEXT-LIBRARY.md §5 splits stored
 * material three ways: `said` (a transcript, an email — a claim that needs confirming),
 * `observed` (a measurement — a snapshot), and `derived` (our own reading, only as good
 * as its inputs). This item is `derived`. It is our rubric's opinion of one crawl of one
 * site on one day, and every number in it inherits the export's blind spots — the
 * `not_run` rows are in the body precisely so a later reader cannot mistake absence for
 * a clean result. It must never be quoted back as though the client said it, and a slot
 * suggestion drawn from it is a suggestion about our own output, not about the business.
 *
 * `source_ref` is the audit run id, which makes re-storing the same run idempotent under
 * `uq_client_context_items_source_ref` rather than appending a second copy. Duplicate
 * copies of one artifact are how the extractor comes to "corroborate" a value against
 * what is really a single source.
 *
 * The body comes from `formatAuditRun` rather than from a format invented here: it is the
 * one renderer of a run in the repo, and its equal-weight guarantee for `not_run` rows is
 * a tested property (tests/unit/audit-report-text.test.ts). A second formatter would be a
 * second place for a `not_run` row to get quietly dimmed.
 *
 * Returns null on success, or the reason it failed.
 */
async function storeAuditReport(input: {
  service: ServiceClient
  clientId: string
  clientName: string | null
  runId: string
  result: AuditRunResult
  summary: AuditRunSummary
  attribution: AuditExportAttribution
  addedBy: string
}): Promise<string | null> {
  try {
    const body = formatAuditRun(input.result, {
      exportLabel: input.attribution.label,
      client: input.clientName,
      mode: `portal upload · export attribution ${input.attribution.verdict}`,
    })

    const row = {
      client_id: input.clientId,
      kind: 'audit_run' as const,
      source_ref: input.runId,
      title: auditReportTitle(input.summary),
      body,
      // The run's own start time, not now(): `occurred_at` is when the underlying thing
      // happened, and for a derived artifact that is when it was derived.
      occurred_at: input.summary.startedAt,
      added_by: input.addedBy,
    }

    // SELECT-then-write rather than upsert, because `uq_client_context_items_source_ref`
    // is a PARTIAL unique index (`where source_ref is not null`). PostgREST's `onConflict`
    // emits only a column list, and Postgres will not infer a partial index from one — the
    // upsert fails with "no unique or exclusion constraint matching the ON CONFLICT
    // specification" rather than doing the idempotent thing. app/actions/zoom-context.ts
    // reads the same index the same way.
    //
    // Two simultaneous re-stores of the same run could still both miss and one hit the
    // index. That surfaces as a note on the run, which is the correct outcome: the run
    // itself is already durable and the library item is a derived read of it.
    const { data: existing } = await input.service
      .from('client_context_items')
      .select('id')
      .eq('client_id', input.clientId)
      .eq('source_ref', input.runId)
      .maybeSingle()

    const { error } = existing
      ? await input.service.from('client_context_items').update(row).eq('id', existing.id)
      : await input.service.from('client_context_items').insert(row)

    return error ? error.message : null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Every stored run for a client, newest first.
 *
 * Returns an empty array on a read failure, which is the one place in this file that
 * cannot distinguish "no runs" from "could not look" — the signature has no error channel
 * and the callers are list views. The failure is logged rather than swallowed silently;
 * if a screen ever needs to tell the two apart, this signature is what has to change.
 */
export async function listAuditRuns(clientId: string): Promise<AuditRunSummary[]> {
  try {
    await requireAdmin()
    if (!clientId) return []

    const service = await createServiceClient()
    const { data, error } = await service
      .from('audit_runs')
      .select(RUN_COLUMNS)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      logError('audit.list', 'Could not list audit runs', { clientId, error: error.message })
      return []
    }

    return (data ?? []).map((row) => toAuditRunSummary(row as AuditRunRow))
  } catch (err) {
    logError('audit.list', 'Could not list audit runs', {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

export interface GetAuditRunResult {
  error?: string
  run?: StoredAuditRun
  /**
   * The run rendered by lib/orchestrator/report-text.ts — the same bytes stored in the
   * context library. Absent when the stored envelope could not be read, rather than an
   * empty string, so a detail view shows the reason instead of a blank panel.
   */
  report?: string
}

/** One stored run, with its rendered report. */
export async function getAuditRun(runId: string): Promise<GetAuditRunResult> {
  try {
    await requireAdmin()
    if (!runId) return { error: 'No run was requested.' }

    const service = await createServiceClient()
    const { data, error } = await service.from('audit_runs').select(RUN_COLUMNS).eq('id', runId).maybeSingle()

    if (error) return { error: `Could not read the run: ${error.message}` }
    if (!data) return { error: 'That audit run no longer exists.' }

    const run = toStoredAuditRun(data as AuditRunRow)
    if (run.run === null) {
      // The row is real and its columns are readable; only the stored document is not.
      // Handing back the summary with its `unreadableReason` beats an error, because the
      // status, timings and notes are still true.
      return { run }
    }

    return {
      run,
      report: formatAuditRun(forReport(run.run), {
        exportLabel: run.exportAttribution?.label ?? null,
        client: run.clientId,
        mode: `stored run · export attribution ${run.exportAttribution?.verdict ?? 'unknown'}`,
      }),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read the run.' }
  }
}
