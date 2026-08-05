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

  const failed = [discovery.ga4, discovery.gsc, discovery.gbp].filter((r) => r.status === 'failed')
  const tail =
    failed.length > 0
      ? ` ${failed.length} lookup${failed.length === 1 ? '' : 's'} failed — those are gaps, not confirmations.`
      : ''

  return `Checked ${discovery.domain}. ${bits.join(' · ')}.${tail}`
}
