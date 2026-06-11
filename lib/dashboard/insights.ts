// Structured insight engine (Phase B, workstream B1).
//
// PURE, deterministic helpers — NO LLM, NO 'use server', NO side effects.
// Given metric deltas already fetched from GA4 / GSC / GBP, derive a ranked
// list of InsightCard[] with correct direction, severity, human-readable
// magnitude, a one-sentence statement, and a business "why it matters".
//
// Consumed by app/actions/analytics.ts (to persist into snapshot_insights) and
// presented by components/dashboard/modules/InsightCards.tsx.

import type {
  InsightCard,
  InsightDirection,
  InsightSeverity,
  DashboardModuleId,
} from '@/lib/dashboard/types'

// ── Input signals ─────────────────────────────────────────────────────────────
// One metric signal. `value` is the current-period value; `delta` is the signed
// percent change vs the comparison period (e.g. 18 = +18%, -4.2 = −4.2%).
// `absoluteDelta` (optional) is the signed raw change for richer magnitude text.

export interface MetricSignal {
  /** Current-period value (used for display + zero-baseline guards). */
  value: number
  /** Signed percent change vs comparison period (e.g. 18 or -4.2). Undefined = no comparison. */
  delta?: number
  /** Signed absolute change vs comparison period (e.g. -312). Optional. */
  absoluteDelta?: number
}

/**
 * The signals the insight engine derives cards from. Every field is optional so
 * callers pass only what they actually fetched; missing signals yield no card.
 */
export interface InsightSignals {
  /** GA4 total sessions. North-star traffic metric. */
  sessions?: MetricSignal
  /** GA4 users. */
  users?: MetricSignal
  /** GA4 pageviews. */
  pageviews?: MetricSignal
  /** GSC organic clicks. North-star organic metric. */
  organicClicks?: MetricSignal
  /** GSC impressions. */
  impressions?: MetricSignal
  /** GSC average position (LOWER is better — handled by `lowerIsBetter`). */
  avgPosition?: MetricSignal
  /** Conversions (GA4 key events) — north-star outcome metric. */
  conversions?: MetricSignal
  /** Revenue (GA4 ecommerce) — north-star outcome metric. */
  revenue?: MetricSignal
  /** Google Business Profile phone calls. North-star local metric. */
  gbpCalls?: MetricSignal
  /** Period label applied to every card, e.g. "vs prior 28 days". */
  period?: string
}

// ── Metric metadata ─────────────────────────────────────────────────────────
// Declarative table of how each signal maps to a human label, importance
// (north-star metrics rank higher and escalate severity), the chart it links
// to, whether a lower value is better, whether it's a currency, and a phrasing
// helper for the "why it matters" implication.

interface MetricMeta {
  key: keyof Omit<InsightSignals, 'period'>
  label: string
  /** Higher weight = ranked first and severity escalates on large moves. */
  weight: number
  /** True for north-star metrics (sessions, organicClicks, conversions, revenue, gbpCalls). */
  northStar: boolean
  chartRef?: DashboardModuleId
  /** When true (e.g. avg search position), a decrease is a positive outcome. */
  lowerIsBetter?: boolean
  /** Render the value/absolute delta as currency. */
  currency?: boolean
  /** Business implication phrasing for the good vs bad outcome. */
  why: (good: boolean) => string
}

const METRICS: MetricMeta[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    weight: 100,
    northStar: true,
    chartRef: 'ecom_funnel',
    currency: true,
    why: (good) =>
      good
        ? 'Top-line revenue is growing — the channel is paying back its investment.'
        : 'Revenue is contracting; protecting top-converting paths should be the priority.',
  },
  {
    key: 'conversions',
    label: 'Conversions',
    weight: 95,
    northStar: true,
    chartRef: 'converting_pages',
    why: (good) =>
      good
        ? 'More conversions means the funnel is turning traffic into qualified outcomes.'
        : 'Fewer conversions signals a funnel or demand issue worth diagnosing this period.',
  },
  {
    key: 'gbpCalls',
    label: 'GBP calls',
    weight: 90,
    northStar: true,
    chartRef: 'gbp_overview',
    why: (good) =>
      good
        ? 'Rising phone calls from the Business Profile is direct, high-intent local demand.'
        : 'Fewer calls from the Business Profile can mean lost local lead volume.',
  },
  {
    key: 'organicClicks',
    label: 'Organic clicks',
    weight: 85,
    northStar: true,
    chartRef: 'search_queries',
    why: (good) =>
      good
        ? 'Organic clicks are the compounding, owned channel — growth here lowers blended CAC.'
        : 'Declining organic clicks erodes the lowest-cost acquisition channel.',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    weight: 80,
    northStar: true,
    chartRef: 'traffic_trend',
    why: (good) =>
      good
        ? 'Overall traffic is up, widening the top of the funnel.'
        : 'A drop in sessions shrinks the top of the funnel and downstream outcomes.',
  },
  {
    key: 'avgPosition',
    label: 'Avg. position',
    weight: 60,
    northStar: false,
    chartRef: 'search_queries',
    lowerIsBetter: true,
    why: (good) =>
      good
        ? 'Average ranking improved, which typically pulls more clicks at the same impressions.'
        : 'Average ranking slipped, putting current click volume at risk.',
  },
  {
    key: 'impressions',
    label: 'Impressions',
    weight: 50,
    northStar: false,
    chartRef: 'search_queries',
    why: (good) =>
      good
        ? 'Growing impressions means more visibility to capture into clicks.'
        : 'Falling impressions reduces the surface area available to win clicks.',
  },
  {
    key: 'users',
    label: 'Users',
    weight: 45,
    northStar: false,
    chartRef: 'traffic_trend',
    why: (good) =>
      good
        ? 'A larger audience reached this period.'
        : 'A smaller audience reached this period.',
  },
  {
    key: 'pageviews',
    label: 'Pageviews',
    weight: 40,
    northStar: false,
    chartRef: 'top_pages',
    why: (good) =>
      good
        ? 'Higher engagement depth across the site.'
        : 'Lower engagement depth across the site.',
  },
]

