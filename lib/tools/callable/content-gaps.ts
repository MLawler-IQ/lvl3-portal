// Content Gaps, as a callable tool.
//
// Extracted from app/actions/tools.ts `fetchContentGaps`. The classification is the
// interesting part and it is now a pure function: aggregate query rows, then bucket
// each query into one of three gap types by position and CTR.
//
// Thresholds carried over unchanged. Same note as keyword-quick-wins: the expected-CTR
// numbers here are flat per position band, where §11 specifies a configurable curve.
// When that lands, both should read from it.

import { fetchGSCRows } from '@/lib/tools-gsc'
import { toolOk, toolErr, runGuarded, type CallableTool, type ToolContext } from '../contract'
import { missingRequirement } from '../context'

export type GapType = 'high-impression-no-clicks' | 'ranking-but-weak' | 'near-page-one'

export interface ContentGap {
  query: string
  impressions: number
  clicks: number
  position: number
  ctr: number
  gapType: GapType
  recommendation: string
}

export interface ContentGapsInput {
  days?: number
}

const RECOMMENDATION: Record<GapType, string> = {
  'high-impression-no-clicks':
    'High visibility but no engagement — title/meta likely mismatched to intent. Rewrite the title tag to directly address what searchers want.',
  'near-page-one':
    'Just off page one — strengthen on-page signals (header tags, internal links, content depth) to push into top 10.',
  'ranking-but-weak': '', // built per row, since it quotes the position
}

/** Expected CTR by position band. Flat by design here; see the note above. */
function expectedCtrAt(position: number): number {
  if (position <= 3) return 0.08
  if (position <= 5) return 0.04
  return 0.02
}

type Row = { query: string; impressions: number; clicks: number; position: number }

/** Sum impressions and clicks per query, averaging position across its pages. */
export function aggregateQueries(rows: Row[]): Map<string, { impressions: number; clicks: number; position: number }> {
  const acc = new Map<string, { impressions: number; clicks: number; position: number; count: number }>()
  for (const r of rows) {
    const prev = acc.get(r.query) ?? { impressions: 0, clicks: 0, position: 0, count: 0 }
    acc.set(r.query, {
      impressions: prev.impressions + r.impressions,
      clicks: prev.clicks + r.clicks,
      position: prev.position + r.position,
      count: prev.count + 1,
    })
  }
  const out = new Map<string, { impressions: number; clicks: number; position: number }>()
  for (const [query, v] of Array.from(acc.entries())) {
    out.set(query, { impressions: v.impressions, clicks: v.clicks, position: v.position / v.count })
  }
  return out
}

export function classifyGaps(rows: Row[]): ContentGap[] {
  const gaps: ContentGap[] = []

  for (const [query, v] of Array.from(aggregateQueries(rows).entries())) {
    const { position, impressions, clicks } = v
    const ctr = impressions > 0 ? clicks / impressions : 0
    const base = {
      query,
      impressions,
      clicks,
      position: Math.round(position * 10) / 10,
      ctr: Math.round(ctr * 1000) / 10,
    }

    // Order matters: these are mutually exclusive, first match wins.
    if (impressions >= 200 && ctr < 0.01 && position <= 30) {
      gaps.push({ ...base, gapType: 'high-impression-no-clicks', recommendation: RECOMMENDATION['high-impression-no-clicks'] })
    } else if (position > 10.5 && position <= 20 && impressions >= 150) {
      gaps.push({ ...base, gapType: 'near-page-one', recommendation: RECOMMENDATION['near-page-one'] })
    } else if (position <= 10.5 && impressions >= 100 && ctr < expectedCtrAt(position)) {
      gaps.push({
        ...base,
        gapType: 'ranking-but-weak',
        recommendation: `Ranking #${Math.round(position)} but CTR is below average for this position. Add a power word to the title tag and make the meta description more specific and action-oriented.`,
      })
    }
  }

  return gaps.sort((a, b) => b.impressions - a.impressions).slice(0, 50)
}

export const contentGapsTool: CallableTool<ContentGapsInput, ContentGap[]> = {
  slug: 'content-gaps',
  requires: { client: true, gsc: true },
  run: (input, ctx: ToolContext) =>
    runGuarded(['gsc'], async () => {
      const missing = missingRequirement(contentGapsTool.requires, ctx)
      if (missing) return toolErr<ContentGap[]>(missing, { sources: ['gsc'] })

      const days = input.days ?? 90
      const rows = await fetchGSCRows(ctx.client!.gsc_site_url!, days)
      return toolOk(classifyGaps(rows), {
        sources: ['gsc'],
        ...(rows.length === 0
          ? { degraded: true, notes: [`Search Console returned no rows for the last ${days} days.`] }
          : {}),
      })
    }),
}
