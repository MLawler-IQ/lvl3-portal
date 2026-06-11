import KpiCard from '@/components/ui/KpiCard'
import type { GA4Metrics, GSCMetrics } from '@/app/actions/analytics'

interface AnalyticsKpiStripProps {
  ga4: GA4Metrics | null
  gsc: GSCMetrics | null
  compact?: boolean
}

function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function deltaDir(pct: number): 'up' | 'down' | 'flat' {
  if (pct > 0) return 'up'
  if (pct < 0) return 'down'
  return 'flat'
}

export default function AnalyticsKpiStrip({
  ga4,
  gsc,
  compact = false,
}: AnalyticsKpiStripProps) {
  if (!ga4 && !gsc) return null

  if (compact) {
    // Window copy must match the caller's fetch window. The compact strip's only
    // render site (Home) uses fetchAnalyticsData's default range: the last 28
    // days ending yesterday vs the prior 28 days, for both GA4 and GSC.
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ga4 && (
          <KpiCard
            label="Sessions"
            value={fmtNum(ga4.sessions)}
            delta={
              ga4.sessionsDelta !== 0
                ? {
                    direction: deltaDir(ga4.sessionsDelta),
                    percent: `${Math.abs(ga4.sessionsDelta)}%`,
                  }
                : undefined
            }
            tooltip="Website sessions in the last 28 days vs the prior 28 days (GA4)"
          />
        )}
        {gsc && (
          <KpiCard
            label="Organic Clicks"
            value={fmtNum(gsc.clicks)}
            tooltip="Organic search clicks in the last 28 days (Search Console)"
          />
        )}
        {gsc && (
          <KpiCard
            label="Avg. Position"
            value={gsc.position.toFixed(1)}
            tooltip="Average search ranking position over the last 28 days (Search Console)"
          />
        )}
      </div>
    )
  }

  // Full variant: callers may feed any period, so tooltips name the metric and
  // source without claiming a window.
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {ga4 && (
        <>
          <KpiCard
            label="Sessions"
            value={fmtNum(ga4.sessions)}
            delta={{
              direction: deltaDir(ga4.sessionsDelta),
              percent: `${Math.abs(ga4.sessionsDelta)}%`,
            }}
            tooltip="Website sessions vs the comparison period (GA4)"
          />
          <KpiCard
            label="Users"
            value={fmtNum(ga4.users)}
            delta={{
              direction: deltaDir(ga4.usersDelta),
              percent: `${Math.abs(ga4.usersDelta)}%`,
            }}
            tooltip="Total users vs the comparison period (GA4)"
          />
          <KpiCard
            label="Pageviews"
            value={fmtNum(ga4.pageviews)}
            delta={{
              direction: deltaDir(ga4.pageviewsDelta),
              percent: `${Math.abs(ga4.pageviewsDelta)}%`,
            }}
            tooltip="Page views vs the comparison period (GA4)"
          />
          <KpiCard
            label="Bounce Rate"
            value={`${(ga4.bounceRate * 100).toFixed(1)}%`}
            tooltip="Share of sessions that left without engaging (GA4)"
          />
        </>
      )}
      {gsc && (
        <>
          <KpiCard
            label="Organic Clicks"
            value={fmtNum(gsc.clicks)}
            tooltip="Clicks from unpaid Google search results (Search Console)"
          />
          <KpiCard
            label="Impressions"
            value={fmtNum(gsc.impressions)}
            tooltip="How often the site appeared in search results (Search Console)"
          />
          <KpiCard
            label="CTR"
            value={`${gsc.ctr.toFixed(1)}%`}
            tooltip="Share of search impressions that became clicks (Search Console)"
          />
          <KpiCard
            label="Avg. Position"
            value={gsc.position.toFixed(1)}
            tooltip="Average search ranking position (Search Console)"
          />
        </>
      )}
    </div>
  )
}
