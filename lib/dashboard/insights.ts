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
  /**
   * Adds information BEYOND metric+direction+magnitude (the chip already shows
   * those). Receives the formatted current value + good/flat state. Should not
   * restate "<metric> rose/fell <magnitude>".
   */
  context: (value: string, good: boolean, flat: boolean) => string
  /** Concrete business implication for the good vs bad outcome. */
  why: (good: boolean) => string
  /** Imperative next-step, one sentence, for the good vs bad/flat outcome. */
  action: (good: boolean, flat: boolean) => string
}

const METRICS: MetricMeta[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    weight: 100,
    northStar: true,
    chartRef: 'ecom_funnel',
    currency: true,
    context: (value, good, flat) =>
      flat
        ? `Revenue landed at ${value} this period, in line with the comparison window.`
        : `Revenue landed at ${value} this period.`,
    why: (good) =>
      good
        ? 'Higher revenue means the channel is paying back its investment faster.'
        : 'Lower revenue means the channel is returning less on the same spend.',
    action: (good, flat) =>
      flat
        ? 'Hold revenue steady by protecting your top-converting paths.'
        : good
        ? 'Double down on the campaigns and pages driving the lift.'
        : 'Audit the top revenue-driving paths for drop-off or tracking gaps.',
  },
  {
    // Labeled "Purchases" (GA4 transactions-backed). The signal field stays
    // `conversions`; "Conversions" is reserved for keyEvents-backed numbers.
    key: 'conversions',
    label: 'Purchases',
    weight: 95,
    northStar: true,
    chartRef: 'converting_pages',
    context: (value, good, flat) =>
      flat
        ? `Purchases held at ${value} this period.`
        : `Purchases reached ${value} this period.`,
    why: (good) =>
      good
        ? 'More purchases means the funnel is turning visits into completed orders.'
        : 'Fewer purchases points to checkout friction or softer buying intent.',
    action: (good, flat) =>
      flat
        ? 'Watch checkout completion to keep purchases on pace.'
        : good
        ? 'Scale the traffic sources feeding the converting product pages.'
        : 'Review the checkout funnel for the step shedding the most buyers.',
  },
  {
    key: 'gbpCalls',
    label: 'GBP calls',
    weight: 90,
    northStar: true,
    chartRef: 'gbp_overview',
    context: (value, good, flat) =>
      flat
        ? `Profile calls held at ${value} from Search and Maps.`
        : `Profile calls reached ${value} from Search and Maps.`,
    why: (good) =>
      good
        ? 'More calls from the Business Profile is direct, high-intent local demand.'
        : 'Fewer calls from the Business Profile means lost high-intent local leads.',
    action: (good, flat) =>
      flat
        ? 'Keep hours and call buttons current to hold call volume.'
        : good
        ? 'Sustain the lift with fresh posts and prompt review replies.'
        : 'Verify the listed phone number, hours, and call-button on each profile.',
  },
  {
    key: 'organicClicks',
    label: 'Organic clicks',
    weight: 85,
    northStar: true,
    chartRef: 'search_queries',
    context: (value, good, flat) =>
      flat
        ? `Organic search sent ${value} clicks, flat versus the comparison window.`
        : `Organic search sent ${value} clicks this period.`,
    why: (good) =>
      good
        ? 'Organic is the owned channel that compounds — growth here lowers blended CAC.'
        : 'Falling organic clicks erodes your lowest-cost acquisition channel.',
    action: (good, flat) =>
      flat
        ? 'Refresh the pages closest to page one to break the plateau.'
        : good
        ? 'Expand the queries and pages gaining clicks before competitors react.'
        : 'Check the top-traffic queries for ranking or CTR losses to recover.',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    weight: 80,
    northStar: true,
    chartRef: 'traffic_trend',
    context: (value, good, flat) =>
      flat
        ? `The site drew ${value} sessions, holding flat this period.`
        : `The site drew ${value} sessions this period.`,
    why: (good) =>
      good
        ? 'A wider top of funnel gives every downstream conversion step more to work with.'
        : 'A narrower top of funnel caps the conversions and revenue that can follow.',
    action: (good, flat) =>
      flat
        ? 'Find one under-served channel to reopen traffic growth.'
        : good
        ? 'Trace the lift to its channel and reinforce what is working.'
        : 'Compare channels to isolate where the traffic loss originated.',
  },
  {
    key: 'avgPosition',
    label: 'Avg. position',
    weight: 60,
    northStar: false,
    chartRef: 'search_queries',
    lowerIsBetter: true,
    context: (value, good, flat) =>
      flat
        ? `Average ranking sat at position ${value}, essentially unchanged.`
        : `Average ranking moved to position ${value}.`,
    why: (good) =>
      good
        ? 'A higher ranking typically pulls more clicks at the same impression volume.'
        : 'A lower ranking puts your current click volume at risk of slipping.',
    action: (good, flat) =>
      flat
        ? 'Target the page-two queries with the most impressions to climb.'
        : good
        ? 'Build on the gains with internal links and content depth.'
        : 'Shore up the slipping queries before clicks follow the ranking down.',
  },
  {
    key: 'impressions',
    label: 'Impressions',
    weight: 50,
    northStar: false,
    chartRef: 'search_queries',
    context: (value, good, flat) =>
      flat
        ? `Search surfaced the site ${value} times, flat this period.`
        : `Search surfaced the site ${value} times this period.`,
    why: (good) =>
      good
        ? 'More impressions is more demand to convert into clicks if rankings hold.'
        : 'Fewer impressions shrinks the surface area available to win clicks.',
    action: (good, flat) =>
      flat
        ? 'Publish for adjacent queries to grow visible surface area.'
        : good
        ? 'Improve titles and snippets to convert the new visibility into clicks.'
        : 'Check for lost keywords or seasonality behind the visibility drop.',
  },
  {
    key: 'users',
    label: 'Users',
    weight: 45,
    northStar: false,
    chartRef: 'traffic_trend',
    context: (value, good, flat) =>
      flat
        ? `${value} people reached the site, on par with last period.`
        : `${value} people reached the site this period.`,
    why: (good) =>
      good
        ? 'A larger audience expands the pool of potential repeat and converting visitors.'
        : 'A smaller audience leaves fewer prospects to nurture toward conversion.',
    action: (good, flat) =>
      flat
        ? 'Test one new acquisition source to grow reach.'
        : good
        ? 'Capture the new audience with a retargeting or email path.'
        : 'Identify which channel lost reach and whether it is worth recovering.',
  },
  {
    key: 'pageviews',
    label: 'Pageviews',
    weight: 40,
    northStar: false,
    chartRef: 'top_pages',
    context: (value, good, flat) =>
      flat
        ? `Visitors viewed ${value} pages, steady this period.`
        : `Visitors viewed ${value} pages this period.`,
    why: (good) =>
      good
        ? 'Deeper browsing usually signals stronger content fit and intent.'
        : 'Shallower browsing can signal weaker content fit or navigation friction.',
    action: (good, flat) =>
      flat
        ? 'Add related-content links to deepen each visit.'
        : good
        ? 'Surface the most-viewed pages more prominently in navigation.'
        : 'Review entry pages for slow loads or weak internal linking.',
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

/**
 * Format a current-period VALUE for the statement (no sign). Currency metrics
 * render as USD; avg-position keeps one decimal (e.g. "4.2"); everything else
 * is a rounded integer with thousands separators.
 */
function formatValue(value: number, currency: boolean, decimals = 0): string {
  if (currency) {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals })
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
  const flat = direction === 'flat'

  // A metric move is "good" when it goes the desired direction for that metric.
  // avgPosition is lowerIsBetter: a numeric DECREASE is an improvement.
  const improving = delta > 0
  const good = meta.lowerIsBetter ? !improving : improving

  // Magnitude prefers percent; for flat moves with an absolute delta we still
  // surface the raw number so the card isn't empty.
  const magnitude =
    typeof signal.absoluteDelta === 'number' && absPercent <= FLAT_THRESHOLD
      ? formatAbsolute(signal.absoluteDelta, Boolean(meta.currency))
      : formatPercent(delta)

  const severity = severityOf(good, absPercent, meta.northStar)

  // Statement ADDS the current value + framing; the chip (metric + arrow +
  // magnitude) already carries direction & magnitude, so we never restate
  // "<metric> rose/fell <magnitude>" here — that was the duplicated copy.
  const valueText = formatValue(signal.value, Boolean(meta.currency), meta.lowerIsBetter ? 1 : 0)
  const statement = meta.context(valueText, good, flat)

  return {
    metric: meta.label,
    direction,
    magnitude,
    period,
    statement,
    whyItMatters: meta.why(good),
    action: meta.action(good, flat),
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
 * when there are no cards. Deterministic + quantified, with no duplicated
 * "<metric> … <metric>" pattern. Decline phrasing here ("down", "fell off")
 * must stay matchable by AnalyticsSection's HEADLINE_DECLINE_RE dedup check.
 */
export function deriveHeadline(cards: InsightCard[]): string | undefined {
  const top = cards[0]
  if (!top) return undefined
  if (top.direction === 'flat') {
    return `${top.metric} held steady at ${top.magnitude} ${top.period}.`
  }
  // Severity encodes the business outcome (so avgPosition's "down = better"
  // reads correctly): positive → improvement verb, otherwise a decline verb.
  // Keep a decline keyword present for the dedup regex.
  const good = top.severity === 'positive'
  const verb = good
    ? top.direction === 'up'
      ? 'climbed'
      : 'improved to'
    : top.direction === 'down'
    ? 'fell'
    : 'slipped to'
  const lede = good ? 'leads the period' : 'needs attention'
  return `${top.metric} ${verb} ${top.magnitude} ${top.period} and ${lede}.`
}
