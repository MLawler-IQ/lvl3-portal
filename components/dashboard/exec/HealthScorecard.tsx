import type { HealthItem } from './ExecutiveSummaryBand'
import { GRADE_CHIP, scoreToGrade } from '@/lib/grade-tone'


function GradeChip({ grade }: { grade: NonNullable<HealthItem['grade']> }) {
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold ${GRADE_CHIP[grade]}`}
      style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
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
                style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
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
