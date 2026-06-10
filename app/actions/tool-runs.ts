'use server'

import { requireAuth, userCanAccessClient } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logging'
import type { ToolRun } from '@/components/tools/RunHistory'

/**
 * Persist a completed read-only tool run to tool_runs so results become
 * reloadable history instead of throwaway snapshots. Used by ExportTool and
 * any tool client that wants explicit saves. The run is stored as already
 * complete — these tools produce their result synchronously before saving.
 */
export async function persistRun(params: {
  toolSlug: string
  clientId?: string | null
  input: Record<string, unknown>
  output: Record<string, unknown>
}): Promise<{ runId?: string; error?: string }> {
  try {
    const { user } = await requireAuth()
    if (params.clientId && !(await userCanAccessClient(user, params.clientId))) {
      return { error: 'You do not have access to this client.' }
    }

    const service = await createServiceClient()
    const now = new Date().toISOString()
    const { data, error } = await service
      .from('tool_runs')
      .insert({
        tool_slug: params.toolSlug,
        client_id: params.clientId ?? null,
        user_id: user.id,
        input: params.input,
        output: params.output,
        status: 'complete',
        started_at: now,
        completed_at: now,
      })
      .select('id')
      .single()

    if (error) {
      logError('tool-runs.persist', `insert failed for ${params.toolSlug}`, error)
      return { error: error.message }
    }
    return { runId: data.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save run' }
  }
}

/**
 * Recent runs for a tool (optionally scoped to a client), newest first.
 * Uses the user-session client so RLS decides visibility (admins all,
 * members only their granted clients).
 */
export async function listToolRuns(
  toolSlug: string,
  clientId?: string | null,
  limit = 10,
): Promise<ToolRun[]> {
  try {
    const { supabase } = await requireAuth()
    let query = supabase
      .from('tool_runs')
      .select('id, tool_slug, client_id, status, created_at, completed_at, input, output, error')
      .eq('tool_slug', toolSlug)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (clientId) query = query.eq('client_id', clientId)
    const { data } = await query
    return (data ?? []) as ToolRun[]
  } catch {
    return []
  }
}
