// Turn a Discovery into slot answers.
//
// Pure and separate from the action so the mapping is testable without Google
// credentials — this is the step that decides what the interview will treat as
// already answered, so it deserves direct coverage.

import type { Discovery } from './discover'
import type { Answers, SlotValue } from './schema'

function auto(
  value: SlotValue['value'],
  confidence: 'high' | 'low',
  evidence: string,
  at: string,
): SlotValue {
  return { value, unknown: false, source: 'auto', confidence, evidence, recordedAt: at }
}

/**
 * Build the answer patch a discovery run implies.
 *
 * Only successful matches produce answers. A `no_match` or `failed` source
 * deliberately produces NOTHING rather than an `unknown` — "we couldn't find it"
 * is not the same as "the client doesn't know", and recording the latter would
 * let the interview skip a question it should still ask.
 *
 * Never overwrites an existing answer: a human (or an earlier interview turn)
 * always wins over a re-run of detection.
 */
export function seedFromDiscovery(discovery: Discovery, existing: Answers): Answers {
  const at = discovery.completedAt
  const patch: Answers = {}

  const set = (slotId: string, v: SlotValue) => {
    if (existing[slotId]) return // don't clobber a human answer
    patch[slotId] = v
  }

  if (discovery.ga4.status === 'ok' && discovery.ga4.data) {
    const m = discovery.ga4.data
    set('ga4_property_id', auto(m.propertyId, m.confidence, m.evidence, at))
  }

  if (discovery.gsc.status === 'ok' && discovery.gsc.data) {
    const m = discovery.gsc.data
    set('gsc_site_url', auto(m.siteUrl, m.confidence, m.evidence, at))
  }

  if (discovery.gbp.status === 'ok' && discovery.gbp.data) {
    const m = discovery.gbp.data
    set('gbp_account_id', auto(m.accountId, m.confidence, m.evidence, at))
  }

  // Brand terms, derived from the client's own name/slug/domain by
  // lib/onboarding/brand-terms.ts. ALWAYS 'low', and the derivation types its
  // confidence as the literal so this cannot drift:
  //
  //   isFilled() counts auto/high as ANSWERED. A brand-term list is not read
  //   from any account — it is a guess about how strangers type a business into
  //   Google, matched against every query by SUBSTRING. A wrong term marks
  //   non-branded queries as branded, which inflates branded share and hides the
  //   opportunity the audit exists to find, and it does that invisibly: the
  //   split still renders, it is just wrong. So this is pre-filled for a human
  //   to confirm, never recorded as known. The Tornado account (89% branded) is
  //   exactly the number this would corrupt.
  //
  // An empty list means every candidate was withheld as over-capturing; seeding
  // nothing is deliberate, because no terms is better than wrong terms.
  if (discovery.brandTerms && discovery.brandTerms.terms.length > 0) {
    const b = discovery.brandTerms
    set('brand_terms', auto(b.terms, b.confidence, b.evidence, at))
  }

  // Competitors from Semrush. Also 'low': these are domains that rank for
  // overlapping keywords, which is not the same question as "who do you lose
  // jobs to" — the slot's own `why` says client-named competitors beat
  // tool-inferred ones. Directories and aggregators routinely appear here, so
  // the list is a starting point for the strategist to prune, not an answer.
  if (discovery.competitors?.status === 'ok' && discovery.competitors.data) {
    const c = discovery.competitors.data
    if (c.domains.length > 0) set('competitors', auto(c.domains, c.confidence, c.evidence, at))
  }

  if (discovery.clientType) {
    // High confidence only when a real signal backed it. With zero matched
    // locations inferClientType falls through to 'lead_gen', which is a default
    // rather than a finding — so it goes in as a low-confidence suggestion the
    // strategist still has to confirm.
    const hasSignal = (discovery.gbp.data?.locationCount ?? 0) > 0
    set(
      'client_type',
      auto(
        discovery.clientType.value,
        hasSignal ? 'high' : 'low',
        discovery.clientType.evidence,
        at,
      ),
    )
  }

  return patch
}

/** One-line summary for the interview transcript, so the strategist sees what was found. */
export function describeDiscovery(discovery: Discovery): string {
  const bits: string[] = []

  const line = (label: string, r: { status: string; message?: string }, value?: string) => {
    if (r.status === 'ok' && value) bits.push(`${label}: ${value}`)
    else if (r.status === 'no_match') bits.push(`${label}: not found`)
    else if (r.status === 'failed') bits.push(`${label}: lookup failed`)
  }

  line('GA4', discovery.ga4, discovery.ga4.data?.propertyId)
  line('Search Console', discovery.gsc, discovery.gsc.data?.siteUrl)
  line('Business Profile', discovery.gbp, discovery.gbp.data?.accountName)

  const competitors = discovery.competitors
  if (competitors) {
    const n = competitors.data?.domains.length ?? 0
    line('Competitors', competitors, n > 0 ? `${n} from Semrush, unconfirmed` : undefined)
  }

  // Brand terms are derived locally, so they can't "fail" — but they are a GUESS,
  // and the transcript has to say so or a strategist will read the list as found.
  // Proposing none is itself a finding worth stating: it means the brand's own
  // words are ordinary search words, which is the case where the branded split
  // most needs a human to supply the terms.
  if (discovery.brandTerms && discovery.brandTerms.terms.length > 0) {
    bits.push(`Brand terms: ${discovery.brandTerms.terms.length} suggested, confirm before use`)
  } else if (discovery.brandTerms?.overCaptureRisk) {
    bits.push('Brand terms: none safe to guess — the brand words are ordinary search words, so ask')
  }

  const failed = [discovery.ga4, discovery.gsc, discovery.gbp, ...(competitors ? [competitors] : [])].filter(
    (r) => r.status === 'failed',
  )
  const tail =
    failed.length > 0
      ? ` ${failed.length} lookup${failed.length === 1 ? '' : 's'} failed — those are gaps, not confirmations.`
      : ''

  return `Checked ${discovery.domain}. ${bits.join(' · ')}.${tail}`
}
