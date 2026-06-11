import type { GA4Report } from '@/lib/google-analytics'
import type { TrendPoint, Granularity } from '@/lib/dashboard/types'
import SectionHeader from '@/components/analytics/shared/SectionHeader'
import WebsiteKpiRow from './WebsiteKpiRow'
import ChannelBarChart from './ChannelBarChart'
import MonthlySessionsChart from './MonthlySessionsChart'
import SourceMediumTable from './SourceMediumTable'

interface Props {
  ga4: GA4Report | null
  /** Period-aware sessions trend (follows the picker, with comparison overlay). */
  sessionsTrend: TrendPoint[]
  trendGranularity: Granularity
  /** The selected window, e.g. "Last 28 days". */
  periodLabel: string
  /** Legend name for the trend's ghost comparison series. */
  trendCompareLabel?: string
}

export default function WebsiteTab({ ga4, sessionsTrend, trendGranularity, periodLabel, trendCompareLabel }: Props) {
  if (!ga4) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-8 text-center">
          <p className="text-sm text-surface-500 italic">No GA4 data available. Configure a GA4 Property ID in client settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl space-y-8">
      {/* KPI Row */}
      <div>
        <SectionHeader title="Website Performance" period={ga4.compareLabel} />
        <WebsiteKpiRow ga4={ga4} compareLabel={ga4.compareLabel} />
      </div>

      {/* Channel chart + Source/Medium table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChannelBarChart channels={ga4.topChannels} />
        <SourceMediumTable rows={ga4.topSourceMediums} />
      </div>

      {/* Period-aware sessions trend */}
      {sessionsTrend.length >= 2 && (
        <MonthlySessionsChart
          data={sessionsTrend}
          granularity={trendGranularity}
          periodLabel={periodLabel}
          compareLabel={trendCompareLabel}
        />
      )}
    </div>
  )
}
