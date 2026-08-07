'use server'

import { revalidatePath } from 'next/cache'
import {
  createClient as createSupabaseClient,
  createServiceClient,
} from '@/lib/supabase/server'
import { parseSheetId } from '@/lib/google-sheets'
import { CLIENT_TYPES, type ClientType, type Targets } from '@/lib/dashboard/types'
import { TARGET_METRIC_IDS } from '@/lib/dashboard/pacing'
// One slug implementation. The modal derives the slug as the admin types and
// this action falls back to the same function, so the two cannot disagree.
import { slugify } from '@/lib/slug'
import { SLOTS } from '@/lib/onboarding/schema'
import { startSession } from './onboarding'
import { runDiscovery } from './onboarding-discover'
import { logError } from '@/lib/logging'

/** Parse a comma/newline-separated list into a clean string[] (or null when empty). */
function parseStringList(raw: string | null): string[] | null {
  if (!raw) return null
  const items = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return items.length > 0 ? items : null
}

/**
 * Parse `target_<metricId>` form fields into the clients.targets jsonb shape.
 * Each non-blank, positive numeric value becomes `{ value, period: YYYY-MM }`
 * for the current month. Blank/zero/invalid values are omitted. Returns null
 * when no targets are set, so the column clears cleanly.
 */
function parseTargets(formData: FormData): Targets | null {
  const period = new Date().toISOString().slice(0, 7) // YYYY-MM
  const targets: Targets = {}
  for (const metricId of TARGET_METRIC_IDS) {
    const raw = (formData.get(`target_${metricId}`) as string | null)?.trim()
    if (!raw) continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) continue
    targets[metricId] = { value, period }
  }
  return Object.keys(targets).length > 0 ? targets : null
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

/**
 * The nine columns that both this form and setup can write, paired with the slot
 * each promotes from. Derived from SLOTS rather than hand-listed so the two
 * cannot drift: a slot that gains or loses a `promotesTo` shows up here on its
 * own. This overlap, arbitrated by nobody, is the defect the setup rebuild
 * exists to fix.
 */
const SHARED_SLOTS: ReadonlyArray<{ slotId: string; column: string }> = SLOTS.filter(
  (s) => !!s.promotesTo,
).map((s) => ({ slotId: s.id, column: s.promotesTo! }))

const SHARED_COLUMNS = SHARED_SLOTS.map((s) => s.column)

/** Order-insensitive for lists; the list fields are sets, not sequences. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (v: unknown) =>
      (Array.isArray(v) ? v : [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .sort()
    const [x, y] = [norm(a), norm(b)]
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
  return norm(a) === norm(b)
}

/**
 * Record a hand edit to a shared field as an explicit manual override.
 *
 * Only fields whose submitted value actually DIFFERS from the stored one are
 * touched. That distinction is the whole design: saving this form without
 * touching GA4 must not convert an interview answer into a manual override, or
 * the first save would freeze every field and setup could never update anything
 * again. An override is something you did, not something you failed to undo.
 *
 * Blanking a field writes the same envelope with an empty value rather than
 * deleting the key. lib/onboarding/promote.ts only treats a FILLED manual entry
 * as sticky, so an emptied one is a released override — the only way an admin
 * can hand a field back to setup — and keeping the key records that the release
 * was deliberate.
 *
 * Merges, never replaces: gaps, completenessPct, approvedAt, sessionId and every
 * untouched slot are setup's record and must survive a settings save. Returns
 * null when nothing changed, so the update simply omits the column.
 */
function recordManualOverrides(
  before: unknown,
  submitted: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!before || typeof before !== 'object') return null
  const row = before as Record<string, unknown>
  const context = (row.service_context ?? {}) as Record<string, unknown>
  const answers = { ...((context.answers ?? {}) as Record<string, unknown>) }

  let changed = false
  for (const { slotId, column } of SHARED_SLOTS) {
    if (!(column in submitted)) continue
    if (sameValue(submitted[column], row[column])) continue

    answers[slotId] = {
      value: (submitted[column] ?? null) as never,
      unknown: false,
      source: 'manual',
      confidence: 'high',
      evidence: 'Set by hand in client settings',
      recordedAt: new Date().toISOString(),
    }
    changed = true
  }

  return changed ? { ...context, answers } : null
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Create a client, open its setup session, and try to discover its config.
 *
 * Creation captures only name/slug/website/logo. Every other field — GA4, GSC,
 * GBP, client_type, competitors — comes from setup, either matched automatically
 * against the agency's own Google account or asked for in the interview.
 *
 * Discovery runs here rather than on first visit so the admin lands on a page
 * that already knows things. It is best-effort BY DESIGN: runDiscovery already
 * treats each source independently and swallows its own failures, and a source
 * that did not match is a visible gap in the completeness panel rather than an
 * error. So a client is never left uncreated because Google was slow, and the
 * failure mode is a form with more blanks in it, not a lost client.
 *
 * Returns the id rather than void so the modal can route into setup. Still
 * throws on a genuine creation failure; the modal catches and renders it.
 */
export async function createClient(formData: FormData): Promise<{ id: string }> {
  await requireAdmin()
  const service = await createServiceClient()

  const name = (formData.get('name') as string).trim()
  const rawSlug = (formData.get('slug') as string | null)?.trim()
  const slug = rawSlug && rawSlug.length > 0 ? rawSlug : slugify(name)
  const logo_url = (formData.get('logo_url') as string | null)?.trim() || null

  // The website used to be collected and thrown away (logo fetch only). It is
  // the match key for onboarding auto-discovery, so it is now persisted.
  const website_url = (formData.get('website') as string | null)?.trim() || null

  const { data, error } = await service
    .from('clients')
    .insert({ name, slug, logo_url, website_url })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('Client was created but no id came back')

  const clientId = data.id as string

  // Open the setup session and seed it. Both steps are best-effort: the client
  // exists, and setup can start (or restart) a session itself. Failing the whole
  // creation because discovery could not reach GA4 would be the wrong trade.
  try {
    const { session } = await startSession(clientId)
    if (session) await runDiscovery(session.id)
  } catch (err) {
    logError('clients.create', 'Setup seeding failed; client still created', {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  revalidatePath('/clients')
  return { id: clientId }
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
  const brand_terms = parseStringList((formData.get('brand_terms') as string | null) ?? null)
  const brand_match_mode =
    (formData.get('brand_match_mode') as string | null) === 'exact' ? 'exact' : 'contains'
  const targets = parseTargets(formData)

  // website_url is patched conditionally: a form that doesn't submit the field
  // must leave the stored value alone rather than nulling it.
  const websitePatch: { website_url?: string | null } = formData.has('website_url')
    ? { website_url: (formData.get('website_url') as string | null)?.trim() || null }
    : {}

  // The nine columns setup also writes. Editing one here is what makes it a
  // recorded override, so the current values have to be read before the write to
  // see which of them actually changed.
  const { data: before } = await service
    .from('clients')
    .select(`service_context, ${SHARED_COLUMNS.join(', ')}`)
    .eq('id', clientId)
    .single()

  const service_context = recordManualOverrides(before, {
    client_type,
    ga4_property_id,
    gsc_site_url,
    gbp_account_id,
    gbp_location_group,
    google_sheet_id,
    competitors,
    brand_terms,
    key_event_names,
  })

  const { error } = await service
    .from('clients')
    .update({
      ...websitePatch,
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
      brand_terms,
      brand_match_mode,
      targets,
      ...(service_context ? { service_context } : {}),
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
