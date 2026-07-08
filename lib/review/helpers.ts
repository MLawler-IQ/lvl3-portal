import type { ItemAnswers, ReviewItem, ReviewResponse } from './types'

/** Absolute reviewer share URL for a batch token. */
export function reviewUrl(token: string, base?: string): string {
  const origin = (
    base ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://portal.igniteiq.com'
  ).replace(/\/+$/, '')
  return `${origin}/mm-image-review/${token}`
}

/** Fold DB response rows into the per-item answers map the builders consume. */
export function answersFromResponses(
  responses: Array<Pick<ReviewResponse, 'item_id' | 'rating' | 'decision' | 'note'>>
): Record<string, ItemAnswers> {
  const map: Record<string, ItemAnswers> = {}
  for (const r of responses) {
    map[r.item_id] = { rating: r.rating, decision: r.decision, note: r.note }
  }
  return map
}

export function batchProgress(
  items: Array<Pick<ReviewItem, 'id'>>,
  responses: Array<Pick<ReviewResponse, 'item_id' | 'rating' | 'decision' | 'note'>>
): { approved: number; denied: number; pending: number; responded: number } {
  const answers = answersFromResponses(responses)
  let approved = 0
  let denied = 0
  let responded = 0
  for (const item of items) {
    const a = answers[item.id]
    if (!a) continue
    if (a.decision === 'approve') approved++
    else if (a.decision === 'deny') denied++
    if (a.decision || a.rating || (a.note ?? '').trim()) responded++
  }
  return { approved, denied, responded, pending: items.length - (approved + denied) }
}

/** Rows for the admin CSV export, ordered by sort_order. Feed into buildCsv(). */
export function buildResponsesCsvRows(
  items: ReviewItem[],
  responses: Array<Pick<ReviewResponse, 'item_id' | 'rating' | 'decision' | 'note' | 'updated_at'>>
): { headers: string[]; rows: (string | number | null)[][] } {
  const byItem = new Map(responses.map((r) => [r.item_id, r]))
  const headers = ['#', 'Title', 'Handle', 'Rating', 'Decision', 'Note', 'Updated']
  const rows = [...items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item, i) => {
      const r = byItem.get(item.id)
      return [
        i + 1,
        item.title,
        item.shopify_handle,
        r?.rating ?? null,
        r?.decision ?? null,
        r?.note ?? null,
        r?.updated_at ?? null,
      ]
    })
  return { headers, rows }
}
