// Chart series colour, assigned BY ENTITY.
//
// The rule from tokens/chart-palette.json, quoted because it is the whole point:
// "assign colors to entities in this fixed order and keep the assignment stable
// across filters and sessions; color follows the entity, never its rank."
//
// So organic is sienna on every screen, in every date range, whether it is the
// biggest channel this month or the smallest. Two things break if colour follows
// rank instead: a client comparing this month's report to last month's sees the same
// channel change colour, and anyone who learned "sienna = organic" has to relearn it
// per screen.
//
// What this replaces: `COLORS[i % COLORS.length]` in DeviceDonutChart — cycling by
// draw order, with two of the three colours hardcoded as #2dd4bf and #60a5fa, which
// are Tailwind's teal-400 and blue-400 rather than the validated #2FA396 and #5B8DE8.
//
// The four series colours pass the dataviz six-checks on the ink surface (lightness
// band 0.48-0.67, chroma >= 0.1, worst adjacent CVD dE 12.2 protan, all >= 3:1 vs
// surface). That validation holds for these four only — a fifth invented colour has
// not been checked for contrast or colour-blind separation, which is why series 5+
// folds into one "Other" bucket instead.

/** The validated categorical set, in assignment order. */
export const CHART_SERIES = [
  'var(--chart-1)', // sienna  #E0703F
  'var(--chart-2)', // teal    #2FA396
  'var(--chart-3)', // blue    #5B8DE8
  'var(--chart-4)', // gold    #B08A28
] as const

/** Overflow bucket for series 5+ and explicit "Other" aggregations. */
export const CHART_OTHER = 'var(--chart-other)'

/** Single-series charts use this and nothing else, with no legend. */
export const CHART_PRIMARY = CHART_SERIES[0]

/**
 * Entities with a permanent slot.
 *
 * Keyed on a normalised lowercase name. Organic holds slot 0 deliberately: it is the
 * portal's subject, it is what the sienna accent means everywhere else in the app,
 * and it appears in more charts than anything else.
 */
const ENTITY_SLOT: Record<string, number> = {
  // Acquisition channels
  organic: 0,
  'organic search': 0,
  direct: 1,
  referral: 2,
  paid: 3,
  'paid search': 3,
  social: 2,
  'organic social': 2,
  email: 3,
  // Search-brand split
  branded: 0,
  'non-branded': 1,
  nonbranded: 1,
  unbranded: 1,
  // Devices
  desktop: 0,
  mobile: 1,
  tablet: 2,
  // Comparison series
  current: 0,
  prior: 1,
  'prior year': 1,
  'previous period': 1,
}

function normalise(entity: string): string {
  return entity.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The colour for a single named entity, or null when it has no permanent slot. */
export function seriesColorForEntity(entity: string): string | null {
  const slot = ENTITY_SLOT[normalise(entity)]
  return slot === undefined ? null : CHART_SERIES[slot]
}

/**
 * Assign colours to a set of entities.
 *
 * Known entities keep their permanent slot. Unknown ones fill the remaining slots in
 * alphabetical order — NOT input order — so the same set of entities produces the
 * same assignment regardless of how the data happened to be sorted. Anything past
 * four series gets `CHART_OTHER`.
 */
export function assignSeriesColors(entities: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const taken = new Set<number>()
  const unknown: string[] = []

  for (const e of entities) {
    const slot = ENTITY_SLOT[normalise(e)]
    if (slot !== undefined && !taken.has(slot)) {
      taken.add(slot)
      out[e] = CHART_SERIES[slot]
    } else {
      unknown.push(e)
    }
  }

  // Deterministic, so a filter change cannot reshuffle colours.
  for (const e of [...unknown].sort((a, b) => a.localeCompare(b))) {
    const free = [0, 1, 2, 3].find((s) => !taken.has(s))
    if (free === undefined) {
      out[e] = CHART_OTHER
    } else {
      taken.add(free)
      out[e] = CHART_SERIES[free]
    }
  }
  return out
}

/**
 * Fold a series list down to at most four plus an "Other" count.
 *
 * For callers with an unbounded number of series (a top-N table rendered as a chart).
 * The alternative — cycling — reuses a colour and so implies two unrelated things are
 * the same thing.
 */
export function foldToFour<T>(items: T[]): { kept: T[]; otherCount: number } {
  if (items.length <= 4) return { kept: items, otherCount: 0 }
  return { kept: items.slice(0, 4), otherCount: items.length - 4 }
}

// ── Shared Recharts styling, so nine components stop each deciding ──────────────

/** Line width 2, per spec. */
export const CHART_STROKE_WIDTH = 2

/** Dots off by default; r=4 only on hover/active. */
export const CHART_DOT = false as const
export const CHART_ACTIVE_DOT = { r: 4 } as const

/** Area fills sit at 8-10% of the series colour. No gradient defs. */
export const CHART_AREA_OPACITY = 0.09

/** Axis and tick text: Archivo 12px, muted. */
export const CHART_TICK = { fill: 'var(--chart-tick)', fontSize: 12 } as const

/** Horizontal-only grid, 1px. */
export const CHART_GRID = {
  stroke: 'var(--chart-grid)',
  strokeDasharray: '3 3',
  vertical: false,
} as const

/** Paper-on-ink tooltip, matching the site's chart tip. */
export const CHART_TOOLTIP_STYLE = {
  background: 'var(--chart-tooltip-bg)',
  border: '1px solid var(--chart-tooltip-border)',
  borderRadius: 2,
  color: 'var(--chart-tooltip-fg)',
} as const

/**
 * A text alternative narrating a trend.
 *
 * Every chart needs one — a canvas of SVG paths is invisible to a screen reader, and
 * the site's own chart already does this. Kept deliberately plain: direction,
 * magnitude, and the window.
 */
export function describeTrend(
  label: string,
  first: number | null | undefined,
  last: number | null | undefined,
  windowText?: string,
): string {
  if (first == null || last == null || !Number.isFinite(first) || !Number.isFinite(last)) {
    return `${label}: no trend data available.`
  }
  const window = windowText ? ` over ${windowText}` : ''
  if (first === 0 && last === 0) return `${label}: flat at zero${window}.`
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (first === 0) return `${label}: rose from zero to ${fmt(last)}${window}.`
  const pct = Math.round(((last - first) / Math.abs(first)) * 100)
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  if (dir === 'flat') return `${label}: flat at about ${fmt(last)}${window}.`
  return `${label}: ${dir} ${Math.abs(pct)}%${window}, from ${fmt(first)} to ${fmt(last)}.`
}
