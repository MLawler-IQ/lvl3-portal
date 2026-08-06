// Keyword Quick Wins, as a callable tool.
//
// Extracted from app/actions/tools.ts `fetchQuickWins`, which the server action now
// delegates to. The scoring is carried over unchanged — this slice is about making
// the tool callable, not about revisiting what it computes. Any change to the CTR
// assumptions below is a separate, arguable decision.

import { fetchGSCRows } from '@/lib/tools-gsc'
import { toolOk, toolErr, runGuarded, type CallableTool, type ToolContext } from '../contract'
import { missingRequirement } from '../context'

export interface QuickWin {
  query: string
  page: string
  position: number
  impressions: number
  clicks: number
  ctr: number
  estimatedClicksAt5: number
  estimatedClicksAt3: number
  opportunityScore: number
}

export interface QuickWinsInput {
  /** Trailing window. 90 days matches what the UI has always requested. */
  days?: number
}

/** Positions 4-20 with real impression volume: ranked, but not yet earning. */
const MIN_POSITION = 4
const MAX_POSITION = 20
const MIN_IMPRESSIONS = 100

/**
 * Assumed CTR at positions 5 and 3.
 *
 * Carried over from the original. Worth flagging for phase 5: these are flat
 * assumptions, whereas AUTOMATION-CONTEXT.md §11 specifies a configurable CTR curve
 * with a local-share haircut. When that curve lands, this should read from it rather
 * than keep its own numbers.
 */
const CTR_AT_5 = 0.065
const CTR_AT_3 = 0.103

export function scoreQuickWins(
  rows: { query: string; page: string; position: number; impressions: number; clicks: number; ctr: number }[],
): QuickWin[] {
  return rows
    .filter(
      (r) => r.position >= MIN_POSITION && r.position <= MAX_POSITION && r.impressions >= MIN_IMPRESSIONS,
    )
    .map((r) => {
      const estimatedClicksAt5 = Math.round(r.impressions * CTR_AT_5)
      const estimatedClicksAt3 = Math.round(r.impressions * CTR_AT_3)
      const opportunityScore = Math.round((estimatedClicksAt3 - r.clicks) * (1 / r.position) * 100)
      return {
        query: r.query,
        page: r.page,
        position: Math.round(r.position),
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: Math.round(r.ctr * 10) / 10,
        estimatedClicksAt5,
        estimatedClicksAt3,
        opportunityScore,
      }
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 50)
}

export const keywordQuickWinsTool: CallableTool<QuickWinsInput, QuickWin[]> = {
  slug: 'keyword-quick-wins',
  requires: { client: true, gsc: true },
  run: (input, ctx: ToolContext) =>
    runGuarded(['gsc'], async () => {
      const missing = missingRequirement(keywordQuickWinsTool.requires, ctx)
      if (missing) return toolErr<QuickWin[]>(missing, { sources: ['gsc'] })

      const days = input.days ?? 90
      const rows = await fetchGSCRows(ctx.client!.gsc_site_url!, days)
      const wins = scoreQuickWins(rows)

      // An empty result is a real answer, not a failure — but say so, because
      // "no quick wins" and "the query returned nothing" look identical otherwise.
      return toolOk(wins, {
        sources: ['gsc'],
        ...(rows.length === 0
          ? { degraded: true, notes: [`Search Console returned no rows for the last ${days} days.`] }
          : {}),
      })
    }),
}
