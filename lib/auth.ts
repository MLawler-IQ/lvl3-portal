import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export type AuthUser = {
  id: string
  email: string
  role: 'admin' | 'member' | 'client'
  client_id: string | null
}

export async function requireAuth(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  user: AuthUser
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, client_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return {
    supabase,
    user: {
      id: user.id,
      email: user.email!,
      role: profile.role as 'admin' | 'member' | 'client',
      client_id: profile.client_id as string | null,
    },
  }
}

export async function requireAdmin() {
  const result = await requireAuth()
  if (result.user.role !== 'admin') redirect('/')
  return result
}

/**
 * Admin guard for server actions. Unlike requireAdmin(), this THROWS instead of
 * redirecting, so the calling client component can catch and surface the error.
 * Returns the admin's own identity for self-protection checks (e.g. an admin
 * must not be able to delete or demote their own account).
 */
export async function requireAdminUser(): Promise<AuthUser> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('users')
    .select('role, client_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') throw new Error('Unauthorized')

  return {
    id: user.id,
    email: user.email!,
    role: profile.role as 'admin' | 'member' | 'client',
    client_id: profile.client_id as string | null,
  }
}

/**
 * True if a member has been granted access to a client via user_client_access.
 * Uses the service client so the membership check itself isn't subject to RLS.
 */
export async function memberHasClientAccess(
  userId: string,
  clientId: string,
): Promise<boolean> {
  const service = await createServiceClient()
  const { data } = await service
    .from('user_client_access')
    .select('client_id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .maybeSingle()
  return !!data
}

/**
 * Authorization check for any client-scoped operation.
 * Admins: always. Client-role: only their pinned client. Member: only granted clients.
 * Use in API routes / actions that accept an untrusted clientId before touching
 * a service client (which bypasses RLS).
 */
export async function userCanAccessClient(
  user: Pick<AuthUser, 'id' | 'role' | 'client_id'>,
  clientId: string,
): Promise<boolean> {
  if (user.role === 'admin') return true
  if (user.role === 'client') return user.client_id === clientId
  return memberHasClientAccess(user.id, clientId)
}
