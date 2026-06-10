/**
 * Single source of truth for semantic status colors, mapped to the
 * design-system CSS variables (light-canvas tuned). Use instead of hardcoded
 * Tailwind classes (text-green-400 / #34D399 / #FBBF24 / #F87171) so status
 * colors stay consistent and theme-aware.
 *
 * Usage: <span style={{ color: statusColor(scoreLevel(score)) }}>…</span>
 */
export type StatusLevel = 'success' | 'warning' | 'error' | 'neutral'

export function statusColor(level: StatusLevel): string {
  switch (level) {
    case 'success':
      return 'var(--color-success)'
    case 'warning':
      return 'var(--color-warning)'
    case 'error':
      return 'var(--color-error)'
    default:
      return 'var(--color-muted)'
  }
}

/** Map a 0–100 score to a status level: ≥80 good, ≥60 fair, else poor. */
export function scoreLevel(score: number): StatusLevel {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'error'
}

/** Translucent tint of a status token for badge/pill fills and borders. */
export function statusTint(level: StatusLevel, pct = 10): string {
  return `color-mix(in srgb, ${statusColor(level)} ${pct}%, transparent)`
}
