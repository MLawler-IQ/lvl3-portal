// One tone set for every status surface in the app.
//
// Three incompatible chip idioms were in circulation across ~13 hand-rolled maps:
//
//   A  bg-{c}-500/15  text-{c}-400  border-{c}-500/20
//   B  bg-{c}-400/10  text-{c}-400  border-{c}-400/40
//   C  bg-{c}-900/40  text-{c}-400  border-{c}-700/50
//
// This settles on B, because lib/grade-tone.ts already standardised on it and a
// /40 border reads better than /20 against the ink surface. Every map that used A
// or C moves here.
//
// The five shapes are not decoration — they're what the real maps needed. A chip
// (pills, badges), plain text (inline emphasis), a row (alert callouts with a
// subtle wash), a bar (progress fills, which must be solid), and a border alone
// (card edges keyed to severity).
//
// Rules this encodes, both from PORTAL-REBRAND-SPEC §4:
//   - No new colours. Anything that looked like it needed one gets an existing
//     tone plus a clearer label.
//   - A status colour never carries meaning alone; it always ships with an icon
//     AND a label. components/ui/StatusChip.tsx exists so that's the easy path.

export type StatusTone = 'accent' | 'neutral' | 'success' | 'warning' | 'error'

export interface ToneStyles {
  /** Text only, for inline emphasis. */
  text: string
  /** Pill/badge: tinted fill, coloured text, visible border. */
  chip: string
  /**
   * Selected state of a filter chip. Stronger fill plus a ring, so selection is
   * legible without a second hue — the projects filters previously distinguished
   * on/off by jumping between the -700 and -900 rungs of a raw palette family.
   */
  chipActive: string
  /** Callout row: subtle wash plus border, for alerts. */
  row: string
  /** Solid fill, for progress bars. Tints are invisible at 2px tall. */
  bar: string
  /** Border only, for a card edge keyed to severity. */
  border: string
}

export const STATUS_TONE: Record<StatusTone, ToneStyles> = {
  // Sienna. Notable/exceeding — NOT "good" (that's success). Also the brand accent,
  // so it stays rare: overuse turns the accent into wallpaper.
  accent: {
    text: 'text-brand-400',
    chip: 'bg-brand-400/10 text-brand-400 border-brand-400/40',
    chipActive: 'bg-brand-400/20 text-brand-400 border-brand-400/60 ring-1 ring-brand-400/40',
    row: 'bg-brand-400/10 border-brand-400/30',
    bar: 'bg-brand-400',
    border: 'border-brand-400/30',
  },
  neutral: {
    text: 'text-surface-400',
    chip: 'bg-surface-800 text-surface-400 border-surface-600',
    chipActive: 'bg-surface-700 text-surface-300 border-surface-500 ring-1 ring-surface-500/40',
    row: 'bg-surface-800/60 border-surface-700',
    bar: 'bg-surface-600',
    border: 'border-surface-700',
  },
  success: {
    text: 'text-success',
    chip: 'bg-success/10 text-success border-success/40',
    chipActive: 'bg-success/20 text-success border-success/60 ring-1 ring-success/40',
    row: 'bg-success/10 border-success/30',
    bar: 'bg-success',
    border: 'border-success/30',
  },
  warning: {
    text: 'text-warning',
    chip: 'bg-warning/10 text-warning border-warning/40',
    chipActive: 'bg-warning/20 text-warning border-warning/60 ring-1 ring-warning/40',
    row: 'bg-warning/10 border-warning/30',
    bar: 'bg-warning',
    border: 'border-warning/30',
  },
  error: {
    text: 'text-error',
    chip: 'bg-error/10 text-error border-error/40',
    chipActive: 'bg-error/20 text-error border-error/60 ring-1 ring-error/40',
    row: 'bg-error/10 border-error/30',
    bar: 'bg-error',
    border: 'border-error/30',
  },
}

/**
 * Pacing tone.
 *
 * `on_track` was the only `sky-*` use anywhere in the app, and "no new colours"
 * rules it out. The three states stay distinguishable without it: exceeding is the
 * sienna accent, on track is success, behind is error. The label carries the
 * distinction anyway ("Ahead" vs "On track"), which is the §4 requirement.
 */
export const PACING_TONE = {
  ahead: 'accent',
  on_track: 'success',
  behind: 'error',
} as const satisfies Record<string, StatusTone>

/** Score tone: good / warn / bad, as used by the completeness and health modules. */
export const SCORE_TONE = {
  good: 'success',
  warn: 'warning',
  bad: 'error',
} as const satisfies Record<string, StatusTone>

/** Insight and alert severity → tone. */
export const SEVERITY_TONE = {
  positive: 'accent',
  neutral: 'neutral',
  info: 'neutral',
  warning: 'warning',
  critical: 'error',
} as const satisfies Record<string, StatusTone>
