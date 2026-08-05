// Mapping approved answers onto the clients row.
//
// Pure on purpose: this is the step that touches live pipeline config
// (ga4_property_id, gsc_site_url, client_type), so it should be testable without
// a database. The server action does auth, calls this, and writes the result.

import { parseSheetId } from '@/lib/google-sheets'
import type { Completeness } from './completeness'
import { clientTypeFromAnswers, isFilled, type Answers } from './schema'

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
 * Build the `clients` patch from approved answers.
 *
 * Only slots with a real answer are included. An `unknown` or empty slot leaves
 * the existing column alone rather than nulling it — an interview that couldn't
 * confirm a GA4 property must never disconnect analytics.
 */
export function buildClientUpdate(
  answers: Answers,
  completeness: Completeness,
  sessionId: string,
  approvedAt: string,
): Record<string, unknown> {
  const update: Record<string, unknown> = {}

  const str = (id: string): string | null => {
    const v = answers[id]
    return isFilled(v) ? String(v!.value).trim() : null
  }

  const clientType = clientTypeFromAnswers(answers)
  if (clientType) update.client_type = clientType

  const ga4 = str('ga4_property_id')
  if (ga4) update.ga4_property_id = ga4

  const gsc = str('gsc_site_url')
  if (gsc) update.gsc_site_url = gsc

  const gbp = str('gbp_account_id')
  if (gbp) update.gbp_account_id = gbp

  const sheet = str('google_sheet_id')
  if (sheet) update.google_sheet_id = parseSheetId(sheet)

  const competitors = isFilled(answers['competitors'])
    ? toList(answers['competitors']!.value)
    : null
  if (competitors) update.competitors = competitors

  const context: ServiceContext = {
    answers,
    gaps: completeness.unknown.map((id) => ({
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
