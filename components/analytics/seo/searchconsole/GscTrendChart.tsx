'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { makeAxisFormatter } from '@/components/analytics/shared/TrendChart'
import type { GSCTrendBucket } from '@/lib/google-search-console'
import type { Granularity } from '@/lib/dashboard/types'
import {
  assignSeriesColors,
  seriesColorForEntity,
  describeTrend,
  CHART_ACTIVE_DOT,
  CHART_AREA_OPACITY,
  CHART_DOT,
  CHART_GRID,
  CHART_STROKE_WIDTH,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
} from '@/lib/charts/palette'

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function bucketNoun(granularity: Granularity, count: number): string {
  const unit = granularity === 'monthly' ? 'month' : granularity === 'weekly' ? 'week' : 'day'
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

// Colour follows the ENTITY, not the chart it happens to be drawn in.
//
// Neither "clicks" nor "impressions" holds a permanent slot in the palette's ENTITY_SLOT
// map, so seriesColorForEntity returns null for both. `?? CHART_OTHER` — the
// DeviceDonutChart fallback — is wrong here: it would paint both metrics the same grey
// and undo the whole point of splitting them. assignSeriesColors is the module's own
// fallback for unknown entities and fills free slots in ALPHABETICAL order, not input
// order, so Clicks is sienna (slot 0) and Impressions is teal (slot 1) on every client,
// in every date range, forever. seriesColorForEntity still gets first refusal, so if
// either metric later earns a permanent slot this picks it up with no edit here.
const METRIC_PAIR = assignSeriesColors(['Clicks', 'Impressions'])
const CLICKS_COLOR = seriesColorForEntity('Clicks') ?? METRIC_PAIR.Clicks
const IMPRESSIONS_COLOR = seriesColorForEntity('Impressions') ?? METRIC_PAIR.Impressions

/** Both panels share this, so the two x-axes line up and dates read down the column. */
const PANEL_MARGIN = { top: 4, right: 16, bottom: 0, left: 0 } as const
// 56, not 44: impressions run into six-character ticks ("260.0K") and 44px clipped
// the leading digit — verified in the browser, where the axis read "60.0K" on a
// 260K peak. Both panels share this width so their x-axes stay vertically aligned,
// which is what makes timing comparable without a shared y-scale.
const Y_AXIS_WIDTH = 56
const PANEL_HEIGHT = 180

interface MetricPanelProps {
  data: GSCTrendBucket[]
  dataKey: 'clicks' | 'impressions'
  label: string
  color: string
  summary: string
  axisFormatter: (key: string) => string
}

/**
 * One metric, one y-axis.
 *
 * Internal — the module's public surface is still the single default export, so callers
 * are untouched.
 */
function MetricPanel({ data, dataKey, label, color, summary, axisFormatter }: MetricPanelProps) {
  return (
    <div>
      <p className="text-xs font-medium text-surface-300 mb-1">{label}</p>
      {/* Text alternative — a canvas of SVG paths is invisible to a screen reader, and
          each panel must narrate its OWN trend or the split hides half the story. */}
      <p className="sr-only">{summary}</p>
      <ResponsiveContainer width="100%" height={PANEL_HEIGHT}>
        <AreaChart role="img" aria-label={summary} data={data} margin={PANEL_MARGIN}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis
            dataKey="date"
            tickFormatter={axisFormatter}
            tick={CHART_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={fmtNum}
            tick={CHART_TICK}
            axisLine={false}
            tickLine={false}
            width={Y_AXIS_WIDTH}
          />
          <Tooltip
            formatter={(v) => [Number(v ?? 0).toLocaleString(), label]}
            labelFormatter={(key) => axisFormatter(String(key))}
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={{ color: 'var(--chart-tooltip-fg)' }}
            itemStyle={{ color: 'var(--chart-tooltip-fg)' }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke={color}
            strokeWidth={CHART_STROKE_WIDTH}
            fill={color}
            fillOpacity={CHART_AREA_OPACITY}
            dot={CHART_DOT}
            activeDot={CHART_ACTIVE_DOT}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

interface Props {
  /** Period-aware clicks/impressions buckets (window follows the picker). */
  data: GSCTrendBucket[]
  /** Bucket size of `data` — drives the x-axis tick formatting. */
  granularity: Granularity
  /** The window the series covers, e.g. "Last 28 days" — stated on the card. */
  periodLabel?: string
}

/**
 * Clicks and impressions over the selected window, as TWO single-axis charts.
 *
 * This was one ComposedChart carrying two axes — clicks on the left, impressions on the
 * right. Dual axes are banned: with two independent scales the author picks the
 * scaling, and the scaling picks the correlation — impressions can be made to hug clicks
 * or diverge from them on identical data, and the reader has no way to tell which they're
 * looking at. Splitting is the honest fix. Indexing both to 100 would also remove the
 * false correlation, but clients ask "how many clicks", and an indexed chart cannot
 * answer that.
 *
 * Clicks leads because it is the outcome metric; impressions is the input beneath it.
 */
export default function GscTrendChart({ data, granularity, periodLabel }: Props) {
  const axisFormatter = makeAxisFormatter(granularity)
  // Named windowText, not `window` — this is a client component, and shadowing the
  // global there is a trap for whoever next reaches for it.
  const windowText = bucketNoun(granularity, data.length)
  const last = data[data.length - 1]

  const clicksSummary = describeTrend('Clicks', data[0]?.clicks, last?.clicks, windowText)
  const impressionsSummary = describeTrend('Impressions', data[0]?.impressions, last?.impressions, windowText)

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-surface-100">Clicks &amp; Impressions Trend</p>
        {periodLabel && <p className="text-xs text-surface-400">{periodLabel}</p>}
      </div>
      {/* Separate scales, separate charts, stacked so the dates still line up. */}
      <div className="space-y-4">
        <MetricPanel
          data={data}
          dataKey="clicks"
          label="Clicks"
          color={CLICKS_COLOR}
          summary={clicksSummary}
          axisFormatter={axisFormatter}
        />
        <MetricPanel
          data={data}
          dataKey="impressions"
          label="Impressions"
          color={IMPRESSIONS_COLOR}
          summary={impressionsSummary}
          axisFormatter={axisFormatter}
        />
      </div>
    </div>
  )
}
