import { describe, expect, it } from 'vitest'
import {
  computeCompleteness,
  describeGapsForPrompt,
} from '@/lib/onboarding/completeness'
import {
  REQUIRED_SLOT_IDS,
  SLOTS,
  clientTypeFromAnswers,
  isFilled,
  isKnownGap,
  sanitizeAnswerPatch,
  type Answers,
} from '@/lib/onboarding/schema'

const filled = (value: unknown): Answers[string] =>
  ({ value, unknown: false } as Answers[string])

/** Every required slot answered — the "complete interview" baseline. */
function completeAnswers(): Answers {
  const a: Answers = {}
  for (const slot of SLOTS) {
    if (!slot.required) continue
    a[slot.id] =
      slot.kind === 'list'
        ? filled(['something'])
        : slot.kind === 'choice'
          ? filled(slot.choices![0])
          : filled('an answer')
  }
  return a
}

describe('isFilled', () => {
  it('treats unknown as a gap, never an answer', () => {
    expect(isFilled({ value: 'x', unknown: true })).toBe(false)
    expect(isFilled({ value: null, unknown: true, reason: 'client does not track it' })).toBe(false)
  })

  it('rejects empty strings and empty/whitespace lists', () => {
    expect(isFilled({ value: '', unknown: false })).toBe(false)
    expect(isFilled({ value: '   ', unknown: false })).toBe(false)
    expect(isFilled({ value: [], unknown: false })).toBe(false)
    expect(isFilled({ value: ['  '], unknown: false })).toBe(false)
  })

  it('accepts real values including numbers and false', () => {
    expect(isFilled({ value: 'HVAC', unknown: false })).toBe(true)
    expect(isFilled({ value: 0, unknown: false })).toBe(true)
    expect(isFilled({ value: false, unknown: false })).toBe(true)
    expect(isFilled({ value: ['a'], unknown: false })).toBe(true)
  })

  it('treats a missing slot as empty', () => {
    expect(isFilled(undefined)).toBe(false)
  })

  // The load-bearing rule of the setup rebuild. A model reading a meeting
  // transcript is guessing however fluently it phrases the guess, so a `context`
  // value is a suggestion to confirm, never an answer — at EVERY confidence.
  // High confidence is the case that matters: it is the one that looks safe.
  it('never counts a context value, at any confidence', () => {
    expect(isFilled({ value: 'HVAC', unknown: false, source: 'context', confidence: 'high' })).toBe(false)
    expect(isFilled({ value: 'HVAC', unknown: false, source: 'context', confidence: 'medium' })).toBe(false)
    expect(isFilled({ value: 'HVAC', unknown: false, source: 'context', confidence: 'low' })).toBe(false)
    expect(isFilled({ value: 'HVAC', unknown: false, source: 'context' })).toBe(false)
    // Not merely a string rule — a context list or number is just as much a guess.
    expect(isFilled({ value: ['a', 'b'], unknown: false, source: 'context', confidence: 'high' })).toBe(false)
    expect(isFilled({ value: 42, unknown: false, source: 'context', confidence: 'high' })).toBe(false)
  })

  it('counts a high-confidence auto match but not a low-confidence one', () => {
    expect(isFilled({ value: 'properties/123', unknown: false, source: 'auto', confidence: 'high' })).toBe(true)
    expect(isFilled({ value: 'properties/123', unknown: false, source: 'auto', confidence: 'low' })).toBe(false)
  })

  it('counts interview and manual answers', () => {
    expect(isFilled({ value: 'HVAC', unknown: false, source: 'interview' })).toBe(true)
    // A manual value is an admin typing into settings — an explicit, recorded
    // override, so it counts even though nothing verified it against Google.
    expect(isFilled({ value: 'HVAC', unknown: false, source: 'manual' })).toBe(true)
    expect(isFilled({ value: 'HVAC', unknown: false, source: 'manual', confidence: 'low' })).toBe(true)
  })

  // An unknown beats a source: a client who won't say is a gap even if a
  // transcript or an admin supplied something.
  it('lets unknown override any source', () => {
    expect(isFilled({ value: 'HVAC', unknown: true, source: 'manual' })).toBe(false)
    expect(isFilled({ value: 'HVAC', unknown: true, source: 'auto', confidence: 'high' })).toBe(false)
  })
})

