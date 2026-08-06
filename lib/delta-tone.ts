// One decision about what colour a delta is.
//
// Before this there were five independent implementations, and they disagreed:
//
//   components/ui/DeltaChip.tsx          emerald-500 / rose-500
//   dashboard/modules/MetricTable13.tsx  emerald-500 / rose-500 (lucide icons)
//   home/AdminTriageStrip.tsx            emerald-500 / rose-500 (copy of DeltaChip)
//   dashboard/DashboardTabs.tsx          emerald-400 / rose-400  ← off by a step
//   analytics/.../GscQueriesTable.tsx    accent-400 / rose-400   ← sienna, not green
//   analytics/.../GscUrlsTable.tsx       accent-400 / rose-400
//
// So the same "up 5%" rendered in three different colours depending on which
// screen you were on, and none of them were tokens.
//
// Colour choice: the token `success` / `error` pair, not the spec's brand-400
// sienna. PORTAL-REBRAND-SPEC §4 says a positive delta is sienna and lvl3.com
// renders both directions that way, but a dashboard is read by clients who parse
// green-good/red-bad instantly. Keeping the convention while moving it onto the
// palette is the deliberate compromise — see REBRAND-NOTES.md. `brand-400` stays
// reserved for accents, links and active states.
//
// Colour is never the only signal (§4): every caller also renders an arrow or
// icon plus, where there's room, a word.

export type DeltaTone = 'positive' | 'negative' | 'flat'

/**
 * Which tone a numeric delta carries.
 *
 * `goodDirection` exists for inverted metrics — Avg Position improves as it
 * falls, so it passes `'down'` and a decrease reads positive. The arrow still
 * shows the numeric direction; only the tone follows `goodDirection`.
 *
 * Exactly zero is always `flat`, never positive. One of the five old
 * implementations used `>= 0` and rendered a green "+0%" for no change.
 */
export function deltaTone(value: number, goodDirection: 'up' | 'down' = 'up'): DeltaTone {
  if (!Number.isFinite(value) || value === 0) return 'flat'
  const numericallyUp = value > 0
  const isGood = goodDirection === 'up' ? numericallyUp : !numericallyUp
  return isGood ? 'positive' : 'negative'
}

/** Tone → text colour class. The only place these three classes are chosen. */
export const DELTA_TONE_TEXT: Record<DeltaTone, string> = {
  positive: 'text-success',
  negative: 'text-error',
  flat: 'text-surface-400',
}

/** Tone for a `'up' | 'down' | 'flat'` direction, for callers that carry one. */
export function toneFromDirection(
  direction: 'up' | 'down' | 'flat',
  goodDirection: 'up' | 'down' = 'up',
): DeltaTone {
  if (direction === 'flat') return 'flat'
  return direction === goodDirection ? 'positive' : 'negative'
}
