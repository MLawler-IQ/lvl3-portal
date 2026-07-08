'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { batchProgress } from '@/lib/review/helpers'
import { GUEST_REVIEWER } from '@/lib/review/queries'
import type {
  BatchWithProgress,
  ReviewBatch,
  ReviewBatchStatus,
  ReviewItem,
  ReviewResponse,
} from '@/lib/review/types'

export async function listBatches(): Promise<{
  data?: BatchWithProgress[]
  error?: string
}> {
  try {
    await requireAdmin()
    const service = await createServiceClient()

    const { data: batches, error } = await service
      .from('review_batches')
      .select('id, client, title, token, status, created_by, created_at, submitted_at')
      .order('created_at', { ascending: false })
    if (error) return { error: error.message }

    const [{ data: items, error: itemsError }, { data: responses, error: responsesError }] =
      await Promise.all([
        service.from('review_items').select('id, batch_id'),
        service
          .from('review_responses')
          .select('batch_id, item_id, rating, decision, note')
          .eq('reviewer_name', GUEST_REVIEWER),
      ])
    if (itemsError) return { error: itemsError.message }
    if (responsesError) return { error: responsesError.message }

    const itemsByBatch = new Map<string, Array<{ id: string }>>()
    for (const item of (items ?? []) as Array<{ id: string; batch_id: string }>) {
      const list = itemsByBatch.get(item.batch_id) ?? []
      list.push({ id: item.id })
      itemsByBatch.set(item.batch_id, list)
    }

    const responsesByBatch = new Map<
      string,
      Array<Pick<ReviewResponse, 'item_id' | 'rating' | 'decision' | 'note'>>
    >()
    for (const r of (responses ?? []) as Array<
      Pick<ReviewResponse, 'batch_id' | 'item_id' | 'rating' | 'decision' | 'note'>
    >) {
      const list = responsesByBatch.get(r.batch_id) ?? []
      list.push({ item_id: r.item_id, rating: r.rating, decision: r.decision, note: r.note })
      responsesByBatch.set(r.batch_id, list)
    }

    const data: BatchWithProgress[] = ((batches ?? []) as ReviewBatch[]).map((batch) => {
      const batchItems = itemsByBatch.get(batch.id) ?? []
      const progress = batchProgress(batchItems, responsesByBatch.get(batch.id) ?? [])
      return {
        ...batch,
        item_count: batchItems.length,
        responded_count: progress.responded,
        approved_count: progress.approved,
        denied_count: progress.denied,
      }
    })

    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load reviews' }
  }
}

export async function createBatch(input: {
  client: string
  title: string
}): Promise<{ data?: { id: string; token: string }; error?: string }> {
  try {
    const { user } = await requireAdmin()
    const client = input.client?.trim()
    const title = input.title?.trim()
    if (!client) return { error: 'Client is required' }
    if (!title) return { error: 'Title is required' }

    const service = await createServiceClient()
    const { data, error } = await service
      .from('review_batches')
      .insert({ client, title, status: 'open', created_by: user.id })
      .select('id, token')
      .single()
    if (error) return { error: error.message }

    revalidatePath('/reviews')
    return { data: { id: data.id as string, token: data.token as string } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create batch' }
  }
}

export async function addItems(
  batchId: string,
  items: Array<{
    sort_order: number
    title: string
    copy?: string | null
    copy_url?: string | null
    image_url: string
    shopify_handle?: string | null
  }>
): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    if (!batchId) return { error: 'Batch id is required' }
    if (!items.length) return { error: 'No items to add' }

    const service = await createServiceClient()
    const rows = items.map((item) => ({
      batch_id: batchId,
      sort_order: item.sort_order,
      title: item.title,
      copy: item.copy?.trim() || null,
      copy_url: item.copy_url?.trim() || null,
      image_url: item.image_url,
      shopify_handle: item.shopify_handle?.trim() || null,
    }))
    const { error } = await service.from('review_items').insert(rows)
    if (error) return { error: error.message }

    revalidatePath('/reviews')
    revalidatePath(`/reviews/${batchId}`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to add items' }
  }
}

export async function updateItem(
  itemId: string,
  patch: Partial<{
    title: string
    copy: string | null
    copy_url: string | null
    sort_order: number
    shopify_handle: string | null
  }>
): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    if (!Object.keys(patch).length) return {}

    const service = await createServiceClient()
    const { data, error } = await service
      .from('review_items')
      .update(patch)
      .eq('id', itemId)
      .select('batch_id')
      .single()
    if (error) return { error: error.message }

    revalidatePath('/reviews')
    revalidatePath(`/reviews/${data.batch_id}`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update item' }
  }
}

export async function deleteItem(itemId: string): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    const service = await createServiceClient()
    const { data, error } = await service
      .from('review_items')
      .delete()
      .eq('id', itemId)
      .select('batch_id')
      .single()
    if (error) return { error: error.message }

    revalidatePath('/reviews')
    revalidatePath(`/reviews/${data.batch_id}`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to delete item' }
  }
}

export async function updateBatchStatus(
  batchId: string,
  status: ReviewBatchStatus
): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    const service = await createServiceClient()
    const patch: { status: ReviewBatchStatus; submitted_at?: null } = { status }
    // Reopening a submitted batch clears its submission timestamp.
    if (status === 'open') patch.submitted_at = null

    const { error } = await service.from('review_batches').update(patch).eq('id', batchId)
    if (error) return { error: error.message }

    revalidatePath('/reviews')
    revalidatePath(`/reviews/${batchId}`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update status' }
  }
}

export async function regenerateToken(
  batchId: string
): Promise<{ data?: { token: string }; error?: string }> {
  try {
    await requireAdmin()
    const service = await createServiceClient()
    const token = randomBytes(16).toString('hex')

    const { error } = await service.from('review_batches').update({ token }).eq('id', batchId)
    if (error) return { error: error.message }

    revalidatePath('/reviews')
    revalidatePath(`/reviews/${batchId}`)
    return { data: { token } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to regenerate link' }
  }
}

export async function getBatchWithResponses(batchId: string): Promise<{
  data?: { batch: ReviewBatch; items: ReviewItem[]; responses: ReviewResponse[] }
  error?: string
}> {
  try {
    await requireAdmin()
    const service = await createServiceClient()

    const { data: batch, error: batchError } = await service
      .from('review_batches')
      .select('id, client, title, token, status, created_by, created_at, submitted_at')
      .eq('id', batchId)
      .maybeSingle()
    if (batchError) return { error: batchError.message }
    if (!batch) return { error: 'Review batch not found' }

    const [{ data: items, error: itemsError }, { data: responses, error: responsesError }] =
      await Promise.all([
        service
          .from('review_items')
          .select('id, batch_id, sort_order, title, copy, copy_url, image_url, shopify_handle')
          .eq('batch_id', batchId)
          .order('sort_order', { ascending: true }),
        service
          .from('review_responses')
          .select('id, batch_id, item_id, reviewer_name, rating, decision, note, updated_at')
          .eq('batch_id', batchId)
          .eq('reviewer_name', GUEST_REVIEWER),
      ])
    if (itemsError) return { error: itemsError.message }
    if (responsesError) return { error: responsesError.message }

    return {
      data: {
        batch: batch as ReviewBatch,
        items: (items ?? []) as ReviewItem[],
        responses: (responses ?? []) as ReviewResponse[],
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load batch' }
  }
}
