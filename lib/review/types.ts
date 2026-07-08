export type ReviewBatchStatus = 'draft' | 'open' | 'submitted' | 'archived'
export type ReviewDecision = 'approve' | 'deny'

export type ReviewBatch = {
  id: string
  client: string
  title: string
  token: string
  status: ReviewBatchStatus
  created_by: string | null
  created_at: string
  submitted_at: string | null
}

export type ReviewItem = {
  id: string
  batch_id: string
  sort_order: number
  title: string
  copy: string | null
  copy_url: string | null
  image_url: string
  shopify_handle: string | null
}

export type ReviewResponse = {
  id: string
  batch_id: string
  item_id: string
  reviewer_name: string
  rating: number | null
  decision: ReviewDecision | null
  note: string | null
  updated_at: string
}

/** Client-side per-item state on the reviewer page. rating 0 = unset. */
export type ItemState = {
  rating: number
  decision: ReviewDecision | null
  note: string
}

/** Normalized per-item answers, shared by the summary/CSV builders so both
 * client state (ItemState) and DB rows (ReviewResponse) can feed them. */
export type ItemAnswers = {
  rating: number | null
  decision: ReviewDecision | null
  note: string | null
}

export type BatchWithProgress = ReviewBatch & {
  item_count: number
  responded_count: number
  approved_count: number
  denied_count: number
}
