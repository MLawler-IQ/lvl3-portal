import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import type { InsightCard, InsightDirection, InsightSeverity } from '@/lib/dashboard/types'
import { STATUS_TONE, SEVERITY_TONE } from '@/lib/status-tone'

interface InsightCardsProps {
  cards: InsightCard[]
}

/** Per-severity tokens. Colours come from lib/status-tone; only the wording is local. */
const SEVERITY_STYLES: Record<
  InsightSeverity,
  { border: string; accent: string; chip: string; label: string }
> = {
  positive: { ...toneOf('positive'), label: 'Positive' },
  neutral: { ...toneOf('neutral'), label: 'Steady' },
  warning: { ...toneOf('warning'), label: 'Watch' },
  critical: { ...toneOf('critical'), label: 'Attention' },
}

function toneOf(severity: keyof typeof SEVERITY_TONE) {
  const s = STATUS_TONE[SEVERITY_TONE[severity]]
  return { border: s.border, accent: s.text, chip: s.chip }
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
      className={`bg-surface-900 border ${styles.border} rounded-sm p-5 transition-colors duration-200 hover:bg-surface-850`}
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
          className="text-2xl font-medium font-serif tabular-nums leading-none"
          style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
        >
          {card.magnitude}
        </span>
        <span className="text-xs text-surface-400 self-end mb-0.5">{card.period}</span>
      </div>

      <p className="text-sm text-surface-200 leading-relaxed mb-2">{card.statement}</p>
      <p className="text-xs text-surface-400 leading-relaxed">{card.whyItMatters}</p>
      {card.action && (
        <p className="mt-2 pt-2 border-t border-surface-800 text-xs text-surface-400 leading-relaxed">
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
