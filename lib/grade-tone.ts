// Letter-grade chip styling, in one place.
//
// This map existed twice, byte-identical: components/dashboard/exec/HealthScorecard.tsx
// and components/home/AdminTriageStrip.tsx, the latter with a comment admitting it
// was "matching the exec HealthScorecard". Two copies of a colour decision is how
// they drift.
//
// Tokenised on the way through: amber-400 → warning, rose-400 → error. `brand-400`
// rather than the `accent-400` alias, since accent is just an alias of brand and one
// name is clearer than two.
//
// A/B share a tone and C/D share a tone deliberately — the chip communicates a band,
// not five distinct states, and §4's rule is that a status colour never carries
// meaning alone: every caller renders the letter itself next to the chip.

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export const GRADE_CHIP: Record<LetterGrade, string> = {
  A: 'text-brand-400 border-brand-400/40 bg-brand-400/10',
  B: 'text-brand-400 border-brand-400/40 bg-brand-400/10',
  C: 'text-warning border-warning/40 bg-warning/10',
  D: 'text-warning border-warning/40 bg-warning/10',
  F: 'text-error border-error/40 bg-error/10',
}

/** Derive a letter grade from a 0–100 score. */
export function scoreToGrade(score: number): LetterGrade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}
