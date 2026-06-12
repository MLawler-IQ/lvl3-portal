import { createClient } from '@/lib/supabase/server'
import { userCanAccessClient, type AuthUser } from '@/lib/auth'

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export type GuardResult =
  | { ok: true; user: AuthUser; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: Response }

/**
 * Shared auth gate for API route handlers — collapses the repeated
 * getUser → role check → client-scope check boilerplate. Returns the authed
 * user (with profile) or a ready-to-return 401/403 Response.
 *
 * Pass `clientId` (parsed from the request body) to also enforce
 * client-scope: admins always pass, client-role users only their pinned
 * client, members only clients granted via user_client_access.
 */
export async function guardRoute(opts: {
  roles: Array<'admin' | 'member' | 'client'>
  clientId?: string | null
}): Promise<GuardResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: jsonError('Unauthorized', 401) }

  const { data: profile } = await supabase
    .from('users')
    .select('role, client_id, status')
    .eq('id', user.id)
    .single()

  const role = profile?.role as AuthUser['role'] | undefined
  if (!profile || !role || !opts.roles.includes(role)) {
    return { ok: false, response: jsonError('Forbidden', 403) }
  }
  // Deactivated users are blocked everywhere — these route handlers do manual
  // auth (no requireAuth), so enforce the status column here too.
  if (profile.status === 'deactivated') {
    return { ok: false, response: jsonError('Forbidden', 403) }
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email ?? '',
    role,
    client_id: (profile.client_id as string | null) ?? null,
  }

  if (opts.clientId && !(await userCanAccessClient(authUser, opts.clientId))) {
    return { ok: false, response: jsonError('Forbidden: no access to this client', 403) }
  }

  return { ok: true, user: authUser, supabase }
}
