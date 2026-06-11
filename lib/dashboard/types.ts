// Shared dashboard contracts (Phase A–C foundation).
//
// This module is FROZEN once Phase A starts: parallel feature workstreams
// import from here but must not edit it. New module ids / client types are
// appended in a later foundation step, never reshaped.

import type { Granularity } from '@/lib/date-range'

export type { Granularity }

// ── Client typing ─────────────────────────────────────────────────────────────

export type ClientType = 'local_service' | 'multi_location' | 'ecommerce' | 'lead_gen'

export const CLIENT_TYPES: ClientType[] = [
  'local_service',
  'multi_location',
  'ecommerce',
  'lead_gen',
]

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  local_service: 'Local Service',
  multi_location: 'Multi-Location',
  ecommerce: 'E-commerce',
  lead_gen: 'Lead Gen',
}

export type DataSource = 'ga4' | 'gsc' | 'gbp' | 'semrush'

// ── Dashboard modules ───────────────────────────────────────────────────────
// Union of every module id across phases A–C. New modules append to the union
// and to MODULES in registry.ts.

export type DashboardModuleId =
  // Phase A
  | 'exec_summary'
  | 'traffic_trend'
  | 'channels'
  | 'top_pages'
  | 'search_queries'
  | 'gbp_overview'
  // Phase B
  | 'location_leaderboard'
  | 'location_completeness'
  | 'ecom_funnel'
  | 'top_products'
  | 'converting_pages'
  | 'content_performance'
  | 'branded_split'
  | 'insight_cards'
  | 'competitive'
  // Phase C
  | 'targets'
  | 'alerts'
  | 'metric_table'
  | 'annotations'

export interface ModuleDef {
  id: DashboardModuleId
  title: string
  /** Client types that show this module by default. */
  defaultFor: ClientType[]
  /** Shown for every client type (generic core), regardless of defaultFor. */
  core?: boolean
  /** Data sources this module needs — used for graceful degradation / docs. */
  requires?: DataSource[]
  /** Phase the module is introduced in, for staged rollout. */
  phase: 'A' | 'B' | 'C'
}

// ── Trends ────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  /** YYYY-MM-DD (daily/weekly bucket start) or YYYY-MM (monthly). */
  date: string
  value: number
  /** Aligned comparison-period value for the ghost-overlay series, if known. */
  compareValue?: number
}

// ── Structured insights ─────────────────────────────────────────────────────
// Layers on top of the existing string-based SnapshotInsights in
// app/actions/analytics.ts (it does NOT replace it). The Phase-B insight
// engine produces these; the exec band + insight-cards module consume them.

export type InsightDirection = 'up' | 'down' | 'flat'
export type InsightSeverity = 'positive' | 'neutral' | 'warning' | 'critical'

export interface InsightCard {
  metric: string // human label, e.g. "Organic clicks"
  direction: InsightDirection
  magnitude: string // e.g. "+18%" or "−312"
  period: string // e.g. "vs prior 28 days"
  statement: string // one-sentence what-happened
  whyItMatters: string // business implication
  severity: InsightSeverity
  chartRef?: DashboardModuleId // deep-link target module
}

export interface StructuredInsights {
  headline?: string
  cards?: InsightCard[]
  generatedAt?: string
}
