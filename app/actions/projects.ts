'use server'

import { revalidateTag, revalidatePath } from 'next/cache'
import { fetchSheetRows, SheetRow, ColumnMap } from '@/lib/google-sheets'
import {
  createClient as createSupabaseClient,
  createServiceClient,
} from '@/lib/supabase/server'
import { requireAuth, userCanAccessClient } from '@/lib/auth'
import { generateClientSummary } from '@/app/actions/summaries'

export type { SheetRow }

export type SheetData = {
  rows: SheetRow[]
  fetchedAt: string
}

export async function getSheetData(
  sheetId: string,
  headerRow: number = 1,
  columnMap: ColumnMap | null = null
): Promise<SheetData> {
  const { user } = await requireAuth()
  // Guard against arbitrary sheetId reads: non-admins may only read a sheet
  // that belongs to a client they have access to.
  if (user.role !== 'admin') {
    const service = await createServiceClient()
    const { data: owner } = await service
      .from('clients')
      .select('id')
      .eq('google_sheet_id', sheetId)
      .maybeSingle()
    if (!owner || !(await userCanAccessClient(user, (owner as { id: string }).id))) {
      throw new Error('Not authorized to read this sheet')
    }
  }
  const rows = await fetchSheetRows(sheetId, headerRow, columnMap)
  return {
    rows,
    fetchedAt: new Date().toISOString(),
  }
}

export async function syncSheet(clientId: string): Promise<void> {
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

  const service = await createServiceClient()
  const { data: client } = await service
    .from('clients')
    .select('google_sheet_id')
    .eq('id', clientId)
    .single()

  if (client?.google_sheet_id) {
    revalidateTag(`sheet-${client.google_sheet_id}`)
  }

  revalidatePath('/projects')

  if (profile?.role === 'admin') {
    await generateClientSummary(clientId)
  }
}
