import { AlertTriangle, AlertCircle, Info } from 'lucide-react'
import type { AlertSeverity, DashboardAlert } from '@/lib/dashboard/types'

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
    row: 'bg-rose-500/10 border-rose-500/30',
    icon: AlertTriangle,
    iconColor: 'text-rose-400',
    title: 'text-rose-300',
  },
  warning: {
    row: 'bg-amber-500/10 border-amber-500/30',
    icon: AlertCircle,
    iconColor: 'text-amber-400',
    title: 'text-amber-300',
  },
  info: {
    row: 'bg-surface-800/60 border-surface-700',
    icon: Info,
    iconColor: 'text-brand-400',
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
 * Presentational alerts module — a compact, stacked banner list of the things
 * needing attention this period, each severity-colored (critical = rose,
 * warning = amber, info = surface/brand) with a lucide icon, title, and detail.
 * Expects alerts already ranked and capped by deriveAlerts(). Renders nothing
 * when there are no alerts.
 */
export default function Alerts({ alerts }: AlertsProps) {
  if (!alerts || alerts.length === 0) return null

  return (
    <section className="space-y-2" aria-label="Alerts">
      {alerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} />
      ))}
    </section>
  )
}
