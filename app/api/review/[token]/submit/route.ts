import { NextRequest, NextResponse } from 'next/server'
import { sendReviewNotification } from '@/lib/review/email'
import { answersFromResponses } from '@/lib/review/helpers'
import { GUEST_REVIEWER } from '@/lib/review/queries'
import { createIpLimiter } from '@/lib/review/rate-limit'
import { findMissingDenyNotes, TOKEN_RE } from '@/lib/review/schemas'
import { buildSummaryText } from '@/lib/review/summary'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const limited = createIpLimiter({ windowMs: 10 * 60 * 1000, max: 10 })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (limited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const { token } = await params
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  }

  const service = await createServiceClient()

  const { data: batch, error: batchError } = await service
    .from('review_batches')
    .select('id, status, client, title')
    .eq('token', token)
    .maybeSingle()
  if (batchError) {
    console.error('review submit: batch lookup failed:', batchError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  if (!batch || batch.status === 'archived') {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  }
  if (batch.status === 'submitted') {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 })
  }

  const { data: items, error: itemsError } = await service
    .from('review_items')
    .select('id, sort_order, title')
    .eq('batch_id', batch.id)
  if (itemsError || !items) {
    console.error('review submit: items lookup failed:', itemsError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  const { data: responses, error: responsesError } = await service
    .from('review_responses')
    .select('item_id, rating, decision, note')
    .eq('batch_id', batch.id)
    .eq('reviewer_name', GUEST_REVIEWER)
  if (responsesError) {
    console.error('review submit: responses lookup failed:', responsesError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  const answers = answersFromResponses(responses ?? [])
  const missing = findMissingDenyNotes(
    answers,
    items.map((item) => item.id)
  )
  if (missing.length > 0) {
    return NextResponse.json({ error: 'deny_requires_note', itemIds: missing }, { status: 422 })
  }

  const submittedAt = new Date().toISOString()
  const { data: updated, error: updateError } = await service
    .from('review_batches')
    .update({ status: 'submitted', submitted_at: submittedAt })
    .eq('id', batch.id)
    .in('status', ['draft', 'open'])
    .select('id')
  if (updateError) {
    console.error('review submit: status update failed:', updateError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 })
  }

  const adminBase = (
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://portal.igniteiq.com'
  ).replace(/\/+$/, '')
  const subject = `${batch.client} review submitted — ${batch.title}`
  const text =
    buildSummaryText(batch, items, answers) + `\n\nAdmin view: ${adminBase}/reviews/${batch.id}`
  const emailSent = await sendReviewNotification({ subject, text })

  return NextResponse.json({ ok: true, submittedAt, emailSent })
}
