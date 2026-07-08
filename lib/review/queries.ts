import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReviewBatch, ReviewItem, ReviewResponse } from './types'

export const GUEST_REVIEWER = 'guest'

export type ReviewBundle = {
  batch: ReviewBatch
  items: ReviewItem[]
  responses: ReviewResponse[]
}

/**
 * Server-only: fetch a batch with its items and guest responses by share
 * token. Callers must pass a service-role client (RLS has no anon policies).
 */
export async function getReviewBundle(
  service: SupabaseClient,
  token: string
): Promise<ReviewBundle | null> {
  const { data, error } = await service
    .from('review_batches')
    .select(
      `id, client, title, token, status, created_by, created_at, submitted_at,
       review_items ( id, batch_id, sort_order, title, copy, copy_url, image_url, shopify_handle ),
       review_responses ( id, batch_id, item_id, reviewer_name, rating, decision, note, updated_at )`
    )
    .eq('token', token)
    .maybeSingle()

  if (error) throw new Error(`getReviewBundle: ${error.message}`)
  if (!data) return null

  const { review_items, review_responses, ...batch } = data as ReviewBatch & {
    review_items: ReviewItem[]
    review_responses: ReviewResponse[]
  }
  return {
    batch,
    items: [...(review_items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    responses: (review_responses ?? []).filter((r) => r.reviewer_name === GUEST_REVIEWER),
  }
}
