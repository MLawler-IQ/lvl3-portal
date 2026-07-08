import type { ItemAnswers, ReviewDecision } from './types'

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  approve: 'Approved',
  deny: 'Denied',
}

export function counts(
  itemIds: string[],
  answers: Record<string, ItemAnswers | undefined>
): { approved: number; denied: number; pending: number; reviewed: number } {
  let approved = 0
  let denied = 0
  for (const id of itemIds) {
    const d = answers[id]?.decision
    if (d === 'approve') approved++
    else if (d === 'deny') denied++
  }
  const reviewed = approved + denied
  return { approved, denied, reviewed, pending: itemIds.length - reviewed }
}

/**
 * Plain-text decisions summary — same per-item format as the prototype's
 * buildText(). Used verbatim for the reviewer "Copy summary" button and the
 * owner notification email.
 */
export function buildSummaryText(
  batch: { client: string; title: string },
  items: Array<{ id: string; sort_order: number; title: string }>,
  answers: Record<string, ItemAnswers | undefined>
): string {
  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order)
  const lines: string[] = [`${batch.client} — ${batch.title} — decisions`, '']
  ordered.forEach((item, i) => {
    const a = answers[item.id]
    lines.push(`${i + 1}. ${item.title}`)
    lines.push(`   Rating: ${a?.rating ? `${a.rating}/10` : '(not rated)'}`)
    lines.push(`   Decision: ${a?.decision ? DECISION_LABEL[a.decision] : '(not reviewed)'}`)
    const note = (a?.note ?? '').trim()
    if (note) lines.push(`   Notes: ${note}`)
    lines.push('')
  })
  const c = counts(ordered.map((i) => i.id), answers)
  lines.push(`${c.approved} approved · ${c.denied} denied · ${c.pending} pending`)
  return lines.join('\n')
}