describe('context values cannot unlock review', () => {
  // The seam that matters: isFilled is where the rule lives, but readyForReview
  // is where breaking it would actually cost something — a session approved on
  // the strength of a transcript the model paraphrased.
  it('holds a session open even when every required slot has a high-confidence context value', () => {
    const answers: Answers = {}
    for (const slot of SLOTS) {
      if (!slot.required) continue
      answers[slot.id] = {
        value: slot.kind === 'list' ? ['something'] : slot.kind === 'choice' ? slot.choices![0] : 'an answer',
        unknown: false,
        source: 'context',
        confidence: 'high',
        evidence: 'quoted from the kickoff transcript',
      } as Answers[string]
    }

    const c = computeCompleteness(answers)
    expect(c.readyForReview).toBe(false)
    expect(c.pct).toBe(0)
    expect(c.filled).toEqual([])
    expect(c.missing.sort()).toEqual([...REQUIRED_SLOT_IDS].sort())
  })

  it('opens review once those same values are confirmed by a human', () => {
    const answers: Answers = {}
    for (const slot of SLOTS) {
      if (!slot.required) continue
      answers[slot.id] = {
        value: slot.kind === 'list' ? ['something'] : slot.kind === 'choice' ? slot.choices![0] : 'an answer',
        unknown: false,
        source: 'manual',
      } as Answers[string]
    }

    expect(computeCompleteness(answers).readyForReview).toBe(true)
  })

  it('survives the round trip through sanitizeAnswerPatch', () => {
    const clientTypeSlot = SLOTS.find((s) => s.id === 'client_type')!
    const patch = sanitizeAnswerPatch({
      client_type: {
        value: clientTypeSlot.choices![0],
        unknown: false,
        source: 'context',
        confidence: 'high',
        evidence: 'they said they do heating and cooling',
      },
    })
    // The provenance must survive sanitization, or the rule has nothing to read.
    expect(patch['client_type']?.source).toBe('context')
    expect(patch['client_type']?.evidence).toBe('they said they do heating and cooling')
    expect(isFilled(patch['client_type'])).toBe(false)
  })
})

describe('isKnownGap', () => {
  // An unknown with no reason is a gap nobody can interpret later, so it counts
  // as empty rather than as a recorded gap — otherwise it would unblock approval
  // while telling a future reader nothing.
  it('requires a non-empty reason', () => {
    expect(isKnownGap({ value: null, unknown: true, reason: 'not tracked' })).toBe(true)
    expect(isKnownGap({ value: null, unknown: true })).toBe(false)
    expect(isKnownGap({ value: null, unknown: true, reason: '   ' })).toBe(false)
    expect(isKnownGap({ value: 'answered', unknown: false })).toBe(false)
    expect(isKnownGap(undefined)).toBe(false)
  })
})

