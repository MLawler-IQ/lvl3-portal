'use server'

import { revalidatePath } from 'next/cache'
import {
  createClient as createSupabaseClient,
  createServiceClient,
} from '@/lib/supabase/server'
import { parseSheetId } from '@/lib/google-sheets'
import { CLIENT_TYPES, type ClientType } from '@/lib/dashboard/types'

/** Parse a comma/newline-separated list into a clean string[] (or null when empty). */
function parseStringList(raw: string | null): string[] | null {
  if (!raw) return null
  const items = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return items.length > 0 ? items : null
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClientWithStats = {
  id: string
  name: string
  logo_url: string | null
  slug: string
  google_sheet_id: string | null
  looker_embed_url: string | null
  created_at: string
  user_count: number
  deliverable_count: number
  unread_count: number
}

export type UserWithAccess = {
  id: string
  email: string
  role: 'admin' | 'member' | 'client'
  granted_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') throw new Error('Unauthorized')
  return user
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function createClient(formData: FormData) {
  await requireAdmin()
  const service = await createServiceClient()

  const name = (formData.get('name') as string).trim()
  const rawSlug = (formData.get('slug') as string | null)?.trim()
  const slug = rawSlug && rawSlug.length > 0 ? rawSlug : slugify(name)
  const logo_url = (formData.get('logo_url') as string | null)?.trim() || null

  const { error } = await service.from('clients').insert({ name, slug, logo_url })
  if (error) throw new Error(error.message)

  revalidatePath('/clients')
}

export async function updateClient(clientId: string, formData: FormData) {
  await requireAdmin()
  const service = await createServiceClient()

  const name = (formData.get('name') as string).trim()
  const slug = (formData.get('slug') as string).trim()
  const logo_url = (formData.get('logo_url') as string | null)?.trim() || null
  const rawSheetId = (formData.get('google_sheet_id') as string | null)?.trim() || null
  const google_sheet_id = rawSheetId ? parseSheetId(rawSheetId) : null
  const looker_embed_url = (formData.get('looker_embed_url') as string | null)?.trim() || null
  const sheet_header_row = parseInt((formData.get('sheet_header_row') as string | null) ?? '1') || 1
  const columnMapStr = (formData.get('sheet_column_map') as string | null)?.trim() || null
  const sheet_column_map = columnMapStr ? JSON.parse(columnMapStr) : null
  const ga4_property_id = (formData.get('ga4_property_id') as string | null)?.trim() || null
  const gsc_site_url = (formData.get('gsc_site_url') as string | null)?.trim() || null
  const hero_image_url = (formData.get('hero_image_url') as string | null)?.trim() || null
  const brand_context = (formData.get('brand_context') as string | null)?.trim() || null

  // Dashboard metadata (see lib/dashboard/registry.ts + 20260611000000_dashboard_metadata.sql)
  const rawClientType = (formData.get('client_type') as string | null)?.trim() || ''
  const client_type: ClientType | null = CLIENT_TYPES.includes(rawClientType as ClientType)
    ? (rawClientType as ClientType)
    : null
  const gbp_account_id = (formData.get('gbp_account_id') as string | null)?.trim() || null
  const gbp_location_group = (formData.get('gbp_location_group') as string | null)?.trim() || null
  const key_event_names = parseStringList((formData.get('key_event_names') as string | null) ?? null)
  const competitors = parseStringList((formData.get('competitors') as string | null) ?? null)

  const { error } = await service
    .from('clients')
    .update({
      name,
      slug,
      logo_url,
      google_sheet_id,
      looker_embed_url,
      sheet_header_row,
      sheet_column_map,
      ga4_property_id,
      gsc_site_url,
      hero_image_url,
      brand_context,
      client_type,
      gbp_account_id,
      gbp_location_group,
      key_event_names,
      competitors,
    })
    .eq('id', clientId)

  if (error) throw new Error(error.message)

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
}

export async function inviteUser(formData: FormData) {
  await requireAdmin()
  const service = await createServiceClient()

  const email = (formData.get('email') as string).trim().toLowerCase()
  const role = formData.get('role') as 'client' | 'member'
  const clientId = formData.get('clientId') as string

  // Determine redirectTo from env (falls back gracefully in dev)
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('.supabase.co', '.vercel.app') ??
    'http://localhost:3000'

  // Send invite email via Supabase Auth admin API
  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(
    email,
    {
      data: {
        role,
        client_id: role === 'client' ? clientId : null,
      },
      redirectTo: `${siteUrl}/auth/callback`,
    }
  )

  if (inviteError && !inviteError.message.includes('already been registered')) {
    throw new Error(inviteError.message)
  }

  // Upsert the public.users profile (handles already-existing auth accounts)
  const userId = invited?.user?.id
  if (userId) {
    const { error: upsertError } = await service
      .from('users')
      .upsert(
        {
          id: userId,
          email,
          role,
          client_id: role === 'client' ? clientId : null,
        },
        { onConflict: 'id' }
      )

    if (upsertError) throw new Error(upsertError.message)

    // For member role: grant access to this client via the join table
    if (role === 'member') {
      const { error: accessError } = await service
        .from('user_client_access')
        .upsert({ user_id: userId, client_id: clientId }, { onConflict: 'user_id,client_id' })

      if (accessError) throw new Error(accessError.message)
    }
  }

  revalidatePath(`/clients/${clientId}`)
}

export async function grantMemberAccess(userId: string, clientId: string) {
  await requireAdmin()
  const service = await createServiceClient()

  const { error } = await service
    .from('user_client_access')
    .upsert({ user_id: userId, client_id: clientId }, { onConflict: 'user_id,client_id' })

  if (error) throw new Error(error.message)

  revalidatePath(`/clients/${clientId}`)
}

export async function revokeAccess(userId: string, clientId: string) {
  await requireAdmin()
  const service = await createServiceClient()

  // Check what role this user has
  const { data: profile } = await service
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()

  if (profile?.role === 'client') {
    // Null out the client_id FK
    const { error } = await service
      .from('users')
      .update({ client_id: null })
      .eq('id', userId)
    if (error) throw new Error(error.message)
  } else if (profile?.role === 'member') {
    // Remove the join table row
    const { error } = await service
      .from('user_client_access')
      .delete()
      .eq('user_id', userId)
      .eq('client_id', clientId)
    if (error) throw new Error(error.message)
  }

  revalidatePath(`/clients/${clientId}`)
}

// ── Data fetchers (called from Server Components) ─────────────────────────────

export async function getClientsWithStats(): Promise<ClientWithStats[]> {
  const service = await createServiceClient()

  const { data: clients, error } = await service
    .from('clients')
    .select('id, name, logo_url, slug, google_sheet_id, looker_embed_url, created_at')
    .order('name')

  if (error) throw new Error(error.message)
  if (!clients) return []

  // Fetch aggregate counts for each client in parallel
  const stats = await Promise.all(
    clients.map(async (c) => {
      const [{ count: userCount }, { count: deliverableCount }, { count: unreadCount }] =
        await Promise.all([
          // Count client users (role = 'client' with client_id) + members with access
          service
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', c.id),
          service
            .from('deliverables')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', c.id),
          service
            .from('deliverables')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', c.id)
            .is('viewed_at', null),
        ])

      return {
        ...c,
        user_count: userCount ?? 0,
        deliverable_count: deliverableCount ?? 0,
        unread_count: unreadCount ?? 0,
      }
    })
  )

  return stats
}

export async function getClientUsers(clientId: string): Promise<UserWithAccess[]> {
  const service = await createServiceClient()

  // Client users (role = 'client', client_id FK)
  const { data: clientUsers } = await service
    .from('users')
    .select('id, email, role, created_at')
    .eq('client_id', clientId)
    .eq('role', 'client')

  // Member users (via user_client_access join table)
  const { data: memberAccess } = await service
    .from('user_client_access')
    .select('user_id, created_at, users(id, email, role)')
    .eq('client_id', clientId)

  const clientRows: UserWithAccess[] = (clientUsers ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role as 'client',
    granted_at: u.created_at,
  }))

  const memberRows: UserWithAccess[] = (memberAccess ?? []).flatMap((row) => {
    const u = row.users as unknown as { id: string; email: string; role: string } | null
    if (!u) return []
    return [{ id: u.id, email: u.email, role: u.role as 'member', granted_at: row.created_at }]
  })

  return [...clientRows, ...memberRows].sort(
    (a, b) => new Date(a.granted_at).getTime() - new Date(b.granted_at).getTime()
  )
}