// ── Magnitude / direction / severity helpers ──────────────────────────────────

const MINUS = '−' // proper minus sign U+2212

/** Format a signed percent into human magnitude, e.g. 18 → "+18%", -4.2 → "−4.2%". */
function formatPercent(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? MINUS : ''
  const abs = Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 1 })
  return `${sign}${abs}%`
}

/** Format a signed absolute change, e.g. -312 → "−312", 1240 → "+1,240". */
function formatAbsolute(value: number, currency: boolean): string {
  const sign = value > 0 ? '+' : value < 0 ? MINUS : ''
  const abs = Math.abs(value)
  const body = currency
    ? abs.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : abs.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return `${sign}${body}`
}

/** Treat tiny percent moves as flat to avoid noisy cards. */
const FLAT_THRESHOLD = 0.5 // percent

function directionOf(delta: number): InsightDirection {
  if (delta > FLAT_THRESHOLD) return 'up'
  if (delta < -FLAT_THRESHOLD) return 'down'
  return 'flat'
}

/**
 * Severity from the *business* outcome (good/bad) and the magnitude of the move,
 * escalating for north-star metrics. Positive outcomes are 'positive'; negative
 * outcomes are 'warning', or 'critical' for large drops on a north-star metric.
 */
function severityOf(good: boolean, absPercent: number, northStar: boolean): InsightSeverity {
  if (absPercent <= FLAT_THRESHOLD) return 'neutral'
  if (good) return 'positive'
  // Negative business outcome.
  if (northStar && absPercent >= 20) return 'critical'
  if (absPercent >= 25) return 'critical'
  return 'warning'
}

// ── Card derivation ─────────────────────────────────────────────────────────

function buildCard(meta: MetricMeta, signal: MetricSignal, period: string): InsightCard | null {
  if (typeof signal.delta !== 'number' || !Number.isFinite(signal.delta)) return null

  const delta = signal.delta
  const direction = directionOf(delta)
  const absPercent = Math.abs(delta)

  // A metric move is "good" when it goes the desired direction for that metric.
  const improving = delta > 0
  const good = meta.lowerIsBetter ? !improving : improving

  // Magnitude prefers percent; for flat moves with an absolute delta we still
  // surface the raw number so the card isn't empty.
  const magnitude =
    typeof signal.absoluteDelta === 'number' && absPercent <= FLAT_THRESHOLD
      ? formatAbsolute(signal.absoluteDelta, Boolean(meta.currency))
      : formatPercent(delta)

  const severity = severityOf(good, absPercent, meta.northStar)

  const verb =
    direction === 'flat'
      ? 'held roughly flat'
      : meta.lowerIsBetter
      ? direction === 'down'
        ? 'improved'
        : 'worsened'
      : direction === 'up'
      ? 'rose'
      : 'fell'

  const statement = `${meta.label} ${verb} ${magnitude} ${period}.`

  return {
    metric: meta.label,
    direction,
    magnitude,
    period,
    statement,
    whyItMatters: meta.why(good),
    severity,
    chartRef: meta.chartRef,
  }
}

/** Rank order: severity priority, north-star, weight, magnitude. */
const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 3,
  warning: 2,
  positive: 1,
  neutral: 0,
}

/** Pull the numeric portion out of a formatted magnitude for tie-breaking. */
function magnitudeAbs(card: InsightCard): number {
  if (card.direction === 'flat') return 0
  const n = parseFloat(card.magnitude.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Derive a ranked InsightCard[] from metric deltas. Deterministic and pure.
 * Cards are ordered so the most action-worthy insights surface first:
 * critical/warning before positive, north-star before secondary, then weight
 * and magnitude. `limit` caps the number of cards returned (default 6).
 */
export function deriveInsightCards(signals: InsightSignals, limit = 6): InsightCard[] {
  const period = signals.period ?? 'vs prior period'

  const cards = METRICS.map((meta) => {
    const signal = signals[meta.key]
    if (!signal) return null
    const card = buildCard(meta, signal, period)
    return card ? { meta, card } : null
  }).filter((x): x is { meta: MetricMeta; card: InsightCard } => x !== null)

  cards.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.card.severity] - SEVERITY_RANK[a.card.severity]
    if (sevDiff !== 0) return sevDiff
    if (a.meta.northStar !== b.meta.northStar) return a.meta.northStar ? -1 : 1
    if (a.meta.weight !== b.meta.weight) return b.meta.weight - a.meta.weight
    return magnitudeAbs(b.card) - magnitudeAbs(a.card)
  })

  return cards.slice(0, Math.max(0, limit)).map((x) => x.card)
}

/**
 * Derive a concise one-line headline from the top-ranked card, used as a
 * deterministic fallback when no LLM headline is available. Returns undefined
 * when there are no cards.
 */
export function deriveHeadline(cards: InsightCard[]): string | undefined {
  const top = cards[0]
  if (!top) return undefined
  if (top.direction === 'flat') {
    return `${top.metric} held steady ${top.period} — performance is stable.`
  }
  const moved = top.severity === 'positive' ? 'is up' : 'moved'
  return `${top.metric} ${moved} ${top.magnitude} ${top.period} — ${top.metric.toLowerCase()} is the story this period.`
}
