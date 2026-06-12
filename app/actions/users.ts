'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/auth'
import {
  createServiceClient,
  createClient as createSessionClient,
} from '@/lib/supabase/server'

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'member' | 'client'
export type UserStatus = 'invited' | 'active' | 'deactivated'

export type AdminUserRow = {
  id: string
  email: string
  role: UserRole
  /** Single pinned client (client-role only). */
  clientId: string | null
  clientName: string | null
  /** Multi-client grants (member-role only), via user_client_access. */
  memberClientIds: string[]
  status: UserStatus
  lastSignInAt: string | null
  createdAt: string
}

export type ClientOption = { id: string; name: string }

export type AdminUsersData = {
  users: AdminUserRow[]
  clients: ClientOption[]
  /** The signed-in admin — used by the UI to disable self-destructive actions. */
  currentUserId: string
  adminCount: number
}

// ── Internal helpers (not exported → may be sync) ──────────────────────────────

/** Long ban used to "deactivate" without a schema change (~100 years). */
const BAN_FOREVER = '876600h'

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('.supabase.co', '.vercel.app') ??
    'http://localhost:3000'
  )
}

function parseIdList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

type AuthMeta = { lastSignInAt: string | null; bannedUntil: string | null }

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>

/** Page through the Auth admin API and index sign-in / ban metadata by user id. */
async function fetchAuthMeta(service: ServiceClient): Promise<Map<string, AuthMeta>> {
  const map = new Map<string, AuthMeta>()
  const perPage = 200
  // Hard cap at 50 pages (10k users) — this portal is far smaller.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(error.message)
    const batch = data?.users ?? []
    for (const u of batch) {
      map.set(u.id, {
        lastSignInAt: (u.last_sign_in_at as string | null) ?? null,
        bannedUntil: (u as { banned_until?: string | null }).banned_until ?? null,
      })
    }
    if (batch.length < perPage) break
  }
  return map
}

function deriveStatus(meta: AuthMeta | undefined): UserStatus {
  if (meta?.bannedUntil && new Date(meta.bannedUntil).getTime() > Date.now()) return 'deactivated'
  if (meta?.lastSignInAt) return 'active'
  return 'invited'
}

/** Replace a member's full set of client-access grants. */
async function replaceMemberClients(
  service: ServiceClient,
  userId: string,
  clientIds: string[],
): Promise<void> {
  await service.from('user_client_access').delete().eq('user_id', userId)
  if (clientIds.length > 0) {
    const rows = clientIds.map((client_id) => ({ user_id: userId, client_id }))
    const { error } = await service
      .from('user_client_access')
      .upsert(rows, { onConflict: 'user_id,client_id' })
    if (error) throw new Error(error.message)
  }
}

/** Block any change that would leave the system with zero admins. */
async function assertNotLastAdmin(service: ServiceClient, targetUserId: string): Promise<void> {
  const { data: target } = await service
    .from('users')
    .select('role')
    .eq('id', targetUserId)
    .single()
  if (target?.role !== 'admin') return
  const { count } = await service
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'admin')
  if ((count ?? 0) <= 1) throw new Error('Can’t remove the last admin')
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listAllUsers(): Promise<AdminUsersData> {
  const me = await requireAdminUser()
  const service = await createServiceClient()

  const [{ data: profiles, error: pErr }, { data: access }, { data: clientRows }] =
    await Promise.all([
      service.from('users').select('id, email, role, client_id, created_at').order('created_at'),
      service.from('user_client_access').select('user_id, client_id'),
      service.from('clients').select('id, name').order('name'),
    ])
  if (pErr) throw new Error(pErr.message)

  const clients: ClientOption[] = (clientRows ?? []).map((c) => ({ id: c.id, name: c.name }))
  const clientName = new Map(clients.map((c) => [c.id, c.name]))

  const memberClients = new Map<string, string[]>()
  for (const row of access ?? []) {
    const list = memberClients.get(row.user_id) ?? []
    list.push(row.client_id)
    memberClients.set(row.user_id, list)
  }

  const authMeta = await fetchAuthMeta(service)

  const users: AdminUserRow[] = (profiles ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role as UserRole,
    clientId: (u.client_id as string | null) ?? null,
    clientName: u.client_id ? clientName.get(u.client_id) ?? null : null,
    memberClientIds: memberClients.get(u.id) ?? [],
    status: deriveStatus(authMeta.get(u.id)),
    lastSignInAt: authMeta.get(u.id)?.lastSignInAt ?? null,
    createdAt: u.created_at,
  }))

  const adminCount = users.filter((u) => u.role === 'admin').length

  return { users, clients, currentUserId: me.id, adminCount }
}

/**
 * Most-recent sign-in per client (across that client's client-role users).
 * Powers the "Last login" field on the Admin overview cards.
 */
