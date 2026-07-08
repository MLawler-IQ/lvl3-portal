import { NextRequest, NextResponse } from 'next/server'
import { GUEST_REVIEWER } from '@/lib/review/queries'
import { createIpLimiter } from '@/lib/review/rate-limit'
import { responsePayloadSchema, TOKEN_RE } from '@/lib/review/schemas'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const limited = createIpLimiter({ windowMs: 10 * 60 * 1000, max: 240 })

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

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = responsePayloadSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const { itemId, rating, decision, note } = parsed.data

  const service = await createServiceClient()

  const { data: batch, error: batchError } = await service
    .from('review_batches')
    .select('id, status')
    .eq('token', token)
    .maybeSingle()
  if (batchError) {
    console.error('review response: batch lookup failed:', batchError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  if (!batch) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  }
  if (batch.status !== 'draft' && batch.status !== 'open') {
    return NextResponse.json({ error: 'batch_locked' }, { status: 409 })
  }

  const { data: item, error: itemError } = await service
    .from('review_items')
    .select('id')
    .eq('id', itemId)
    .eq('batch_id', batch.id)
    .maybeSingle()
  if (itemError) {
    console.error('review response: item lookup failed:', itemError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  if (!item) {
    return NextResponse.json({ error: 'item_not_found' }, { status: 404 })
  }

  // Defensive: the client withholds deny while the note is empty, but never
  // let a bare deny reach the deny_requires_note CHECK.
  if (decision === 'deny' && !note.trim()) {
    return NextResponse.json({ error: 'deny_requires_note' }, { status: 422 })
  }

  const updatedAt = new Date().toISOString()
  const { error: upsertError } = await service.from('review_responses').upsert(
    {
      batch_id: batch.id,
      item_id: itemId,
      reviewer_name: GUEST_REVIEWER,
      rating,
      decision,
      note,
      updated_at: updatedAt,
    },
    { onConflict: 'item_id,reviewer_name' }
  )
  if (upsertError) {
    console.error('review response: upsert failed:', upsertError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updatedAt })
}
