// AI Visibility / branded-share check, as a callable tool.
//
// Extracted from app/actions/tools.ts `checkAIVisibility`. Classification logic is
// carried over unchanged, including the deliberate asymmetry documented there:
// configured brand terms use substring (or whole-query, in 'exact' mode) matching to
// mirror the dashboard's Branded Search module, while the heuristic fallback uses a
// word-boundary match so a brand term like "shoe" cannot match "shoelace".

import { fetchGSCRows } from '@/lib/tools-gsc'
import { normalizeDomain } from '@/lib/normalize-domain'
import { toolOk, toolErr, runGuarded, type CallableTool, type ToolContext } from '../contract'
import { missingRequirement } from '../context'

export interface AIVisibilityResult {
  domain: string
  brandedClicks: number
  brandedImpressions: number
  totalClicks: number
  totalImpressions: number
  brandedClickShare: number
  brandedImpressionShare: number
  topBrandedQueries: { query: string; clicks: number; impressions: number; position: number }[]
  topNonBrandedQueries: { query: string; clicks: number; impressions: number; position: number }[]
  periodDays: number
  brandTerms: string[]
  termsSource: 'configured' | 'heuristic'
}

export interface AIVisibilityInput {
  days?: number
}

/**
 * The registrable brand label, subdomain-safe.
 *
 * shop.brand.com → "brand", brand.co.uk → "brand". Exported because it is the kind
 * of string handling that deserves a test of its own.
 */
export function brandTokenFromSite(siteUrl: string): string {
  const labels = normalizeDomain(siteUrl).split('.').filter(Boolean)
  if (labels.length <= 2) return labels[0] ?? ''
  const MULTI_PART_TLD = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'])
  const secondToLast = labels[labels.length - 2]
  return MULTI_PART_TLD.has(secondToLast) ? (labels[labels.length - 3] ?? '') : secondToLast
}

export function makeBrandMatcher(
  brandTerms: string[],
  termsSource: 'configured' | 'heuristic',
  exactMatch: boolean,
): (query: string) => boolean {
  return (query: string) => {
    const q = query.toLowerCase()
    if (termsSource === 'configured') {
      return exactMatch ? brandTerms.includes(q) : brandTerms.some((t) => q.includes(t))
    }
    return brandTerms.some((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(q)
    })
  }
}

type Row = { query: string; clicks: number; impressions: number; position: number }

function aggregateByQuery(rows: Row[]): AIVisibilityResult['topBrandedQueries'] {
  const map = new Map<string, { clicks: number; impressions: number; position: number; count: number }>()
  for (const r of rows) {
    const prev = map.get(r.query) ?? { clicks: 0, impressions: 0, position: 0, count: 0 }
    map.set(r.query, {
      clicks: prev.clicks + r.clicks,
      impressions: prev.impressions + r.impressions,
      position: prev.position + r.position,
      count: prev.count + 1,
    })
  }
  return Array.from(map.entries())
    .map(([query, v]) => ({
      query,
      clicks: v.clicks,
      impressions: v.impressions,
      position: Math.round((v.position / v.count) * 10) / 10,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10)
}

export const aiVisibilityTool: CallableTool<AIVisibilityInput, AIVisibilityResult> = {
  slug: 'ai-visibility',
  requires: { client: true, gsc: true },
  run: (input, ctx: ToolContext) =>
    runGuarded(['gsc'], async () => {
      const missing = missingRequirement(aiVisibilityTool.requires, ctx)
      if (missing) return toolErr<AIVisibilityResult>(missing, { sources: ['gsc'] })

      const client = ctx.client!
      const siteUrl = client.gsc_site_url!
      const days = input.days ?? 90
      const rows = await fetchGSCRows(siteUrl, days)

      const configuredTerms = (client.brand_terms ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
      const termsSource: 'configured' | 'heuristic' =
        configuredTerms.length > 0 ? 'configured' : 'heuristic'
      const brandTerms =
        termsSource === 'configured'
          ? configuredTerms
          : [client.slug.toLowerCase(), brandTokenFromSite(siteUrl).toLowerCase(), client.name.toLowerCase()].filter(
              Boolean,
            )

      const isBranded = makeBrandMatcher(brandTerms, termsSource, client.brand_match_mode === 'exact')
      const branded = rows.filter((r) => isBranded(r.query))
      const nonBranded = rows.filter((r) => !isBranded(r.query))

      const sum = (arr: Row[], key: 'clicks' | 'impressions') =>
        arr.reduce((acc, r) => acc + r[key], 0)

      const brandedClicks = sum(branded, 'clicks')
      const brandedImpressions = sum(branded, 'impressions')
      const totalClicks = sum(rows, 'clicks')
      const totalImpressions = sum(rows, 'impressions')

      const notes: string[] = []
      if (termsSource === 'heuristic') {
        notes.push(
          'Brand terms were guessed from the client name and domain. Set brand_terms in client settings for an accurate branded split.',
        )
      }
      if (rows.length === 0) {
        notes.push(`Search Console returned no rows for the last ${days} days.`)
      }

      return toolOk(
        {
          domain: siteUrl,
          brandedClicks,
          brandedImpressions,
          totalClicks,
          totalImpressions,
          brandedClickShare: totalClicks > 0 ? Math.round((brandedClicks / totalClicks) * 100) : 0,
          brandedImpressionShare:
            totalImpressions > 0 ? Math.round((brandedImpressions / totalImpressions) * 100) : 0,
          topBrandedQueries: aggregateByQuery(branded),
          topNonBrandedQueries: aggregateByQuery(nonBranded),
          periodDays: days,
          brandTerms,
          termsSource,
        },
        // A heuristic split is usable but not trustworthy enough to present as final.
        { sources: ['gsc'], ...(notes.length > 0 ? { degraded: true, notes } : {}) },
      )
    }),
}
