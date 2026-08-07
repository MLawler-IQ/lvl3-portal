'use server'

// Wiring for onboarding auto-discovery. All the logic lives in
// lib/onboarding/{discover,seed}.ts; this file only does auth, dependency
// injection and the single write.

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
// GBP authenticates as a different identity (matt@) than GA4/GSC (analytics@),
// so its client comes from a separate module.
import { getAdminOAuthClient } from '@/lib/google-auth'
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'
import { listGSCSites } from '@/lib/google-search-console'
import { listGBPAccounts, listGBPLocations } from '@/lib/connectors/gbp'
import {
  buildGa4DomainIndex,
  discoverClientConfig,
  type Discovery,
} from '@/lib/onboarding/discover'
import { describeDiscovery, seedFromDiscovery } from '@/lib/onboarding/seed'
import { computeCompleteness, type Completeness } from '@/lib/onboarding/completeness'
import { answersSchema, type Answers } from '@/lib/onboarding/schema'
import { logError } from '@/lib/logging'

export interface DiscoveryOutcome {
  discovery?: Discovery
  answers?: Answers
  completeness?: Completeness
  /** Slot ids newly filled by this run. */
  seeded?: string[]
  error?: string
}

/**
 * Run discovery for a session's client and seed the draft.
 *
 * Writes only to client_onboarding_sessions.answers — the draft gate is
 * unchanged, so nothing reaches clients.* until approveOnboardingSession.
 */
export async function runDiscovery(sessionId: string): Promise<DiscoveryOutcome> {
  try {
    await requireAdmin()
    const service = await createServiceClient()

    const { data: session, error: sessionErr } = await service
      .from('client_onboarding_sessions')
      .select('id, client_id, status, answers')
      .eq('id', sessionId)
      .single()

    if (sessionErr) return { error: `Could not load session: ${sessionErr.message}` }
    if (!session) return { error: 'Session not found' }
    if (session.status === 'approved') return { error: 'Session is already approved' }

    const { data: client } = await service
      .from('clients')
      .select('website_url, gsc_site_url, name, slug')
      .eq('id', session.client_id)
      .single()

    // website_url is the match key. gsc_site_url is a fallback for the four
    // clients that predate the column — for them discovery mostly just confirms
    // what is already set, which is a useful check in itself.
    const seedDomain = client?.website_url || client?.gsc_site_url || ''
    if (!seedDomain) {
      return {
        error:
          'No website on file for this client, so there is nothing to match against. Add one in client settings and re-run.',
      }
    }

    const auth = await getAdminOAuthClient()
    let gbpAuth = null
    try {
      gbpAuth = await getAdminGBPOAuthClient()
    } catch {
      gbpAuth = null // GBP uses a separate token; absence is a gap, not an error
    }

    const discovery = await discoverClientConfig(seedDomain, {
      gbpAuth,
      buildGa4Index: () => buildGa4DomainIndex(auth),
      listGscSites: listGSCSites,
      listGbpAccounts: async (a) =>
        (await listGBPAccounts(a)).map((x) => ({ name: x.name, accountName: x.accountName })),
      listGbpLocations: listGBPLocations,
    },
    // Name and slug feed brand-term derivation. Without them the terms come from
    // the domain alone, which still works but loses the variants a client is
    // actually searched by — the spaced name, and the run-together form.
    { name: client?.name ?? null, slug: client?.slug ?? null },
    )

    const existing = answersSchema.safeParse(session.answers).data ?? {}
    const patch = seedFromDiscovery(discovery, existing)
    const answers: Answers = { ...existing, ...patch }
    const completeness = computeCompleteness(answers)

    const { error: saveErr } = await service
      .from('client_onboarding_sessions')
      .update({
        answers,
        status: completeness.readyForReview ? 'ready_for_review' : 'in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .neq('status', 'approved')

    if (saveErr) return { error: `Discovery ran but could not be saved: ${saveErr.message}` }

    // Record it in the transcript so the strategist can see what was found
    // without reading the checklist, and so it survives a reload.
    await service.from('client_onboarding_messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: describeDiscovery(discovery),
    })

    revalidatePath(`/clients/${session.client_id}/onboarding`)
    return { discovery, answers, completeness, seeded: Object.keys(patch) }
  } catch (err) {
    logError('onboarding.discover', 'Discovery failed', {
      sessionId,
      detail: err instanceof Error ? err.message : String(err),
    })
    return { error: err instanceof Error ? err.message : 'Discovery failed' }
  }
}
