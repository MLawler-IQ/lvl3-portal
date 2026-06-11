import type { HealthItem } from './ExecutiveSummaryBand'

/** Maps a letter grade to its chip colors (Tailwind tokens used elsewhere in-app). */
const GRADE_STYLES: Record<NonNullable<HealthItem['grade']>, string> = {
  A: 'text-accent-400 border-accent-400/40 bg-accent-400/10',
  B: 'text-accent-400 border-accent-400/40 bg-accent-400/10',
  C: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
  D: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
  F: 'text-rose-400 border-rose-400/40 bg-rose-400/10',
}

/** Derive a letter grade from a 0–100 score when no explicit grade is supplied. */
function scoreToGrade(score: number): NonNullable<HealthItem['grade']> {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

function GradeChip({ grade }: { grade: NonNullable<HealthItem['grade']> }) {
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold ${GRADE_STYLES[grade]}`}
      style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  )
}

/** Compact row of health metrics, each shown as a label + colored grade chip. */
export default function HealthScorecard({ items }: { items: HealthItem[] }) {
  if (!items.length) return null

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {items.map((item, i) => {
        const grade =
          item.grade ?? (typeof item.score === 'number' ? scoreToGrade(item.score) : undefined)
        return (
          <div key={`${item.label}-${i}`} className="flex items-center gap-2">
            {grade ? (
              <GradeChip grade={grade} />
            ) : typeof item.score === 'number' ? (
              <span
                className="text-sm font-bold text-surface-100"
                style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
              >
                {item.score}
              </span>
            ) : null}
            <span className="text-xs font-medium uppercase tracking-widest text-surface-400">
              {item.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
