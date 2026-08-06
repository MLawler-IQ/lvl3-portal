// Backlink Overview, as a callable tool.
//
// Extracted from app/actions/tools-extended.ts. One behaviour change, deliberate:
// the original returned an error if EITHER Semrush call failed, throwing away the half
// that succeeded. Now a single failure degrades — you get the ranks without the
// backlink profile, or vice versa, with the gap named.
//
// That matters because of D2's coupling rule: Semrush is a VALIDATION layer and must
// never become a pipeline dependency. A validation source that takes the whole tool
// down with it is exactly the dependency the rule forbids.

import { normalizeDomain } from '@/lib/normalize-domain'
import {
  fetchSemrushBacklinksOverview,
  fetchSemrushDomainRanks,
  type SemrushBacklinksOverview,
  type SemrushDomainRank,
} from '@/lib/connectors/semrush-portal'
import { toolOk, toolErr, runGuarded, type CallableTool, type ToolContext } from '../contract'
import { missingRequirement } from '../context'

export interface BacklinkResult {
  domain: string
  ranks: SemrushDomainRank | null
  backlinks: SemrushBacklinksOverview | null
}

export const backlinkOverviewTool: CallableTool<Record<string, never>, BacklinkResult> = {
  slug: 'backlink-overview',
  requires: { client: true, gsc: true },
  run: (_input, ctx: ToolContext) =>
    runGuarded(['semrush'], async () => {
      const missing = missingRequirement(backlinkOverviewTool.requires, ctx)
      if (missing) return toolErr<BacklinkResult>(missing, { sources: ['semrush'] })

      const apiKey = process.env.SEMRUSH_API_KEY
      if (!apiKey)
        return toolErr<BacklinkResult>('SEMRUSH_API_KEY is not configured.', { sources: ['semrush'] })

      const domain = normalizeDomain(ctx.client!.gsc_site_url!)
      const [ranks, backlinks] = await Promise.all([
        fetchSemrushDomainRanks(domain, apiKey),
        fetchSemrushBacklinksOverview(domain, apiKey),
      ])

      const notes: string[] = []
      if (!ranks.ok) notes.push(`Semrush domain ranks unavailable: ${ranks.error}`)
      if (!backlinks.ok) notes.push(`Semrush backlink profile unavailable: ${backlinks.error}`)

      // Both gone means there is nothing to report — that is a failure, not a gap.
      if (!ranks.ok && !backlinks.ok) {
        return toolErr<BacklinkResult>(notes.join(' · '), {
          sources: ['semrush'],
          partial: { domain, ranks: null, backlinks: null },
        })
      }

      return toolOk(
        {
          domain,
          ranks: ranks.ok ? ranks.data : null,
          backlinks: backlinks.ok ? backlinks.data : null,
        },
        { sources: ['semrush'], ...(notes.length > 0 ? { degraded: true, notes } : {}) },
      )
    }),
}
