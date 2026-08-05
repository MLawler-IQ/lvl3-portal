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
