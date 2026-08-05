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
import { SLOTS, answersSchema, type Answers } from '@/lib/onboarding/schema'
import { buildClientUpdate } from '@/lib/onboarding/promote'

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
): Promise<{ session?: OnboardingSession; error?: string }> {
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
    return { session: { ...data, answers: {} } as OnboardingSession }
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

    // Promote to clients.*, including the structured context. Pure mapping in
    // lib/onboarding/promote.ts so it can be unit-tested without a database.
    const clientUpdate = buildClientUpdate(
      answers,
      completeness,
      sessionId,
      new Date().toISOString(),
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
