import { z } from 'zod'
import type { ItemAnswers, ItemState } from './types'

/** Batch tokens are encode(gen_random_bytes(16), 'hex') — exactly 32 hex chars. */
export const TOKEN_RE = /^[0-9a-f]{32}$/i

export const responsePayloadSchema = z.object({
  itemId: z.uuid(),
  rating: z.number().int().min(1).max(10).nullable(),
  decision: z.enum(['approve', 'deny']).nullable(),
  note: z.string().max(2000),
})

export type ResponsePayload = z.infer<typeof responsePayloadSchema>

/**
 * Map client state to the autosave wire payload. While Deny is selected but
 * the note is still empty, the decision is withheld (sent as null) so the
 * row never violates the deny_requires_note DB check; the note and rating
 * still persist, and the deny lands with the first note keystroke.
 */
export function toWirePayload(itemId: string, state: ItemState): ResponsePayload {
  const decision =
    state.decision === 'deny' && state.note.trim() === '' ? null : state.decision
  return {
    itemId,
    rating: state.rating >= 1 && state.rating <= 10 ? Math.floor(state.rating) : null,
    decision,
    note: state.note,
  }
}

/** ItemIds whose answers are deny-without-note (submit blockers). */
export function findMissingDenyNotes(
  answers: Record<string, ItemAnswers | undefined>,
  itemIds: string[]
): string[] {
  return itemIds.filter((id) => {
    const a = answers[id]
    return a?.decision === 'deny' && !(a.note ?? '').trim()
  })
}