describe('computeCompleteness', () => {
  it('reports every required slot missing when there are no answers', () => {
    const c = computeCompleteness({})
    expect(c.missing).toEqual([...REQUIRED_SLOT_IDS])
    expect(c.filled).toEqual([])
    expect(c.pct).toBe(0)
    expect(c.readyForReview).toBe(false)
  })

  it('does not count an optional slot toward required coverage', () => {
    const optional = SLOTS.find((s) => !s.required)!
    const c = computeCompleteness({ [optional.id]: filled('answered') })
    expect(c.pct).toBe(0)
    expect(c.readyForReview).toBe(false)
  })

  it('blocks review while a single required slot is empty', () => {
    const answers = completeAnswers()
    delete answers['avg_job_value']
    const c = computeCompleteness(answers)
    expect(c.missing).toEqual(['avg_job_value'])
    expect(c.readyForReview).toBe(false)
  })

  it('unblocks review on an explicit unknown, but still reports it as a gap', () => {
    const answers = completeAnswers()
    answers['avg_job_value'] = {
      value: null,
      unknown: true,
      reason: 'client does not track job value by service',
    }
    const c = computeCompleteness(answers)

    expect(c.readyForReview).toBe(true)
    // The load-bearing assertion: unknown is not filled.
    expect(c.filled).not.toContain('avg_job_value')
    expect(c.unknown).toContain('avg_job_value')
    expect(c.pct).toBeLessThan(100)
    expect(c.slots.find((s) => s.id === 'avg_job_value')).toMatchObject({
      state: 'unknown',
      reason: 'client does not track job value by service',
    })
  })

  it('does NOT unblock review for an unknown with no reason', () => {
    const answers = completeAnswers()
    answers['avg_job_value'] = { value: null, unknown: true }
    const c = computeCompleteness(answers)

    expect(c.readyForReview).toBe(false)
    expect(c.missing).toContain('avg_job_value')
    expect(c.unknown).not.toContain('avg_job_value')
  })

  it('reaches 100% and ready only when all required slots are truly filled', () => {
    const c = computeCompleteness(completeAnswers())
    expect(c.missing).toEqual([])
    expect(c.unknown).toEqual([])
    expect(c.pct).toBe(100)
    expect(c.readyForReview).toBe(true)
  })
})

describe('sanitizeAnswerPatch', () => {
  it('drops slot ids that do not exist', () => {
    const out = sanitizeAnswerPatch({
      seasonality: { value: 'summer peak', unknown: false },
      totally_made_up_slot: { value: 'nope', unknown: false },
    })
    expect(Object.keys(out)).toEqual(['seasonality'])
  })

  it('drops a choice value that is not one of the declared choices', () => {
    const bad = sanitizeAnswerPatch({ client_type: { value: 'plumbing_empire', unknown: false } })
    expect(bad).toEqual({})

    const good = sanitizeAnswerPatch({ client_type: { value: 'local_service', unknown: false } })
    expect(good['client_type']?.value).toBe('local_service')
  })

  it('allows a choice slot to be marked unknown without failing the choice check', () => {
    const out = sanitizeAnswerPatch({
      client_type: { value: null, unknown: true, reason: 'unclear from the conversation' },
    })
    expect(out['client_type']?.unknown).toBe(true)
  })

  it('stamps recordedAt and defaults unknown to false', () => {
    const out = sanitizeAnswerPatch({ seasonality: { value: 'summer' } })
    expect(out['seasonality']?.unknown).toBe(false)
    expect(out['seasonality']?.recordedAt).toBeTruthy()
  })

  it('returns an empty patch for junk input instead of throwing', () => {
    expect(sanitizeAnswerPatch(null)).toEqual({})
    expect(sanitizeAnswerPatch('a string')).toEqual({})
    expect(sanitizeAnswerPatch([1, 2, 3])).toEqual({})
    expect(sanitizeAnswerPatch({ seasonality: 'not an object' })).toEqual({})
  })
})

describe('clientTypeFromAnswers', () => {
  it('returns null unless a valid type is actually filled', () => {
    expect(clientTypeFromAnswers({})).toBeNull()
    expect(clientTypeFromAnswers({ client_type: { value: null, unknown: true } })).toBeNull()
    expect(clientTypeFromAnswers({ client_type: filled('local_service') })).toBe('local_service')
  })
})

describe('describeGapsForPrompt', () => {
  it('names the missing slots so the model knows what is left', () => {
    const answers = completeAnswers()
    delete answers['service_radius']
    const text = describeGapsForPrompt(answers)
    expect(text).toContain('STILL NEEDED')
    expect(text).toContain('service_radius')
  })

  it('tells the model not to re-ask what is already answered', () => {
    const text = describeGapsForPrompt({ seasonality: filled('summer peak') })
    expect(text).toContain('ALREADY ANSWERED')
    expect(text).toContain('seasonality')
  })

  it('lists unknowns separately from missing', () => {
    const answers = completeAnswers()
    answers['cms_hosting'] = { value: null, unknown: true, reason: 'client will check with IT' }
    const text = describeGapsForPrompt(answers)
    expect(text).toContain('MARKED UNKNOWN')
    expect(text).toContain('client will check with IT')
  })
})

