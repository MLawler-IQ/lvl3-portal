// One lifecycle for tool_runs.
//
// There were two before, and neither works for an orchestrator:
//
//   1. persistRun (app/actions/tool-runs.ts) inserts an already-`complete` row.
//      It's called from ExportTool — i.e. runs are recorded when a human clicks
//      export, not when the tool runs. An orchestrator run is never exported, so
//      it would never be recorded at all.
//   2. The four app/api/tools routes hand-roll insert-running-then-update, three
//      times each, inconsistently: `started_at` is set in 3 of 4, `output` is
//      wrapped in a key in 3 of 4, and a `failed` branch exists in 3 of 4.
//
// That last inconsistency is a slow leak. content-refresh-finder has no `failed`
// branch, so a thrown error leaves the row `running` forever — and the retention
// sweep (cleanup_old_tool_data) only deletes terminal states, so those rows are
// never reaped.
//
// Rate limiting: checkRateLimit counts tool_runs rows by user_id. Orchestrator
// runs therefore record `user_id: null` so they cannot consume a human's hourly
// budget, with the attribution kept in `input._invocation` instead.

import { logError } from '@/lib/logging'
import type { ServiceClient, ToolResult, ToolSource } from './contract'

export type RunStatus = 'queued' | 'running' | 'complete' | 'partial' | 'failed'

export interface RunHandle {
  runId: string | null
  service: ServiceClient
}

export interface StartRunParams {
  service: ServiceClient
  toolSlug: string
  clientId?: string | null
  input: Record<string, unknown>
  invoker: { kind: 'user'; userId: string } | { kind: 'orchestrator'; parentRunId?: string }
}

/**
 * Open a run row. Returns a handle whose `runId` may be null — a recording
 * failure must never stop the tool from running, so this degrades rather than
 * throwing.
 */
export async function startRun(params: StartRunParams): Promise<RunHandle> {
  const { service, toolSlug, clientId, input, invoker } = params
  try {
    const { data, error } = await service
      .from('tool_runs')
      .insert({
        tool_slug: toolSlug,
        client_id: clientId ?? null,
        // null for orchestrator runs, so checkRateLimit's user_id filter skips
        // them and a pipeline can't exhaust a strategist's hourly allowance.
        user_id: invoker.kind === 'user' ? invoker.userId : null,
        input: {
          ...input,
          _invocation:
            invoker.kind === 'user'
              ? { by: 'user', userId: invoker.userId }
              : { by: 'orchestrator', parentRunId: invoker.parentRunId ?? null },
        },
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      logError('tool-runs.start', `insert failed for ${toolSlug}`, { detail: error.message })
      return { runId: null, service }
    }
    return { runId: data.id as string, service }
  } catch (err) {
    logError('tool-runs.start', `threw for ${toolSlug}`, {
      detail: err instanceof Error ? err.message : String(err),
    })
    return { runId: null, service }
  }
}

/**
 * Close a run from a ToolResult, so the envelope decides the status rather than
 * each call site guessing.
 *
 * A degraded success records `partial`, not `complete` — the whole point of
 * carrying `degraded` is that a half-complete run must not look finished.
 */
export async function finishRun<T>(
  handle: RunHandle,
  result: ToolResult<T>,
): Promise<void> {
  if (!handle.runId) return

  const status: RunStatus = !result.ok ? 'failed' : result.degraded ? 'partial' : 'complete'

  const output: Record<string, unknown> = result.ok
    ? {
        data: result.data,
        sources: result.sources,
        ...(result.degraded ? { degraded: true, notes: result.notes ?? [] } : {}),
        durationMs: result.durationMs,
      }
    : {
        ...(result.partial !== undefined ? { partial: result.partial } : {}),
        sources: result.sources,
        durationMs: result.durationMs,
      }

  try {
    const { error } = await handle.service
      .from('tool_runs')
      .update({
        status,
        output,
        error: result.ok ? null : result.error,
        completed_at: new Date().toISOString(),
      })
      .eq('id', handle.runId)

    if (error) {
      logError('tool-runs.finish', 'update failed', { runId: handle.runId, detail: error.message })
    }
  } catch (err) {
    logError('tool-runs.finish', 'threw', {
      runId: handle.runId,
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Close a run that died outside the envelope — a thrown error, a timeout, a
 * cancelled request. Every catch block that opens a run must call this, or the
 * row stays `running` and outlives the retention sweep.
 */
export async function failRun(
  handle: RunHandle,
  error: unknown,
  sources: ToolSource[] = [],
): Promise<void> {
  if (!handle.runId) return
  try {
    await handle.service
      .from('tool_runs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        output: { sources },
        completed_at: new Date().toISOString(),
      })
      .eq('id', handle.runId)
  } catch {
    // Nothing useful left to do; the row will be visible as stuck.
  }
}
