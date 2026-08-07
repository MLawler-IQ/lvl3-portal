// Mapping approved answers onto the clients row.
//
// Pure on purpose: this is the step that touches live pipeline config
// (ga4_property_id, gsc_site_url, client_type), so it should be testable without
// a database. The server action does auth, calls this, and writes the result.

import { parseSheetId } from '@/lib/google-sheets'
import type { Completeness } from './completeness'
import { clientTypeFromAnswers, isFilled, type Answers, type SlotValue } from './schema'

/** Comma/newline separated → clean list. Mirrors parseStringList in app/actions/clients.ts. */
function toList(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    const items = raw.map((s) => String(s).trim()).filter((s) => s.length > 0)
    return items.length > 0 ? items : null
  }
  if (typeof raw !== 'string') return null
  const items = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return items.length > 0 ? items : null
}

export interface ServiceContext {
  answers: Answers
  /** Slots the client explicitly couldn't answer, carried forward so a consumer
   *  can tell "not tracked" from "never asked". */
  gaps: Array<{ slot: string; reason: string | null }>
  completenessPct: number
  approvedAt: string
  sessionId: string
}

/**
 * Manual overrides recorded on the client's PREVIOUS service_context.
 *
 * Which side owns "is this a manual override" matters, so it is stated once
 * here: the authority is `clients.service_context.answers`, never the interview
 * session's answers. The session is what the interview believes; the client row
 * is what the agency has actually decided, and settings is the only surface that
 * can write `source: 'manual'` there. Reading the flag off the session would let
 * a re-run assert its own authority and clobber exactly the hand-typed value the
 * override exists to protect.
 *
 * A `manual` entry that is blank or `unknown` is deliberately NOT sticky: that
 * is the release valve. An admin clears an override by emptying the field in
 * settings, and the next promote is then free to fill the column from the
 * interview again. Without that, an override could only ever be replaced by
 * another override.
 */
function manualOverrides(priorContext: unknown): Answers {
  const prior = (priorContext as Partial<ServiceContext> | null | undefined)?.answers
  if (!prior || typeof prior !== 'object') return {}
  const out: Answers = {}
  for (const [slotId, value] of Object.entries(prior as Record<string, SlotValue>)) {
    if (value?.source === 'manual' && isFilled(value)) out[slotId] = value
  }
  return out
}

/**
 * Build the `clients` patch from approved answers.
 *
 * Only slots with a real answer are included. An `unknown` or empty slot leaves
 * the existing column alone rather than nulling it — an interview that couldn't
 * confirm a GA4 property must never disconnect analytics.
 *
 * `priorContext` is the client's existing `clients.service_context` (pass the
 * column value straight through; it is parsed defensively). Slots it records as
 * a manual override are left untouched by this promote and carried forward into
 * the new context, so the override survives every re-run rather than only the
 * first one.
 */
export function buildClientUpdate(
  answers: Answers,
  completeness: Completeness,
  sessionId: string,
  approvedAt: string,
  priorContext?: unknown,
): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  const overrides = manualOverrides(priorContext)
  const overridden = (slotId: string): boolean => slotId in overrides

  const str = (id: string): string | null => {
    if (overridden(id)) return null
    const v = answers[id]
    return isFilled(v) ? String(v!.value).trim() : null
  }

  const clientType = overridden('client_type') ? null : clientTypeFromAnswers(answers)
  if (clientType) update.client_type = clientType

  const ga4 = str('ga4_property_id')
  if (ga4) update.ga4_property_id = ga4

  const gsc = str('gsc_site_url')
  if (gsc) update.gsc_site_url = gsc

  const gbp = str('gbp_account_id')
  if (gbp) update.gbp_account_id = gbp

  const gbpGroup = str('gbp_location_group')
  if (gbpGroup) update.gbp_location_group = gbpGroup

  const sheet = str('google_sheet_id')
  if (sheet) update.google_sheet_id = parseSheetId(sheet)

  // List columns. Same omit-when-absent rule: an unanswered slot leaves the
  // existing array alone rather than emptying it.
  for (const [slotId, column] of [
    ['competitors', 'competitors'],
    ['brand_terms', 'brand_terms'],
    ['key_event_names', 'key_event_names'],
  ] as const) {
    if (overridden(slotId)) continue
    const v = answers[slotId]
    if (!isFilled(v)) continue
    const list = toList(v!.value)
    if (list) update[column] = list
  }

  const context: ServiceContext = {
    // Overrides win last so the recorded provenance matches the column: the
    // settings form reads this map to render the badge, and a slot whose column
    // we just refused to touch must not read as freshly answered by interview.
    answers: { ...answers, ...overrides },
    // Every slot the client explicitly could not answer, required or not. A gap
    // is worth recording because someone said "we don't know", which is a fact
    // about the client — not because the slot happened to gate approval.
    gaps: [...completeness.unknown, ...completeness.optionalUnknown].map((id) => ({
      slot: id,
      reason: answers[id]?.reason ?? null,
    })),
    completenessPct: completeness.pct,
    approvedAt,
    sessionId,
  }
  update.service_context = context

  return update
}
