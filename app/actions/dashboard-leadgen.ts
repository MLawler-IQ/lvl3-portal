'use server'

// Workstream B4 — lead-gen data for the upgraded dashboard.
//
// Lead-gen clients track conversions via GA4 KEY EVENTS (per-client conversion
// event names live in clients.key_event_names) and judge content on GSC clicks.
// Each action resolves the currently-selected client (cookie for admin/member,
// pinned client_id for client-role users), guards with requireAuth, reads the
// client's GA4 property / GSC site / key-event names with the service client, and
// returns a typed envelope. When the prerequisite config is missing we return a
// typed "not configured" / empty payload instead of throwing, so the UI can render
// a graceful empty state.

import { requireAuth } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { buildDateRange } from '@/lib/date-range'
import {
  fetchGA4ConvertingPages,
  type ConvertingPageRow,
} from '@/lib/google-analytics'
import {
  fetchGSCContentPerformance,
  type ContentUrlRow,
} from '@/lib/google-search-console'

export type { ConvertingPageRow, ContentUrlRow }

type Opts = { period?: string; compare?: string }

type LeadGenClient = {
  id: string
  name: string
  ga4_property_id: string | null
  gsc_site_url: string | null
  key_event_names: string[] | null
}

/**
 * Resolve the selected client's lead-gen config for the current user.
 * Returns `null` (no throw) when no client is selected / found, so callers can
 * short-circuit to an empty result.
 */
async function resolveLeadGenClient(): Promise<LeadGenClient | null> {
  const { user } = await requireAuth()
  const clientId = await resolveSelectedClientId(user)
  if (!clientId) return null
  return getClientById<LeadGenClient>(
    clientId,
    'id, name, ga4_property_id, gsc_site_url, key_event_names',
  )
}

// ── 1. Converting landing pages (GA4 key events) ────────────────────────────────

export type ConvertingPagesResult = {
  configured: boolean
  rows: ConvertingPageRow[]
  error?: string
}

export async function getConvertingPagesData(opts?: Opts): Promise<ConvertingPagesResult> {
  try {
    const client = await resolveLeadGenClient()
    const propertyId = client?.ga4_property_id ?? null
    if (!propertyId) return { configured: false, rows: [] }
    const keyEventNames = client?.key_event_names ?? []
    const range = buildDateRange(opts?.period, opts?.compare)
    const rows = await fetchGA4ConvertingPages(propertyId, keyEventNames, range)
    return { configured: true, rows }
  } catch (err) {
    return {
      configured: true,
      rows: [],
      error: err instanceof Error ? err.message : 'Failed to load converting pages',
    }
  }
}

// ── 2. Content performance (GSC clicks) ─────────────────────────────────────────

export type ContentPerformanceResult = {
  configured: boolean
  rows: ContentUrlRow[]
  error?: string
}

export async function getContentPerformanceData(opts?: Opts): Promise<ContentPerformanceResult> {
  try {
    const client = await resolveLeadGenClient()
    const siteUrl = client?.gsc_site_url ?? null
    if (!siteUrl) return { configured: false, rows: [] }
    const range = buildDateRange(opts?.period, opts?.compare)
    const rows = await fetchGSCContentPerformance(siteUrl, range)
    return { configured: true, rows }
  } catch (err) {
    return {
      configured: true,
      rows: [],
      error: err instanceof Error ? err.message : 'Failed to load content performance',
    }
  }
}
