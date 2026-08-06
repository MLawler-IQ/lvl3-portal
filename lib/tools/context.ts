// Build a ToolContext once, then hand it to as many tools as you like.
//
// This is the piece that makes tools composable. Every server action previously
// began with `requireAdmin()` plus its own `select` against `clients`, so running
// twelve tools meant twelve auth checks and twelve client reads — and an
// orchestrator, which has no session, could not satisfy the first one at all.
//
// Auth lives in the CALLER now. A server action authenticates and then builds a
// context; the orchestrator builds one directly with `invoker: {kind:'orchestrator'}`.
// Neither path lets a tool decide for itself who is allowed to run it.

import { createServiceClient } from '@/lib/supabase/server'
import { getAdminOAuthClient } from '@/lib/google-auth'
// A different module for a different Google identity: GA4/GSC is analytics@,
// Business Profile is matt@. Keeping them apart is deliberate.
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'
import type { ToolContext } from './contract'

/** The exact column list ToolContext.client promises. One place, so it can't drift. */
const CLIENT_COLUMNS =
  'id, name, slug, gsc_site_url, ga4_property_id, gbp_account_id, website_url, brand_terms, brand_match_mode, competitors'

export interface BuildContextOptions {
  clientId?: string | null
  invoker: ToolContext['invoker']
  onProgress?: ToolContext['onProgress']
  /**
   * Resolve the GBP identity too. It is a SEPARATE Google account from GA4/GSC
   * (matt@ vs analytics@), so it costs an extra token read and is opt-in.
   */
  needsGbp?: boolean
}

/**
 * Resolve everything a tool needs.
 *
 * Throws only when the caller asked for a client that does not exist — that is a
 * programming error, not a tool failure. Everything else degrades: an unavailable
 * GBP token yields `gbpAuth: null`, and a tool that `requires.gbp` reports that as
 * a visible gap rather than a crash.
 */
export async function buildToolContext(opts: BuildContextOptions): Promise<ToolContext> {
  const service = await createServiceClient()

  let client: ToolContext['client'] = null
  if (opts.clientId) {
    const { data, error } = await service
      .from('clients')
      .select(CLIENT_COLUMNS)
      .eq('id', opts.clientId)
      .single()
    if (error || !data) {
      throw new Error(`Client ${opts.clientId} not found`)
    }
    client = data as unknown as ToolContext['client']
  }

  const auth = await getAdminOAuthClient()

  // GBP failing must not cost you every other tool in the run.
  let gbpAuth: ToolContext['gbpAuth'] = null
  if (opts.needsGbp) {
    try {
      gbpAuth = await getAdminGBPOAuthClient()
    } catch {
      gbpAuth = null
    }
  }

  return {
    client,
    auth,
    gbpAuth,
    service,
    invoker: opts.invoker,
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  }
}

/**
 * Assert a tool's declared requirements against the context it was handed.
 *
 * Returns a human-readable reason when something is missing, or null when the tool
 * can run. The point is that "no Search Console site configured" is a VISIBLE gap
 * with a named cause, never an empty result that reads like zero traffic —
 * AUTOMATION-CONTEXT.md §17's first failure mode.
 */
export function missingRequirement(
  requires: { client?: boolean; gsc?: boolean; ga4?: boolean; gbp?: boolean },
  ctx: ToolContext,
): string | null {
  if (requires.client && !ctx.client) return 'No client selected.'
  if (requires.gsc && !ctx.client?.gsc_site_url) {
    return `No Search Console property configured for ${ctx.client?.name ?? 'this client'}. Set it in client settings.`
  }
  if (requires.ga4 && !ctx.client?.ga4_property_id) {
    return `No GA4 property configured for ${ctx.client?.name ?? 'this client'}. Set it in client settings.`
  }
  if (requires.gbp && !ctx.gbpAuth) {
    return 'Google Business Profile is not connected. Connect it in Admin.'
  }
  if (requires.gbp && !ctx.client?.gbp_account_id) {
    return `No Business Profile account configured for ${ctx.client?.name ?? 'this client'}.`
  }
  return null
}
