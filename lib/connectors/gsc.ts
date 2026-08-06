// The single Search Console query primitive.
//
// Before this, `google.searchconsole({version:'v1', auth}).searchanalytics.query`
// was constructed in four places:
//
//   1. lib/tools-gsc.ts          — cached, rows as {query, page, ...}, ctr * 100
//   2. lib/ask-tools.ts          — uncached, rows as {keys, ...}, ctr rounded to 2dp
//   3. lib/ask-lvl3/tools/gsc.ts — uncached, inline in the tool handler, same shape as (2)
//   4. lib/google-search-console.ts — the dashboard's composite batches
//
// They disagreed on details that silently change numbers: CTR arrives from
// Google as a 0–1 fraction, and one path multiplied by 100 while two rounded to
// two decimals. So the same underlying figure could surface as 4.2 or 4.1857
// depending on which path a caller happened to use.
//
// This module owns the mechanics — auth, request shape, caching, raw row mapping
// — and nothing else. Each caller keeps its own presentation shape, so no
// existing output changes. That is deliberate: the dashboard reads these numbers
// in production and a "cleanup" that shifted a CTR would be worse than the
// duplication.
//
// Scope note: (1), (2) and (3) now delegate here. (4) does not — it issues six
// bespoke queries in one Promise.allSettled batch with its own cache keys, and
// rewriting that carries live-dashboard risk out of proportion to the benefit.
// It is left alone, with a pointer to this module.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { getAdminOAuthClient } from '@/lib/google-auth'
import { cachedFetch } from '@/lib/api-cache'
import { connectorErr, connectorOk, type ConnectorResult } from './types'

/** GSC data lags 2–3 days, so a 6h cache is safe. Matches the previous value. */
export const GSC_TTL_SECONDS = 6 * 3600

/**
 * A row exactly as Google returns it — `ctr` is the raw 0–1 fraction and
 * `position` is unrounded. Presentation (scaling, rounding, naming the
 * dimensions) belongs to the caller.
 */
export interface GscRawRow {
  keys: string[]
  clicks: number
  impressions: number
  /** Raw fraction, 0–1. NOT a percentage. */
  ctr: number
  position: number
}

export interface GscQueryParams {
  siteUrl: string
  startDate: string
  endDate: string
  dimensions?: string[]
  rowLimit?: number
  /**
   * Pre-resolved auth. Supply it when the caller already has one (a tool
   * context, the ask-lvl3 loop) so a batch of tools doesn't re-mint a client per
   * call. Omit and it resolves the admin client itself.
   */
  auth?: OAuth2Client
  /** Cache key suffix. Omit to skip caching entirely. */
  cacheKey?: string
  ttlSeconds?: number
}

async function runQuery(params: GscQueryParams): Promise<GscRawRow[]> {
  const auth = params.auth ?? (await getAdminOAuthClient())
  const searchconsole = google.searchconsole({ version: 'v1', auth })

  const { data } = await searchconsole.searchanalytics.query({
    siteUrl: params.siteUrl,
    requestBody: {
      startDate: params.startDate,
      endDate: params.endDate,
      ...(params.dimensions ? { dimensions: params.dimensions } : {}),
      rowLimit: params.rowLimit ?? 1000,
    },
  })

  return (data.rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }))
}

/** Query GSC. Returns an envelope; never throws for an API failure. */
export async function queryGsc(params: GscQueryParams): Promise<ConnectorResult<GscRawRow[]>> {
  try {
    const rows = params.cacheKey
      ? await cachedFetch(params.cacheKey, params.ttlSeconds ?? GSC_TTL_SECONDS, () =>
          runQuery(params),
        )
      : await runQuery(params)
    return connectorOk(rows)
  } catch (err) {
    return connectorErr(err)
  }
}

/**
 * Query GSC, throwing on failure.
 *
 * For the existing callers that return bare arrays and have their own error
 * handling further up. New code should prefer `queryGsc`.
 */
export async function queryGscOrThrow(params: GscQueryParams): Promise<GscRawRow[]> {
  const result = await queryGsc(params)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** Yesterday, and N days before it — the window every tool path used. */
export function trailingWindow(days: number): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const now = Date.now()
  return {
    endDate: fmt(new Date(now - 86400000)),
    startDate: fmt(new Date(now - days * 86400000)),
  }
}

/** ctr as a percentage to 2dp — the ask-tools / ask-lvl3 convention. */
export function ctrPercent2dp(rawCtr: number): number {
  return Math.round(rawCtr * 10000) / 100
}

/** position to 1dp — the ask-tools / ask-lvl3 convention. */
export function position1dp(rawPosition: number): number {
  return Math.round(rawPosition * 10) / 10
}
