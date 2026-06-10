import { createServiceClient } from '@/lib/supabase/server'

/**
 * Per-user rate limit for expensive tool runs, backed by the tool_runs table
 * (no extra infra). Counts the user's runs in the trailing hour and refuses
 * once the cap is hit. Pass toolSlug to scope the limit to one tool.
 */
export async function checkRateLimit(
  userId: string,
  opts: { maxPerHour: number; toolSlug?: string },
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const service = await createServiceClient()
  const since = new Date(Date.now() - 3_600_000).toISOString()
  let query = service
    .from('tool_runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  if (opts.toolSlug) query = query.eq('tool_slug', opts.toolSlug)
  const { count } = await query
  if ((count ?? 0) >= opts.maxPerHour) {
    return { ok: false, retryAfterSeconds: 3600 }
  }
  return { ok: true, retryAfterSeconds: 0 }
}

/** Standard 429 response for a tripped limit. */
export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: 'Rate limit reached. Please wait before running this tool again.' }),
    { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) } },
  )
}
