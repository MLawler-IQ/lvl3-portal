'use server'

// Workstream A1 — GA4 data for the upgraded dashboard.
//
// Each action resolves the currently-selected client's ga4_property_id (cookie
// for admin/member, pinned client_id for client-role users), guards with
// requireAuth, and returns a typed result. When no property id is configured we
// return a typed "not configured" / empty payload instead of throwing, so the UI
// can render a graceful empty state.

import { requireAuth } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { buildDateRange } from '@/lib/date-range'
import type { TrendPoint } from '@/lib/dashboard/types'
import {
  fetchGA4Trend,
  fetchGA4Report,
  fetchGA4EcomFunnel,
  fetchGA4TopProducts,
  type ChannelRow,
  type GA4EcomFunnel,
  type GA4TopProduct,
} from '@/lib/google-analytics'

export type { TrendPoint, ChannelRow, GA4EcomFunnel, GA4TopProduct }

type Opts = { period?: string; compare?: string }

/**
 * Resolve the selected client's GA4 property id for the current user.
 * Returns `{ propertyId: null }` (no throw) when the client is missing or has no
 * ga4_property_id configured, so callers can short-circuit to an empty result.
 */
async function resolveGA4PropertyId(): Promise<{ propertyId: string | null }> {
  const { user } = await requireAuth()
  const clientId = await resolveSelectedClientId(user)
  if (!clientId) return { propertyId: null }
  const client = await getClientById<{ id: string; name: string; ga4_property_id: string | null }>(
    clientId,
    'id, name, ga4_property_id',
  )
  return { propertyId: client?.ga4_property_id ?? null }
}

// ── 1. Period-aware traffic trend ─────────────────────────────────────────────

export type GA4TrendResult = {
  configured: boolean
  points: TrendPoint[]
  error?: string
}

export async function getGA4TrendData(opts?: Opts): Promise<GA4TrendResult> {
  try {
    const { propertyId } = await resolveGA4PropertyId()
    if (!propertyId) return { configured: false, points: [] }
    const points = await fetchGA4Trend(propertyId, opts?.period ?? '28d', opts?.compare ?? 'prior')
    return { configured: true, points }
  } catch (err) {
    return { configured: true, points: [], error: err instanceof Error ? err.message : 'Failed to load GA4 trend' }
  }
}

// ── 2. Revenue by channel ─────────────────────────────────────────────────────

export type GA4ChannelsResult = {
  configured: boolean
  channels: ChannelRow[]
  error?: string
}

export async function getGA4ChannelsData(opts?: Opts): Promise<GA4ChannelsResult> {
  try {
    const { propertyId } = await resolveGA4PropertyId()
    if (!propertyId) return { configured: false, channels: [] }
    const range = buildDateRange(opts?.period, opts?.compare)
    const report = await fetchGA4Report(propertyId, range)
    return { configured: true, channels: report.topChannels }
  } catch (err) {
    return { configured: true, channels: [], error: err instanceof Error ? err.message : 'Failed to load GA4 channels' }
  }
}

// ── 3. Ecommerce funnel ───────────────────────────────────────────────────────

export type GA4EcomFunnelResult = {
  configured: boolean
  funnel: GA4EcomFunnel | null
  error?: string
}

export async function getGA4EcomFunnelData(opts?: Opts): Promise<GA4EcomFunnelResult> {
  try {
    const { propertyId } = await resolveGA4PropertyId()
    if (!propertyId) return { configured: false, funnel: null }
    const range = buildDateRange(opts?.period, opts?.compare)
    const funnel = await fetchGA4EcomFunnel(propertyId, range)
    return { configured: true, funnel }
  } catch (err) {
    return { configured: true, funnel: null, error: err instanceof Error ? err.message : 'Failed to load GA4 funnel' }
  }
}

// ── 4. Top products ───────────────────────────────────────────────────────────

export type GA4TopProductsResult = {
  configured: boolean
  products: GA4TopProduct[]
  error?: string
}

export async function getGA4TopProductsData(opts?: Opts): Promise<GA4TopProductsResult> {
  try {
    const { propertyId } = await resolveGA4PropertyId()
    if (!propertyId) return { configured: false, products: [] }
    const range = buildDateRange(opts?.period, opts?.compare)
    const products = await fetchGA4TopProducts(propertyId, range)
    return { configured: true, products }
  } catch (err) {
    return { configured: true, products: [], error: err instanceof Error ? err.message : 'Failed to load GA4 products' }
  }
}
