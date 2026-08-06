import type { SheetRow } from '@/app/actions/projects'
import { STATUS_TONE, type StatusTone } from '@/lib/status-tone'

// ── Types ────────────────────────────────────────────────────────────────────

export type MonthGroup = { month: string; rows: SheetRow[] }
export type CategoryGroup = { category: string; rows: SheetRow[] }

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Project status → tone. The only place in the app still using the `green-*` and
 * `red-*` families, and the only user of the `bg-{c}-900/40` chip idiom.
 */
export const PROJECT_STATUS_TONE = {
  'Completed': 'success',
  'In Progress': 'accent',
  'Not Started': 'neutral',
  'Blocked': 'error',
} as const satisfies Record<string, StatusTone>

export const STATUS_STYLES: Record<string, string> = {
  'Completed': `border ${STATUS_TONE.success.chip}`,
  'In Progress': `border ${STATUS_TONE.accent.chip}`,
  'Not Started': `border ${STATUS_TONE.neutral.chip}`,
  'Blocked': `border ${STATUS_TONE.error.chip}`,
}

export const SEGMENT_DEFS = [
  { status: 'Completed', color: STATUS_TONE.success.bar, label: 'Done' },
  { status: 'In Progress', color: STATUS_TONE.accent.bar, label: 'Active' },
  { status: 'Blocked', color: STATUS_TONE.error.bar, label: 'Blocked' },
  { status: 'Not Started', color: STATUS_TONE.neutral.bar, label: 'Todo' },
] as const

// ── Pure Functions ───────────────────────────────────────────────────────────

export function getStatusStyle(status: string): string {
  return STATUS_STYLES[status] ?? `border ${STATUS_TONE.neutral.chip}`
}

export function formatFee(fee: number | null): string {
  if (fee === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(fee)
}

export function getMinutesSince(isoString: string): number {
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 60000)
}

export function isCurrentMonth(monthStr: string): boolean {
  const d = new Date(monthStr)
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export function getUniqueValues(rows: SheetRow[], key: keyof SheetRow): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    const v = row[key]
    if (v !== null && v !== '') seen.add(String(v))
  }
  return Array.from(seen)
}

export function applyFilters(rows: SheetRow[], statuses: Set<string>, category: string): SheetRow[] {
  return rows.filter((r) => {
    const statusOk = statuses.size === 0 || statuses.has(r.status)
    const categoryOk = category === '' || r.category === category
    return statusOk && categoryOk
  })
}

export function groupByMonth(rows: SheetRow[]): MonthGroup[] {
  const order: string[] = []
  const map: Record<string, SheetRow[]> = {}
  for (const row of rows) {
    if (!map[row.month]) { map[row.month] = []; order.push(row.month) }
    map[row.month].push(row)
  }
  return order.map((month) => ({ month, rows: map[month] }))
}

export function sortGroups(groups: MonthGroup[]): MonthGroup[] {
  return [...groups].sort((a, b) => {
    const da = new Date(a.month)
    const db = new Date(b.month)
    if (!isNaN(da.getTime()) && !isNaN(db.getTime())) return db.getTime() - da.getTime()
    return 0
  })
}

export function groupByCategory(rows: SheetRow[]): CategoryGroup[] {
  const order: string[] = []
  const map: Record<string, SheetRow[]> = {}
  for (const row of rows) {
    const key = row.category || '(Uncategorized)'
    if (!map[key]) { map[key] = []; order.push(key) }
    map[key].push(row)
  }
  return order.map((category) => ({ category, rows: map[category] }))
}

export function sortRows(rows: SheetRow[], config: { col: string; dir: 'asc' | 'desc' } | null): SheetRow[] {
  if (!config) return rows
  const { col, dir } = config
  const mult = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (col === 'fee') {
      if (a.fee === null && b.fee === null) return 0
      if (a.fee === null) return 1
      if (b.fee === null) return -1
      return (a.fee - b.fee) * mult
    }
    const av = String((a as Record<string, unknown>)[col] ?? '')
    const bv = String((b as Record<string, unknown>)[col] ?? '')
    return av.localeCompare(bv) * mult
  })
}