describe('access slots cover what the intake form collected', () => {
  // "Replace the form fully" means every column ClientSettingsForm wrote is
  // reachable from the interview. This caught four missing slots.
  it('has a slot for every clients.* column the old form set', () => {
    const promoted = new Set(SLOTS.map((s) => s.promotesTo).filter(Boolean))
    for (const column of [
      'client_type',
      'ga4_property_id',
      'gsc_site_url',
      'gbp_account_id',
      'gbp_location_group',
      'competitors',
      'brand_terms',
      'key_event_names',
      'google_sheet_id',
    ]) {
      expect(promoted.has(column)).toBe(true)
    }
  })

  it('has no slot promoting to a column that does not exist on clients', () => {
    // Guards against the inverse failure: promotion code for a slot that can
    // never be filled, which is dead code with a passing test.
    const known = new Set([
      'client_type',
      'ga4_property_id',
      'gsc_site_url',
      'gbp_account_id',
      'gbp_location_group',
      'competitors',
      'brand_terms',
      'key_event_names',
      'google_sheet_id',
    ])
    for (const slot of SLOTS) {
      if (slot.promotesTo) expect(known.has(slot.promotesTo)).toBe(true)
    }
  })
})

/**
 * Eval case #1 — Tornado HVAC, the D7 pilot. These are the answers the real
 * (manual) session produced. The assertions encode what a correct interview has
 * to capture, so a later prompt change that stops asking about the service
 * radius fails here rather than in production.
 */
describe('Tornado HVAC fixture (eval case 1)', () => {
  const tornado: Answers = {
    services_by_revenue: filled(['air duct cleaning', 'HVAC repair', 'furnace install', 'heat pump install']),
    avg_job_value: filled('duct cleaning ~$450, repair ~$350, furnace install ~$6,500'),
    seasonality: filled('AC demand May-Sept, heating Nov-Feb; content needs to be live 8 weeks ahead'),
    service_radius: filled(['Sherman Oaks', 'Van Nuys', 'Studio City', 'Burbank', 'North Hollywood']),
    gbp_service_areas_confirmed: filled('Confirmed: San Fernando Valley only. Orange County pages are wrong.'),
    lead_handling: filled('Owner answers during hours, voicemail after. Web forms go to one inbox, untracked.'),
    prior_vendor_work: filled('Previous vendor bulk-generated 130 /Service/ pages plus 18 area pages. Not attached to them.'),
    approval_authority: filled('Owner approves everything; template changes can proceed without sign-off.'),
    cms_hosting: filled('WordPress + Yoast, shared hosting, owner has admin.'),
    client_type: filled('local_service'),
    ga4_property_id: filled('123456789'),
    gsc_site_url: filled('sc-domain:tornadohvacca.com'),
  }

  it('is complete and ready for review', () => {
    const c = computeCompleteness(tornado)
    expect(c.missing).toEqual([])
    expect(c.readyForReview).toBe(true)
    expect(c.pct).toBe(100)
  })

  it('captures the service radius that the audit needed and the old form never asked', () => {
    // The finding no check on any list caught: a Sherman Oaks business
    // targeting Orange County, 45-65 miles away.
    expect(isFilled(tornado['service_radius'])).toBe(true)
    expect(isFilled(tornado['gbp_service_areas_confirmed'])).toBe(true)
  })

  it('captures average job value, the number that makes forecasts revenue', () => {
    expect(isFilled(tornado['avg_job_value'])).toBe(true)
  })

  it('captures the prior vendor work that explains the cannibalisation', () => {
    expect(String(tornado['prior_vendor_work']!.value)).toContain('130')
  })

  it('sets client_type, which closes the blocker keeping local modules dark', () => {
    expect(clientTypeFromAnswers(tornado)).toBe('local_service')
  })
})
