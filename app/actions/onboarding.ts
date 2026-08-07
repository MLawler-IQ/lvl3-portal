'use server'

// Onboarding session lifecycle + the approve gate.
//
// The gate is the point of this file. The interview writes only to
// client_onboarding_sessions.answers; nothing reaches clients.* — including live
// pipeline config like ga4_property_id — until an admin submits the pre-filled
// review form through approveOnboardingSession. Mirrors
// approveSnapshotInsightsDraft in app/actions/analytics.ts:447.

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { computeCompleteness, type Completeness } from '@/lib/onboarding/completeness'
import { SLOTS, answersSchema, isFilled, type Answers } from '@/lib/onboarding/schema'
import { buildClientUpdate } from '@/lib/onboarding/promote'
import { CONTEXT_ITEM_KINDS, type ContextItemKind } from '@/lib/onboarding/context-items'
import { createAnthropicExtractor, extractSlotValues } from '@/lib/onboarding/extract'
import { logError } from '@/lib/logging'

export interface OnboardingSession {
  id: string
  client_id: string
  status: 'in_progress' | 'ready_for_review' | 'approved' | 'abandoned'
  answers: Answers
  created_at: string
  updated_at: string
}

export interface OnboardingMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Latest non-approved session for a client, or null. */
export async function getActiveSession(
  clientId: string,
): Promise<{ session: OnboardingSession | null; messages: OnboardingMessage[] }> {
  await requireAdmin()
  const service = await createServiceClient()

  const { data: row, error } = await service
    .from('client_onboarding_sessions')
    .select('id, client_id, status, answers, created_at, updated_at')
    .eq('client_id', clientId)
    .in('status', ['in_progress', 'ready_for_review'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Distinguish "no session" from "could not read". Swallowing the error would
  // render the start-an-interview screen and invite a duplicate session.
  if (error) throw new Error(`Could not load onboarding session: ${error.message}`)
  if (!row) return { session: null, messages: [] }

  const { data: msgs } = await service
    .from('client_onboarding_messages')
    .select('role, content')
    .eq('session_id', row.id)
    .order('created_at', { ascending: true })

  return {
    session: {
      ...row,
      answers: answersSchema.safeParse(row.answers).data ?? {},
    } as OnboardingSession,
    messages: (msgs ?? []) as OnboardingMessage[],
  }
}

export async function startSession(
  clientId: string,
): Promise<{ session?: OnboardingSession; error?: string; ranDiscovery?: boolean }> {
  try {
    const { user } = await requireAdmin()
    const service = await createServiceClient()

    // Reuse an active session rather than creating a second one.
    const { data: existing } = await service
      .from('client_onboarding_sessions')
      .select('id, client_id, status, answers, created_at, updated_at')
      .eq('client_id', clientId)
      .in('status', ['in_progress', 'ready_for_review'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      return {
        session: {
          ...existing,
          answers: answersSchema.safeParse(existing.answers).data ?? {},
        } as OnboardingSession,
      }
    }

    const { data, error } = await service
      .from('client_onboarding_sessions')
      .insert({ client_id: clientId, started_by: user.id, status: 'in_progress', answers: {} })
      .select('id, client_id, status, answers, created_at, updated_at')
      .single()

    if (error) return { error: error.message }

    revalidatePath(`/clients/${clientId}/onboarding`)
    return { session: { ...data, answers: {} } as OnboardingSession, ranDiscovery: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to start session' }
  }
}

/**
 * Manual edits from the review screen. Kept separate from the interview's write
 * path so an admin correction is never mistaken for something the model heard.
 */
export async function saveAnswerEdits(
  sessionId: string,
  edits: unknown,
): Promise<{ completeness?: Completeness; error?: string }> {
  try {
    await requireAdmin()
    const service = await createServiceClient()

    const parsed = answersSchema.safeParse(edits)
    if (!parsed.success) {
      return { error: `Invalid answers: ${parsed.error.issues[0]?.message ?? 'malformed'}` }
    }
    const answers = parsed.data
    const completeness = computeCompleteness(answers)

    const { data: updated, error } = await service
      .from('client_onboarding_sessions')
      .update({
        answers,
        status: completeness.readyForReview ? 'ready_for_review' : 'in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .neq('status', 'approved')
      .select('id')

    if (error) return { error: error.message }
    if (!updated || updated.length === 0) {
      return { error: 'Nothing was saved — this session is already approved or no longer exists.' }
    }
    return { completeness }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save' }
  }
}

/**
 * The gate. Promotes reviewed answers to clients.* and clients.service_context.
 *
 * `edits` is what the admin actually submitted from the form, not what the model
 * recorded — so a bad extraction is caught by a human reading an editable field
 * rather than by validation after the fact.
 */
export async function approveOnboardingSession(
  sessionId: string,
  edits: unknown,
): Promise<{ ok?: true; error?: string }> {
  try {
    const { user } = await requireAdmin()
    const service = await createServiceClient()

    const parsed = answersSchema.safeParse(edits)
    if (!parsed.success) {
      return { error: `Invalid answers: ${parsed.error.issues[0]?.message ?? 'malformed'}` }
    }
    const answers = parsed.data

    const { data: session } = await service
      .from('client_onboarding_sessions')
      .select('id, client_id, status')
      .eq('id', sessionId)
      .single()

    if (!session) return { error: 'Session not found' }
    if (session.status === 'approved') return { error: 'Session is already approved' }

    const completeness = computeCompleteness(answers)
    if (!completeness.readyForReview) {
      return {
        error: `Still missing: ${completeness.missing.join(', ')}. Fill them in, or mark them unknown with a reason.`,
      }
    }

    // The client's CURRENT context, read immediately before the write. It is the
    // authority on which slots an admin has overridden by hand in settings, and
    // buildClientUpdate leaves those columns alone. Read here rather than
    // trusting the session because the session is what the interview believes;
    // the row is what the agency decided.
    const { data: priorClient } = await service
      .from('clients')
      .select('service_context')
      .eq('id', session.client_id)
      .single()

    // Promote to clients.*, including the structured context. Pure mapping in
    // lib/onboarding/promote.ts so it can be unit-tested without a database.
    const clientUpdate = buildClientUpdate(
      answers,
      completeness,
      sessionId,
      new Date().toISOString(),
      priorClient?.service_context ?? null,
    )

    const { error: clientErr } = await service
      .from('clients')
      .update(clientUpdate)
      .eq('id', session.client_id)

    if (clientErr) return { error: `Failed to update client: ${clientErr.message}` }

    const { error: sessionErr } = await service
      .from('client_onboarding_sessions')
      .update({
        answers,
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)

    if (sessionErr) return { error: `Client updated but session not closed: ${sessionErr.message}` }

    revalidatePath(`/clients/${session.client_id}`)
    revalidatePath(`/clients/${session.client_id}/onboarding`)
    revalidatePath('/clients')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to approve' }
  }
}

export async function abandonOnboardingSession(
  sessionId: string,
): Promise<{ ok?: true; error?: string }> {
  try {
    await requireAdmin()
    const service = await createServiceClient()
    const { data: updated, error } = await service
      .from('client_onboarding_sessions')
      .update({ status: 'abandoned', updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .neq('status', 'approved')
      .select('id')
    if (error) return { error: error.message }
    if (!updated || updated.length === 0) {
      return { error: 'Nothing changed — this session is already approved or no longer exists.' }
    }
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to abandon' }
  }
}

/**
 * Store a pasted transcript/email/note and read suggestions out of it.
 *
 * Implements ContextPasteProps['onSubmit']. Two things are load-bearing here:
 *
 * 1. The row is stored FIRST and independently of extraction. The item is the
 *    evidence; the suggestions are a derived read of it that we may well want to
 *    redo with a better prompt later. A model failure must not lose the paste.
 * 2. Everything merged into the draft carries source 'context', which isFilled()
 *    refuses to count. So this action cannot answer a slot, cannot move a
 *    session to ready_for_review, and cannot reach clients.*. It only ever adds
 *    suggestions for a human to confirm — and it never overwrites a slot that is
 *    already answered, because a guess must not displace an answer.
 */
export async function addClientContext(input: {
  clientId: string
  kind: ContextItemKind
  title: string | null
  body: string
  occurredAt: string | null
}): Promise<{ error?: string; suggestedSlotIds?: string[]; nothingExtracted?: boolean }> {
  try {
    const { user } = await requireAdmin()
    const service = await createServiceClient()

    const body = input.body.trim()
    if (!body) return { error: 'Nothing to save — paste some context first.' }
    if (!CONTEXT_ITEM_KINDS.includes(input.kind)) return { error: 'Unknown context kind.' }

    const { data: item, error: insertErr } = await service
      .from('client_context_items')
      .insert({
        client_id: input.clientId,
        kind: input.kind,
        title: input.title?.trim() || null,
        body,
        occurred_at: input.occurredAt || null,
        added_by: user.id,
      })
      .select('id')
      .single()

    if (insertErr) return { error: `Could not save the context: ${insertErr.message}` }

    revalidatePath(`/clients/${input.clientId}`)

    // No open session means there is nothing to suggest into. The item is still
    // saved and will be read whenever an interview is started.
    const { data: sessionRow } = await service
      .from('client_onboarding_sessions')
      .select('id, answers')
      .eq('client_id', input.clientId)
      .in('status', ['in_progress', 'ready_for_review'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!sessionRow) return {}

    const existing = answersSchema.safeParse(sessionRow.answers).data ?? {}
    const open = SLOTS.filter((s) => !isFilled(existing[s.id])).map((s) => s.id)
    if (open.length === 0) return {}

    let result
    try {
      result = await extractSlotValues(
        [{ id: item.id as string, kind: input.kind, title: input.title, body, occurredAt: input.occurredAt }],
        open,
        { callModel: createAnthropicExtractor() },
      )
    } catch (err) {
      // The paste succeeded; only the reading of it failed. Report that honestly
      // rather than implying the context was lost.
      logError('onboarding.context', 'Extraction failed', {
        clientId: input.clientId,
        error: err instanceof Error ? err.message : String(err),
      })
      return { error: 'Context saved, but reading it failed. You can retry extraction later.' }
    }

    const suggested = Object.keys(result.answers)
    if (suggested.length === 0) return { nothingExtracted: true }

    // Suggestions never displace an answer, and never overwrite an earlier
    // suggestion silently either — last read wins only for slots still open.
    const merged: Answers = { ...existing }
    for (const [slotId, value] of Object.entries(result.answers)) {
      if (isFilled(existing[slotId])) continue
      merged[slotId] = value
    }

    const { error: sessionErr } = await service
      .from('client_onboarding_sessions')
      .update({ answers: merged, updated_at: new Date().toISOString() })
      .eq('id', sessionRow.id)

    if (sessionErr) {
      return { error: `Context saved, but the suggestions could not be attached: ${sessionErr.message}` }
    }

    return { suggestedSlotIds: suggested }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to add context' }
  }
}

/** Slot metadata for the review form. Server-side so the client bundle stays small. */
export async function getSlotMeta() {
  await requireAdmin()
  return SLOTS.map((s) => ({
    id: s.id,
    label: s.label,
    group: s.group,
    why: s.why,
    required: s.required,
    kind: s.kind,
    choices: s.choices ?? null,
  }))
}
