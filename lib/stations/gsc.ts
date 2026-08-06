// The GSC station: one Search Console property's last 90 days of query/page rows.
//
// Thin on purpose. Every rule about what the rows MEAN lives elsewhere — the engine owns
// "zero rows cannot support a verdict", the detectors own the noise floor — so the only
// judgement here is whether there was anything to point the fetch at.

import { runGuarded, toolErr, toolOk, type ToolResult } from '@/lib/tools/contract'
import type { GSCRow } from '@/lib/tools-gsc'

/**
 * Fetch the GSC station.
 *
 * `days` defaults to 90 to match the window the cannibalisation detector was tuned on; a
 * shorter window drops the suppressed loser of a cannibalised pair below the impressions
 * floor, which reads as "no cannibalisation".
 */
export async function runGscStation(
  siteUrl: string | null,
  days = 90,
): Promise<ToolResult<GSCRow[]>> {
  return runGuarded<GSCRow[]>(['gsc'], async () => {
    // UNCONFIGURED IS AN ERROR, NOT AN EMPTY OK. `toolOk([], …)` would hit the engine's
    // empty-station branch and every gsc-backed check would read "gsc station returned no
    // data — cannot distinguish clean from unseen". That reason is true of a property that
    // returned nothing and false here: nothing was ever configured to query, which is a
    // client-record gap an admin can fix, not an unknowable. Same not_run either way; only
    // the sentence differs, and the sentence is the entire deliverable of a not_run.
    if (siteUrl === null || siteUrl.trim().length === 0) {
      return toolErr<GSCRow[]>('client has no gsc_site_url configured', { sources: ['gsc'] })
    }

    // Imported here rather than at the top of the file. lib/tools-gsc reaches
    // lib/api-cache, which constructs the Supabase server client, which imports
    // `next/headers` — and that specifier does not resolve outside the Next runtime. A
    // static import therefore makes a plain `node` run of the pipeline fail at LOAD time,
    // before the station it was skipping has been reached. Deferring it means an offline
    // or --no-gsc run never touches Postgres at all, which is what those flags claim.
    const { fetchGSCRows } = await import('@/lib/tools-gsc')
    const rows = await fetchGSCRows(siteUrl, days)

    // A genuinely empty array from a configured property stays a ToolOk. The engine already
    // turns that into not_run for every check that requires this station; repeating the rule
    // here would put one decision in two places, and the two would eventually disagree.
    //
    // 'gsc' is the only source claimed, never 'cache' — even though fetchGSCRows is backed
    // by a 6h api_cache entry. cachedFetch exposes no hit/miss signal and swallows its own
    // read and write errors, so this module cannot know whether the bytes came from
    // Postgres or from Google. Listing 'cache' would be provenance we invented.
    //
    // RECORDED, NOT FIXED: fetchGSCRows computes startDate/endDate INSIDE the cached
    // fetcher while the key is `gsc:rows:${siteUrl}:${days}` with no dates in it. So a hit
    // inside the 6h TTL returns the window that was current when the entry was written,
    // and a run at 00:30 can be served yesterday's range. It is wrong and it is not this
    // slice's to fix: putting dates in the key invalidates every existing dashboard cache
    // entry for every client at once, which is a separate, deliberate change.
    return toolOk(rows, { sources: ['gsc'], degraded: false })
  })
}