export async function getLastLoginByClient(): Promise<Record<string, string | null>> {
  await requireAdminUser()
  const service = await createServiceClient()

  const [{ data: profiles }, authMeta] = await Promise.all([
    service.from('users').select('id, client_id'),
    fetchAuthMeta(service),
  ])

  const result: Record<string, string | null> = {}
  for (const u of profiles ?? []) {
    if (!u.client_id) continue
    const last = authMeta.get(u.id)?.lastSignInAt ?? null
    if (!last) continue
    const prev = result[u.client_id]
    if (!prev || new Date(last).getTime() > new Date(prev).getTime()) {
      result[u.client_id] = last
    }
  }
  return result
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function inviteUserGlobal(formData: FormData): Promise<void> {
  await requireAdminUser()
  const service = await createServiceClient()

  const email = (formData.get('email') as string).trim().toLowerCase()
  const role = formData.get('role') as UserRole
  const clientId = (formData.get('clientId') as string | null)?.trim() || null
  const memberClientIds = parseIdList(formData.get('memberClientIds') as string | null)

  if (!email) throw new Error('Email is required')
  if (!['admin', 'member', 'client'].includes(role)) throw new Error('Invalid role')
  if (role === 'client' && !clientId) {
    throw new Error('A client is required for client-role users')
  }

  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { role, client_id: role === 'client' ? clientId : null },
    redirectTo: `${siteUrl()}/auth/callback`,
  })
  if (inviteError && !inviteError.message.includes('already been registered')) {
    throw new Error(inviteError.message)
  }

  // Resolve the user id (invite returns it; for an already-registered email,
  // fall back to the existing profile row created by the signup trigger).
  let userId = invited?.user?.id ?? null
  if (!userId) {
    const { data: existing } = await service
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    userId = existing?.id ?? null
  }
  if (!userId) throw new Error('Could not resolve a user for that email')

  const { error: upsertError } = await service.from('users').upsert(
    {
      id: userId,
      email,
      role,
      client_id: role === 'client' ? clientId : null,
    },
    { onConflict: 'id' },
  )
  if (upsertError) throw new Error(upsertError.message)

  if (role === 'member') {
    await replaceMemberClients(service, userId, memberClientIds)
  } else {
    // admin/client never carry member grants
    await service.from('user_client_access').delete().eq('user_id', userId)
  }

  revalidatePath('/admin/users')
}

export async function setUserRole(
  userId: string,
  role: UserRole,
  clientId?: string | null,
): Promise<void> {
  const me = await requireAdminUser()
  if (userId === me.id) throw new Error('You can’t change your own role')
  const service = await createServiceClient()

  if (role === 'client' && !clientId) {
    throw new Error('A client is required for client-role users')
  }
  if (role !== 'admin') await assertNotLastAdmin(service, userId)

  const newClientId = role === 'client' ? clientId! : null
  const { error } = await service
    .from('users')
    .update({ role, client_id: newClientId })
    .eq('id', userId)
  if (error) throw new Error(error.message)

  // Keep the auth metadata aligned with the profile (best-effort).
  await service.auth.admin.updateUserById(userId, {
    user_metadata: { role, client_id: newClientId },
  })

  if (role !== 'member') {
    await service.from('user_client_access').delete().eq('user_id', userId)
  }

  revalidatePath('/admin/users')
}

export async function assignClient(userId: string, clientId: string): Promise<void> {
  await requireAdminUser()
  if (!clientId) throw new Error('A client is required')
  const service = await createServiceClient()

  const { data: u } = await service.from('users').select('role').eq('id', userId).single()
  if (u?.role !== 'client') {
    throw new Error('Only client-role users have a single assigned client')
  }

  const { error } = await service.from('users').update({ client_id: clientId }).eq('id', userId)
  if (error) throw new Error(error.message)
  await service.auth.admin.updateUserById(userId, {
    user_metadata: { role: 'client', client_id: clientId },
  })

  revalidatePath('/admin/users')
}

export async function setMemberClients(userId: string, clientIds: string[]): Promise<void> {
  await requireAdminUser()
  const service = await createServiceClient()

  const { data: u } = await service.from('users').select('role').eq('id', userId).single()
  if (u?.role !== 'member') {
    throw new Error('Only members have multi-client access grants')
  }

  await replaceMemberClients(service, userId, clientIds)
  revalidatePath('/admin/users')
}

export async function deactivateUser(userId: string): Promise<void> {
  const me = await requireAdminUser()
  if (userId === me.id) throw new Error('You can’t deactivate your own account')
  const service = await createServiceClient()
  await assertNotLastAdmin(service, userId)

  const { error } = await service.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/users')
}

export async function reactivateUser(userId: string): Promise<void> {
  await requireAdminUser()
  const service = await createServiceClient()

  const { error } = await service.auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/users')
}

export async function deleteUser(userId: string): Promise<void> {
  const me = await requireAdminUser()
  if (userId === me.id) throw new Error('You can’t delete your own account')
  const service = await createServiceClient()
  await assertNotLastAdmin(service, userId)

  // Hard delete the auth user; public.users + user_client_access + comments
  // cascade via their ON DELETE CASCADE foreign keys.
  const { error } = await service.auth.admin.deleteUser(userId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/users')
}

/**
 * Re-send an invite (pending users) or a password-reset link (active users),
 * picking the right flow from the user's sign-in history.
 */
export async function resendInvite(userId: string): Promise<{ kind: 'invite' | 'recovery' }> {
  await requireAdminUser()
  const service = await createServiceClient()

  const { data: profile } = await service
    .from('users')
    .select('email')
    .eq('id', userId)
    .single()
  if (!profile?.email) throw new Error('User not found')

  const { data: authUser } = await service.auth.admin.getUserById(userId)
  const lastSignInAt = authUser?.user?.last_sign_in_at ?? null
  const redirectTo = `${siteUrl()}/auth/callback`

  if (!lastSignInAt) {
    const { error } = await service.auth.admin.inviteUserByEmail(profile.email, { redirectTo })
    if (error && !error.message.includes('already been registered')) {
      throw new Error(error.message)
    }
    return { kind: 'invite' }
  }

  // Active user → send a password-reset email via the anon (session) client.
  const anon = await createSessionClient()
  const { error } = await anon.auth.resetPasswordForEmail(profile.email, { redirectTo })
  if (error) throw new Error(error.message)
  return { kind: 'recovery' }
}
