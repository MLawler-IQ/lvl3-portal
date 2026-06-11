'use server'

import { requireAuth, requireAdmin, userCanAccessClient } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type Annotation = {
  id: string
  client_id: string
  annotation_date: string
  title: string
  body: string | null
  module: string | null
  created_at: string
}

/** Recent annotations for a client. Authorized for any role that can access the client. */
export async function listAnnotations(clientId: string, limit = 10): Promise<Annotation[]> {
  const { user } = await requireAuth()
  if (!(await userCanAccessClient(user, clientId))) return []
  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('client_annotations')
    .select('id, client_id, annotation_date, title, body, module, created_at')
    .eq('client_id', clientId)
    .order('annotation_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data as Annotation[] | null) ?? []
}

export async function createAnnotation(input: {
  clientId: string
  annotationDate?: string
  title: string
  body?: string
  module?: string
}): Promise<{ error?: string }> {
  try {
    const { user } = await requireAdmin()
    const title = input.title?.trim()
    if (!title) return { error: 'Title is required' }
    const supabase = await createServiceClient()
    const { error } = await supabase.from('client_annotations').insert({
      client_id: input.clientId,
      annotation_date: input.annotationDate || new Date().toISOString().slice(0, 10),
      title,
      body: input.body?.trim() || null,
      module: input.module || null,
      created_by: user.id,
    })
    if (error) return { error: error.message }
    revalidatePath('/dashboard')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to add note' }
  }
}

export async function deleteAnnotation(id: string): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServiceClient()
    const { error } = await supabase.from('client_annotations').delete().eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/dashboard')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to delete note' }
  }
}
