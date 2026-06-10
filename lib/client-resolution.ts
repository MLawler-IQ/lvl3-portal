import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'

const COOKIE_NAME = 'selected_client'

/** Read the selected client ID from the cookie. */
export async function getSelectedClientId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value ?? null
}

/**
 * Fetch a single client by ID with page-specific columns.
 * Returns null if the ID is invalid or the client doesn't exist.
 */
export async function getClientById<T extends { id: string; name: string }>(
  clientId: string,
  columns: string,
): Promise<T | null> {
  const service = await createServiceClient()
  const { data } = await service
    .from('clients')
    .select(columns)
    .eq('id', clientId)
    .single()
  return (data as unknown as T) ?? null
}

/**
 * Resolve the active client ID for any role.
 * Client-role users always get their assigned client_id.
 * Admin/member users get the cookie-selected client.
 */
export async function resolveSelectedClientId(user: {
  role: string
  client_id: string | null
}): Promise<string | null> {
  return user.role === 'client' ? user.client_id : await getSelectedClientId()
}

/**
 * Fetch the list of clients visible to the current user.
 * Used by the layout to populate the sidebar dropdown.
 */
export async function getClientListForUser(
  userId: string,
  role: 'admin' | 'member' | 'client',
  clientId: string | null,
): Promise<{
  clientList: { id: string; name: string }[]
  autoSelectedClientId: string | null
  showSelector: boolean
}> {
  if (role === 'client') {
    return {
      clientList: [],
      autoSelectedClientId: clientId,
      showSelector: false,
    }
  }

  const service = await createServiceClient()

  if (role === 'admin') {
    const { data } = await service
      .from('clients')
      .select('id, name')
      .order('name')
    return {
      clientList: (data ?? []) as { id: string; name: string }[],
      autoSelectedClientId: null,
      showSelector: true,
    }
  }

  // member
  const { data: accessRows } = await service
    .from('user_client_access')
    .select('client_id, clients(id, name)')
    .eq('user_id', userId)

  const clientList = (accessRows ?? []).flatMap((row) => {
    const c = row.clients as unknown as { id: string; name: string } | null
    return c ? [c] : []
  }).sort((a, b) => a.name.localeCompare(b.name))

  return {
    clientList,
    autoSelectedClientId: null,
    showSelector: true,
  }
}
