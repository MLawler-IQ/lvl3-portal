'use client'

import { useState } from 'react'
import { AlertTriangle, AlertCircle, Info } from 'lucide-react'
import type { AlertSeverity, DashboardAlert } from '@/lib/dashboard/types'
import { STATUS_TONE } from '@/lib/status-tone'

export interface AlertsProps {
  /** Ranked alerts (critical → warning → info), already deduped/capped by the engine. */
  alerts: DashboardAlert[]
}

/** Per-severity tokens, matching the LVL3 dark-theme palette used app-wide. */
const SEVERITY_STYLES: Record<
  AlertSeverity,
  { row: string; icon: React.ElementType; iconColor: string; title: string }
> = {
  critical: {
    row: STATUS_TONE.error.row,
    icon: AlertTriangle,
    iconColor: STATUS_TONE.error.text,
    // Titles were a lighter -300 shade of the same hue, the only place that idiom
    // appeared. surface-100 is higher contrast and keeps the colour on the icon,
    // where §4 wants it.
    title: 'text-surface-100',
  },
  warning: {
    row: STATUS_TONE.warning.row,
    icon: AlertCircle,
    iconColor: STATUS_TONE.warning.text,
    title: 'text-surface-100',
  },
  info: {
    row: STATUS_TONE.neutral.row,
    icon: Info,
    iconColor: STATUS_TONE.accent.text,
    title: 'text-surface-100',
  },
}

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const styles = SEVERITY_STYLES[alert.severity]
  const Icon = styles.icon

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${styles.row}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.iconColor}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className={`text-sm font-semibold leading-snug ${styles.title}`}>{alert.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-surface-400">{alert.detail}</p>
      </div>
    </div>
  )
}

/**
 * Presentational alerts module — ONE compact strip showing the highest-severity
 * alert inline (icon + title + detail, single row when collapsed), with a
 * "+N more" toggle that expands the remaining alerts as full severity-colored
 * rows (critical = rose, warning = amber, info = surface/brand). Expects alerts
 * already ranked and capped by deriveAlerts(). Renders nothing when there are
 * no alerts.
 */
export default function Alerts({ alerts }: AlertsProps) {
  const [expanded, setExpanded] = useState(false)

  if (!alerts || alerts.length === 0) return null

  const [top, ...rest] = alerts
  const styles = SEVERITY_STYLES[top.severity]
  const Icon = styles.icon

  return (
    <section className="space-y-2" aria-label="Alerts">
      <div className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${styles.row}`}>
        <Icon className={`h-4 w-4 shrink-0 ${styles.iconColor}`} aria-hidden="true" />
        <p className={`min-w-0 flex-1 text-sm leading-snug ${expanded ? '' : 'truncate'}`}>
          <span className={`font-semibold ${styles.title}`}>{top.title}</span>
          <span className="text-surface-400"> · {top.detail}</span>
        </p>
        {rest.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Show fewer alerts' : `Show ${rest.length} more alert${rest.length === 1 ? '' : 's'}`}
            className="shrink-0 whitespace-nowrap text-xs font-medium text-surface-400 transition-colors hover:text-surface-100"
          >
            {expanded ? 'Show less' : `+${rest.length} more`}
          </button>
        )}
      </div>
      {expanded &&
        rest.map((alert) => (
          <AlertRow key={alert.id} alert={alert} />
        ))}
    </section>
  )
}
