import type { GA4Report } from '@/lib/google-analytics'
import type { GSCReport } from '@/lib/google-search-console'
import type { Granularity } from '@/lib/dashboard/types'
import SectionHeader from '@/components/analytics/shared/SectionHeader'
import OrganicKpiRow from './organic/OrganicKpiRow'
import DeviceDonutChart from './organic/DeviceDonutChart'
import OrganicLandingPagesTable from './organic/OrganicLandingPagesTable'
import GscKpiRow from './searchconsole/GscKpiRow'
import GscTrendChart from './searchconsole/GscTrendChart'
import GscQueriesTable from './searchconsole/GscQueriesTable'
import GscUrlsTable from './searchconsole/GscUrlsTable'
import SerpDistributionChart from './searchconsole/SerpDistributionChart'

interface Props {
  ga4: GA4Report | null
  gsc: GSCReport | null
  gscError?: string
  isAdmin: boolean
  /** Bucket size of the GSC trend (matches the selected period). */
  trendGranularity: Granularity
  /** The selected window, e.g. "Last 28 days". */
  periodLabel: string
}

export default function SeoTab({ ga4, gsc, gscError, isAdmin, trendGranularity, periodLabel }: Props) {
  if (!ga4 && !gsc) {
    return (
      <div className="p-6 space-y-3">
        <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-8 text-center">
          <p className="text-sm text-surface-500 italic">No SEO data available. Configure GA4 and/or GSC in client settings.</p>
        </div>
        {isAdmin && gscError && (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 px-5 py-3">
            <p className="text-xs font-medium text-rose-400 mb-1">Admin — GSC error</p>
            <p className="text-xs text-rose-300/80 font-mono break-all">{gscError}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl space-y-10">
      {/* Organic Search (GA4) section */}
      {ga4 && (
        <div className="space-y-5">
          <SectionHeader title="Organic Search (GA4)" period={ga4.compareLabel} />
          <OrganicKpiRow ga4={ga4} compareLabel={ga4.compareLabel} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <DeviceDonutChart
              mobile={ga4.deviceBreakdown.mobile}
              desktop={ga4.deviceBreakdown.desktop}
              tablet={ga4.deviceBreakdown.tablet}
            />
            <OrganicLandingPagesTable rows={ga4.organicLandingPages} />
          </div>
        </div>
      )}

      {/* Search Console section */}
      {gsc ? (
        <div className="space-y-5">
          <SectionHeader title="Search Console" period={gsc.compareLabel} />
          <GscKpiRow gsc={gsc} compareLabel={gsc.compareLabel} />
          <SerpDistributionChart distribution={gsc.serpDistribution} />
          {gsc.trend.length > 0 && (
            <GscTrendChart data={gsc.trend} granularity={trendGranularity} periodLabel={periodLabel} />
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GscQueriesTable rows={gsc.topQueries} />
            <GscUrlsTable rows={gsc.topUrls} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <SectionHeader title="Search Console" />
          <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-4">
            <p className="text-sm text-surface-500 italic">
              {gscError && !isAdmin
                ? 'Search Console data is unavailable. Contact your admin.'
                : 'Configure a GSC Site URL in client settings to see Search Console data.'}
            </p>
          </div>
          {isAdmin && gscError && (
            <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 px-5 py-3">
              <p className="text-xs font-medium text-rose-400 mb-1">Admin — GSC error</p>
              <p className="text-xs text-rose-300/80 font-mono break-all">{gscError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
