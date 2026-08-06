// ONPAGE-012 — content-to-template ratio: page groups are not template-dominated.
//
// The rubric row this implements, verbatim from docs/rubric/rubric.json:
//   check:      "Content-to-template ratio: page groups are not template-dominated"
//   howToTest:  "Sitebulb content words vs template words, aggregated by template
//                group, crossed with impression-earning rate"
//   dataSource: "derived"   automation: "auto"   severity: high   effort: high
//   notes:      "ADDED AFTER PILOT. A similarity check passes AI content that is
//                unique-but-worthless. Tornado median was 29% unique / 71% template"
//
// Both stations are required. `crawl` supplies the word counts; `gsc` supplies the
// impression-earning rate the howToTest crosses them with — so a missing GSC
// station makes this not_run rather than a partially-answered pass. That is the
// engine's job, which is why this file declares the requirement and nothing else.
//
// A thin adapter. Every number comes from contentToTemplateRatio(); this file
// chooses a status and formats evidence. No severity, no score.

import type { CheckDefinition, Finding, StationBundle } from '@/lib/findings/types'
import { contentToTemplateRatio, pct } from '@/lib/findings/analyses'

const EXAMPLE_LIMIT = 5

export const onpage012: CheckDefinition = {
  id: 'ONPAGE-012',
  requires: ['crawl', 'gsc'],
  evaluate: (s: StationBundle): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    const rows = s.gsc!.ok ? s.gsc!.data : []
    const analysis = contentToTemplateRatio(pages, rows)

    // No group big enough to be a template is NOT a clean bill of health — it is
    // a site this check cannot speak about. Reporting pass here would be the §17
    // failure mode: "we didn't look" rendered as "it's fine".
    if (analysis.groups.length === 0) {
      return {
        checkId: 'ONPAGE-012',
        status: 'not_run',
        evidence: { detail: analysis.detail },
        source: 'derived',
        reason:
          analysis.unjudgeableGroups > 0
            ? `${analysis.unjudgeableGroups} template group(s) had fewer than ${analysis.minGroupSize} pages with a word count`
            : `no template group of ${analysis.minGroupSize}+ pages to aggregate over`,
      }
    }

    if (analysis.dominated.length > 0) {
      return {
        checkId: 'ONPAGE-012',
        status: 'fail',
        evidence: {
          affectedUrls: analysis.dominatedPages,
          detail: analysis.detail,
          examples: analysis.dominated
            .slice(0, EXAMPLE_LIMIT)
            .map(
              (g) =>
                `${g.pattern} → ${g.pages} pages, ${pct(g.medianUniqueShare)}% unique content, ${pct(g.impressionEarningRate)}% earning impressions`,
            ),
        },
        source: 'derived',
      }
    }

    // A clean ratio computed over a partially-measured group is not a pass.
    //
    // `pass` asserts every judged group was fully measurable. Where it was not, the
    // ratio still ran and is still worth reporting, but the coverage claim behind `pass`
    // does not hold — that is exactly what `degraded` is for, and this detector had
    // never emitted it. Note the dominated branch above stays `fail`: a real defect
    // outranks a coverage caveat, and the caveat is carried in the detail either way.
    if (analysis.unmeasuredInJudged > 0) {
      return {
        checkId: 'ONPAGE-012',
        status: 'degraded',
        evidence: {
          value: analysis.groups.length,
          detail: analysis.detail,
        },
        source: 'derived',
        reason: `${analysis.unmeasuredInJudged} page(s) in judged groups carried no word count`,
      }
    }

    return {
      checkId: 'ONPAGE-012',
      status: 'pass',
      evidence: {
        value: analysis.groups.length,
        detail: analysis.detail,
      },
      source: 'derived',
    }
  },
}
