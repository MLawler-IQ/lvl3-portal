import DeltaChip from './DeltaChip'
import Sparkline from './Sparkline'
import type { TrendPoint } from '@/lib/dashboard/types'

// The site's ledger language, at app density.
//
// PORTAL-REBRAND-SPEC calls this the one pattern that ports directly from
// lvl3.com: hairline-ruled rows, Newsreader tabular numerals, right-aligned
// deltas. It's the "(One system, any industry)" section of the homepage.
//
// Deliberately NOT a card. The site's own rules say card borders and shadows do
// not exist and rules separate content, so a row carries a single top hairline
// and the group closes with a bottom one.
//
// Roles are inverted from the tile this replaces. The tile put the value in
// sienna and the delta in emerald; here the value is plain surface-100 and only
// the delta carries colour, which is what makes a column of rows scannable
// rather than five competing accents.

const SERIF_NUM = {
  fontFamily: 'var(--font-newsreader), Georgia, serif',
  fontVariantNumeric: 'tabular-nums' as const,
}

export interface LedgerRowProps {
  label: string
  value: string
  delta?: {
    direction: 'up' | 'down' | 'flat'
    percent: string
    absolute?: string
    goodDirection?: 'up' | 'down'
    wording?: { up: string; down: string }
  }
  tooltip?: string
  sparkline?: number[] | TrendPoint[]
}

export default function LedgerRow({ label, value, delta, tooltip, sparkline }: LedgerRowProps) {
  return (
    <div className="flex items-baseline gap-4 border-t border-surface-800 py-4 last:border-b">
      {/* Label — roughly the site's 44% column, collapsing on narrow screens. */}
      <div className="flex min-w-0 basis-[42%] items-center gap-1.5">
        <p className="truncate text-sm text-surface-400">{label}</p>
        {tooltip && <InfoTip label={label} text={tooltip} />}
      </div>

      {/* Value — the ledger numeral. */}
      <p
        className="flex-1 text-xl font-medium tabular-nums text-surface-100 sm:text-2xl"
        style={SERIF_NUM}
      >
        {value}
      </p>

      {/* Trend, where there is one. Hidden on narrow screens so the row holds. */}
      {sparkline && sparkline.length >= 2 && (
        <div className="hidden w-24 shrink-0 self-center sm:block" aria-hidden="true">
          <Sparkline data={sparkline} height={22} />
        </div>
      )}

      {/* Delta — right-aligned, the only coloured thing in the row. */}
      <div className="shrink-0 text-right">
        {delta && (
          <DeltaChip
            direction={delta.direction}
            percent={delta.percent}
            absolute={delta.absolute}
            goodDirection={delta.goodDirection}
            wording={delta.wording}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The "?" affordance.
 *
 * Opens on hover AND on keyboard focus. The tile version this replaced revealed
 * only on `group-hover` from a `<button>` with no handler, so keyboard and touch
 * users could never read any of these tooltips. `group-focus-within` fixes that
 * without needing state.
 *
 * Colours come from the --chart-tooltip-* tokens, which exist for exactly this
 * paper-on-ink inversion; the old markup paired a paper background with a dark
 * surface-700 border.
 */
function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={`What ${label} measures`}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-surface-700 text-[10px] text-surface-400 transition-colors hover:border-surface-600 hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-48 -translate-x-1/2 whitespace-normal rounded-sm px-3 py-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          background: 'var(--chart-tooltip-bg)',
          color: 'var(--chart-tooltip-fg)',
          border: '1px solid var(--chart-tooltip-border)',
        }}
      >
        {text}
      </span>
    </span>
  )
}
