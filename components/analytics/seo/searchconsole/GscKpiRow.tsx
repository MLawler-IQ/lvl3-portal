import KpiCard from '@/components/ui/KpiCard'
import type { GSCReport } from '@/lib/google-search-console'

function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function dir(pct: number): 'up' | 'down' | 'flat' {
  if (pct > 0) return 'up'
  if (pct < 0) return 'down'
  return 'flat'
}

interface Props {
  gsc: GSCReport
  compareLabel: string
}

export default function GscKpiRow({ gsc, compareLabel }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <KpiCard
        label="Clicks"
        value={fmtNum(gsc.clicks)}
        delta={{ direction: dir(gsc.clicksDelta), percent: `${Math.abs(gsc.clicksDelta)}%` }}
        tooltip={`Organic search clicks ${compareLabel} (Search Console)`}
      />
      <KpiCard
        label="Impressions"
        value={fmtNum(gsc.impressions)}
        delta={{ direction: dir(gsc.impressionsDelta), percent: `${Math.abs(gsc.impressionsDelta)}%` }}
        tooltip={`Search impressions ${compareLabel} (Search Console)`}
      />
      <KpiCard
        label="Avg. Position"
        value={gsc.position.toFixed(1)}
        delta={{
          // positionDelta is the raw signed movement of the position number
          // (lib/google-search-console.ts pct()) — direction follows the number,
          // goodDirection inverts the color since a LOWER position is better.
          direction: dir(gsc.positionDelta),
          percent: `${Math.abs(gsc.positionDelta)}%`,
          goodDirection: 'down',
          wording: { up: 'Worsened', down: 'Improved' },
        }}
        tooltip={`Average search ranking position ${compareLabel} (Search Console)`}
      />
    </div>
  )
}
