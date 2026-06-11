import { ClipboardCheck, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { gbpLocationLabel, hasDuplicateTitles } from '@/lib/dashboard/gbp-labels'
import type { DashboardGBPData, GBPAccountAudit } from '@/app/actions/dashboard-gbp'

// ── Score → grade colors (matches HealthScorecard token usage) ───────────────

type ScoreTone = 'good' | 'warn' | 'bad'

function scoreTone(score: number): ScoreTone {
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

const TONE_STYLES: Record<ScoreTone, { text: string; bar: string; chip: string }> = {
  good: {
    text: 'text-accent-400',
    bar: 'bg-accent-400',
    chip: 'text-accent-400 border-accent-400/40 bg-accent-400/10',
  },
  warn: {
    text: 'text-amber-400',
    bar: 'bg-amber-400',
    chip: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
  },
  bad: {
    text: 'text-rose-400',
    bar: 'bg-rose-400',
    chip: 'text-rose-400 border-rose-400/40 bg-rose-400/10',
  },
}

// Distribution buckets, ordered best → worst.
const BUCKETS: { label: string; tone: ScoreTone; test: (s: number) => boolean }[] = [
  { label: 'Excellent (80–100)', tone: 'good', test: (s) => s >= 80 },
  { label: 'Needs work (60–79)', tone: 'warn', test: (s) => s >= 60 && s < 80 },
  { label: 'At risk (0–59)', tone: 'bad', test: (s) => s < 60 },
]

const MAX_ISSUES = 5
const MAX_ATTENTION = 5

// ── Public props ────────────────────────────────────────────────────────────

export interface LocationCompletenessProps {
  /** Full dashboard payload; component reads `audit`. Pass null while loading/unconfigured. */
  data: DashboardGBPData | null
  /** Max number of top issues to list. Default 5. */
  maxIssues?: number
  /** Max number of lowest-scoring locations to surface. Default 5. */
  maxAttention?: number
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-surface-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-surface-100">Profile Completeness</p>
      </div>
      {children}
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const tone = TONE_STYLES[scoreTone(score)]
  return (
    <div
      className={`inline-flex items-baseline gap-1 rounded-lg border px-3 py-1.5 ${tone.chip}`}
      style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
    >
      <span className="text-2xl font-bold leading-none">{score}</span>
      <span className="text-xs opacity-70">/100</span>
    </div>
  )
}

export default function LocationCompleteness({
  data,
  maxIssues = MAX_ISSUES,
  maxAttention = MAX_ATTENTION,
}: LocationCompletenessProps) {
  const audit: GBPAccountAudit | undefined = data?.audit

  // Unconfigured / error / empty states -----------------------------------------
  if (!data || !data.configured) {
    return (
      <Shell>
        <EmptyState
          icon={ClipboardCheck}
          title="Google Business Profile not connected"
          description="Connect a GBP account for this client to audit profile completeness."
          compact
        />
      </Shell>
    )
  }

  if (data.auditError || !audit) {
    return (
      <Shell>
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the completeness audit"
          description={data.auditError ?? 'GBP profile data is unavailable right now.'}
          compact
        />
      </Shell>
    )
  }

  if (audit.locationCount === 0) {
    return (
      <Shell>
        <EmptyState
          icon={ClipboardCheck}
          title="No locations to audit"
          description="This GBP account has no locations."
          compact
        />
      </Shell>
    )
  }

  // Distribution counts across all audited locations.
  const distribution = BUCKETS.map((bucket) => ({
    ...bucket,
    count: audit.locations.filter((l) => bucket.test(l.score)).length,
  }))

  // Top issues by frequency (issue text -> # of locations affected).
  const topIssues = Array.from(Object.entries(audit.issueCounts))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxIssues)

  // Lowest-scoring locations needing attention. `audit.locations` is already
  // sorted score-ascending (worst first); only surface those below perfect.
  const attention = audit.locations.filter((l) => l.score < 100).slice(0, maxAttention)
  // Chain brands share one title — label by city so rows are tellable apart.
  const preferCity = hasDuplicateTitles(audit.locations.map((l) => l.title))

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-surface-500" aria-hidden="true" />
          <p className="text-sm font-semibold text-surface-100">Profile Completeness</p>
        </div>
        <span className="text-xs text-surface-500">
          {audit.locationCount} location{audit.locationCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Average score + distribution -------------------------------------- */}
      <div className="mb-5 flex items-start gap-5">
        <div className="shrink-0">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-surface-500">
            Avg score
          </p>
          <ScoreBadge score={audit.avgScore} />
        </div>

        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          {distribution.map((b) => {
            const pct = audit.locationCount > 0 ? (b.count / audit.locationCount) * 100 : 0
            const tone = TONE_STYLES[b.tone]
            return (
              <div key={b.label} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-surface-400">{b.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-800">
                  <div
                    className={`h-full rounded-full ${tone.bar}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  className="w-6 shrink-0 text-right text-xs text-surface-300"
                  style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                >
                  {b.count}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top issues -------------------------------------------------------- */}
      <div className="mb-5">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-surface-500">
          Top issues
        </p>
        {topIssues.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-accent-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            No completeness issues across any location.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {topIssues.map(([issue, count]) => (
              <li key={issue} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm text-surface-200">
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-amber-400"
                    aria-hidden="true"
                  />
                  <span className="truncate" title={issue}>
                    {issue}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-surface-500">
                  {count} location{count === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Locations needing attention --------------------------------------- */}
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-surface-500">
          Needs attention
        </p>
        {attention.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-accent-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Every location scores 100. Profiles are complete.
          </div>
        ) : (
          <ul className="space-y-2">
            {attention.map((loc) => {
              const tone = TONE_STYLES[scoreTone(loc.score)]
              const label = gbpLocationLabel(
                loc.title || loc.name,
                loc.address?.locality,
                loc.address?.administrativeArea,
                preferCity,
              )
              return (
                <li
                  key={loc.name}
                  className="flex items-start justify-between gap-3 border-b border-surface-700/50 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-surface-200" title={loc.addressFormatted || loc.title}>
                      {label}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-surface-500" title={loc.issues.join(', ')}>
                      {loc.issues.length > 0
                        ? loc.issues.join(' · ')
                        : 'No issues'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold ${tone.chip}`}
                    style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                    aria-label={`Score ${loc.score}`}
                  >
                    {loc.score}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
