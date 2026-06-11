import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import type { InsightCard, InsightDirection, InsightSeverity } from '@/lib/dashboard/types'

interface InsightCardsProps {
  cards: InsightCard[]
}

/** Per-severity color tokens. */
const SEVERITY_STYLES: Record<
  InsightSeverity,
  { border: string; accent: string; chip: string; label: string }
> = {
  positive: {
    border: 'border-accent-400/30',
    accent: 'text-accent-400',
    chip: 'bg-accent-400/10 text-accent-400 border-accent-400/20',
    label: 'Positive',
  },
  neutral: {
    border: 'border-surface-700',
    accent: 'text-surface-400',
    chip: 'bg-surface-700/50 text-surface-400 border-surface-600',
    label: 'Steady',
  },
  warning: {
    border: 'border-amber-500/30',
    accent: 'text-amber-400',
    chip: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    label: 'Watch',
  },
  critical: {
    border: 'border-rose-500/40',
    accent: 'text-rose-400',
    chip: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    label: 'Attention',
  },
}

const DIRECTION_ICON: Record<InsightDirection, React.ElementType> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
}

function InsightCardTile({ card }: { card: InsightCard }) {
  const styles = SEVERITY_STYLES[card.severity]
  const Arrow = DIRECTION_ICON[card.direction]

  return (
    <div
      className={`bg-surface-900 border ${styles.border} rounded-xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)]`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs font-medium uppercase tracking-widest text-surface-400">
          {card.metric}
        </p>
        <span
          className={`inline-flex items-center text-[10px] font-medium uppercase tracking-[0.1em] px-2 py-0.5 rounded-full border ${styles.chip}`}
        >
          {styles.label}
        </span>
      </div>

      <div className={`flex items-center gap-1.5 mb-3 ${styles.accent}`}>
        <Arrow className="w-5 h-5" aria-hidden="true" />
        <span
          className="text-2xl font-bold leading-none"
          style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
        >
          {card.magnitude}
        </span>
        <span className="text-xs text-surface-500 self-end mb-0.5">{card.period}</span>
      </div>

      <p className="text-sm text-surface-200 leading-relaxed mb-2">{card.statement}</p>
      <p className="text-xs text-surface-400 leading-relaxed">{card.whyItMatters}</p>
      {card.action && (
        <p className="mt-2 pt-2 border-t border-surface-800 text-xs text-surface-500 leading-relaxed">
          <span className="font-medium uppercase tracking-[0.1em] text-[10px] text-surface-400 mr-1.5">
            Next
          </span>
          {card.action}
        </p>
      )}
    </div>
  )
}

/**
 * Presentational insight-cards module. Renders a responsive grid of
 * severity-colored insight cards, each reading observation → so-what →
 * next-step: the chip (metric + direction arrow + magnitude), the quantified
 * statement, the business implication, and a subtle next-step action. The
 * narrative headline lives in the exec band, not here. Renders nothing when
 * there are no cards.
 */
export default function InsightCards({ cards }: InsightCardsProps) {
  if (!cards || cards.length === 0) return null

  return (
    <section className="space-y-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500">
        Key Insights
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => (
          <InsightCardTile key={`${card.metric}-${i}`} card={card} />
        ))}
      </div>
    </section>
  )
}
