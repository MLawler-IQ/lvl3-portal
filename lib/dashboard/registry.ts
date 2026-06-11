// Dashboard module registry — single source of truth for which modules each
// client type sees, and how to infer a client's type from connected data.
//
// FROZEN once Phase A starts (feature workstreams import, never edit). New
// module entries are appended here in a later foundation step.

import type { ClientType, DashboardModuleId, ModuleDef } from './types'

export const ALL_CLIENT_TYPES: ClientType[] = [
  'local_service',
  'multi_location',
  'ecommerce',
  'lead_gen',
]

// Insertion order defines the default render order on the dashboard.
export const MODULES: Record<DashboardModuleId, ModuleDef> = {
  // ── Phase A ──
  exec_summary: { id: 'exec_summary', title: 'Executive Summary', defaultFor: [], core: true, phase: 'A' },
  traffic_trend: { id: 'traffic_trend', title: 'Traffic Trend', defaultFor: [], core: true, requires: ['ga4'], phase: 'A' },
  channels: { id: 'channels', title: 'Channels', defaultFor: [], core: true, requires: ['ga4'], phase: 'A' },
  top_pages: { id: 'top_pages', title: 'Top Pages', defaultFor: [], core: true, requires: ['ga4', 'gsc'], phase: 'A' },
  search_queries: { id: 'search_queries', title: 'Search Queries', defaultFor: [], core: true, requires: ['gsc'], phase: 'A' },
  gbp_overview: { id: 'gbp_overview', title: 'Google Business Profile', defaultFor: ['local_service', 'multi_location'], requires: ['gbp'], phase: 'A' },

  // ── Phase B ──
  location_leaderboard: { id: 'location_leaderboard', title: 'Location Leaderboard', defaultFor: ['multi_location'], requires: ['gbp'], phase: 'B' },
  location_completeness: { id: 'location_completeness', title: 'Profile Completeness', defaultFor: ['multi_location'], requires: ['gbp'], phase: 'B' },
  ecom_funnel: { id: 'ecom_funnel', title: 'Shopping Funnel', defaultFor: ['ecommerce'], requires: ['ga4'], phase: 'B' },
  top_products: { id: 'top_products', title: 'Top Products', defaultFor: ['ecommerce'], requires: ['ga4'], phase: 'B' },
  converting_pages: { id: 'converting_pages', title: 'Converting Pages', defaultFor: ['lead_gen'], requires: ['ga4'], phase: 'B' },
  content_performance: { id: 'content_performance', title: 'Content Performance', defaultFor: ['lead_gen'], requires: ['ga4', 'gsc'], phase: 'B' },
  branded_split: { id: 'branded_split', title: 'Branded vs Non-Branded', defaultFor: ['local_service', 'multi_location', 'ecommerce', 'lead_gen'], requires: ['gsc'], phase: 'B' },
  insight_cards: { id: 'insight_cards', title: 'Key Insights', defaultFor: [], core: true, phase: 'B' },
  competitive: { id: 'competitive', title: 'Competitive Landscape', defaultFor: [], requires: ['semrush'], phase: 'B' },

  // ── Phase C ──
  targets: { id: 'targets', title: 'Goals & Pacing', defaultFor: [], phase: 'C' },
  alerts: { id: 'alerts', title: 'Alerts', defaultFor: [], core: true, phase: 'C' },
  metric_table: { id: 'metric_table', title: '13-Month Detail', defaultFor: [], phase: 'C' },
  annotations: { id: 'annotations', title: 'Annotations', defaultFor: [], phase: 'C' },
}

/**
 * Ordered module ids a client of the given type sees by default.
 * `null` type → generic dashboard (core modules only).
 */
export function defaultModulesForType(type: ClientType | null): DashboardModuleId[] {
  return (Object.values(MODULES) as ModuleDef[])
    .filter((m) => m.core || (type != null && m.defaultFor.includes(type)))
    .map((m) => m.id)
}

// ── Client-type inference ─────────────────────────────────────────────────────

export interface InferenceSignals {
  /** Number of GBP locations mapped to the client. */
  gbpLocationCount?: number
  /** GA4 purchaseRevenue over the window. */
  purchaseRevenue?: number
  /** GA4 transactions over the window. */
  transactions?: number
}

/**
 * Heuristic best-guess client type from connected-data signals. Used to
 * pre-fill the settings selector — an admin always confirms.
 */
export function inferClientType(signals: InferenceSignals): ClientType {
  const { gbpLocationCount = 0, purchaseRevenue = 0, transactions = 0 } = signals
  if (purchaseRevenue > 0 || transactions > 0) return 'ecommerce'
  if (gbpLocationCount > 5) return 'multi_location'
  if (gbpLocationCount >= 1) return 'local_service'
  return 'lead_gen'
}
