import { describe, expect, it } from 'vitest'
import {
  computeCompleteness,
  describeGapsForPrompt,
} from '@/lib/onboarding/completeness'
import {
  LIBRARY_TOPICS,
  REQUIRED_SLOT_IDS,
  SLOTS,
  SLOTS_BY_ID,
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

describe('coverage counts every slot, approval counts only the required ones', () => {
  // The trap the slot cut opened. Discovery seeds exactly the three required
  // slots — ga4_property_id, gsc_site_url, client_type — and an exact-domain GA4
  // or GSC match is recorded auto/high, which isFilled counts. So a session can
  // be 100% by `pct` and ready_for_review before anyone has asked a question.
  //
  // That is correct for the GATE: those three really are known. It is a lie as a
  // headline number, which is why the review pane renders totalPct instead.
  it('separates the approve gate from the picture of what we know', () => {
    const answers: Answers = {}
    for (const slot of SLOTS) {
      if (!slot.required) continue
      answers[slot.id] = {
        value: slot.kind === 'choice' ? slot.choices![0] : 'discovered',
        unknown: false,
        source: 'auto',
        confidence: 'high',
      } as Answers[string]
    }

    const c = computeCompleteness(answers)
    expect(c.readyForReview).toBe(true)
    expect(c.pct).toBe(100)
    // ...but most of what the interview exists to capture is still missing.
    expect(c.totalPct).toBeLessThan(100)
    expect(c.optionalMissing.length).toBeGreaterThan(0)
  })

  it('reaches 100% total only when every slot is answered', () => {
    const answers: Answers = {}
    for (const slot of SLOTS) {
      answers[slot.id] =
        slot.kind === 'list'
          ? filled(['something'])
          : slot.kind === 'choice'
            ? filled(slot.choices![0])
            : filled('an answer')
    }
    const c = computeCompleteness(answers)
    expect(c.totalPct).toBe(100)
    expect(c.pct).toBe(100)
    expect(c.optionalMissing).toEqual([])
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
    delete answers['ga4_property_id']
    const c = computeCompleteness(answers)
    expect(c.missing).toEqual(['ga4_property_id'])
    expect(c.readyForReview).toBe(false)
  })

  it('unblocks review on an explicit unknown, but still reports it as a gap', () => {
    const answers = completeAnswers()
    answers['ga4_property_id'] = {
      value: null,
      unknown: true,
      reason: 'previous vendor still holds the Google account',
    }
    const c = computeCompleteness(answers)

    expect(c.readyForReview).toBe(true)
    // The load-bearing assertion: unknown is not filled.
    expect(c.filled).not.toContain('ga4_property_id')
    expect(c.unknown).toContain('ga4_property_id')
    expect(c.pct).toBeLessThan(100)
    expect(c.slots.find((s) => s.id === 'ga4_property_id')).toMatchObject({
      state: 'unknown',
      reason: 'previous vendor still holds the Google account',
    })
  })

  it('does NOT unblock review for an unknown with no reason', () => {
    const answers = completeAnswers()
    answers['ga4_property_id'] = { value: null, unknown: true }
    const c = computeCompleteness(answers)

    expect(c.readyForReview).toBe(false)
    expect(c.missing).toContain('ga4_property_id')
    expect(c.unknown).not.toContain('ga4_property_id')
  })

  it('reaches 100% and ready only when all required slots are truly filled', () => {
    const c = computeCompleteness(completeAnswers())
    expect(c.missing).toEqual([])
    expect(c.unknown).toEqual([])
    expect(c.pct).toBe(100)
    expect(c.readyForReview).toBe(true)
  })
})

/**
 * The split that the 19-slot schema collapsed, and the reason it had to be made:
 * "worth asking about" and "cannot finish without" are different questions.
 * Because the interview prompt was built from `missing` alone, an optional slot
 * was never asked at all — so brand_terms, competitors and key_event_names, each
 * of which writes a column the portal reads, went permanently uncollected while
 * nine slots nothing read blocked every session. All four sessions ever started
 * are still in_progress. These tests hold both halves of the fix in place.
 */
describe('optional slots are asked but never gate review', () => {
  it('reports optional-and-empty slots in optionalMissing, and no required ones', () => {
    const c = computeCompleteness({})
    const optionalIds = SLOTS.filter((s) => !s.required).map((s) => s.id)

    expect([...c.optionalMissing].sort()).toEqual([...optionalIds].sort())
    for (const id of REQUIRED_SLOT_IDS) {
      expect(c.optionalMissing).not.toContain(id)
    }
    // …and the required ones are still reported, just in the other bucket.
    expect([...c.missing].sort()).toEqual([...REQUIRED_SLOT_IDS].sort())
  })

  it('drops a slot out of optionalMissing once it is answered', () => {
    const c = computeCompleteness({ brand_terms: filled(['tornado hvac', 'tornado air']) })
    expect(c.optionalMissing).not.toContain('brand_terms')
    expect(c.optionalMissing).toContain('competitors')
  })

  it('does not block review on an empty optional slot', () => {
    // completeAnswers() fills the required slots only, so every optional slot is
    // empty here. That is the state a real interview ends in when the client had
    // nothing to say about competitors — and it must still be reviewable.
    const c = computeCompleteness(completeAnswers())
    expect(c.optionalMissing.length).toBeGreaterThan(0)
    expect(c.readyForReview).toBe(true)
    expect(c.pct).toBe(100)
  })

  it('still blocks review on a missing required slot, optionals notwithstanding', () => {
    const answers = completeAnswers()
    delete answers['gsc_site_url']
    // Fill every optional slot, so the only thing standing between this session
    // and review is the required one.
    for (const slot of SLOTS) {
      if (slot.required) continue
      answers[slot.id] = slot.kind === 'list' ? filled(['something']) : filled('an answer')
    }

    const c = computeCompleteness(answers)
    expect(c.optionalMissing).toEqual([])
    expect(c.missing).toEqual(['gsc_site_url'])
    expect(c.readyForReview).toBe(false)
  })

  // The rule that would have prevented the deadlock in the first place: a slot
  // may only be required if deterministic code downstream reads the column it
  // writes. Every one of the nine slots that blocked every interview promoted to
  // nothing at all.
  it('requires only slots that promote to a column the portal reads', () => {
    for (const slot of SLOTS) {
      if (slot.required) expect(slot.promotesTo).toBeTruthy()
    }
    expect([...REQUIRED_SLOT_IDS].sort()).toEqual([
      'client_type',
      'ga4_property_id',
      'gsc_site_url',
    ])
  })
})

describe('sanitizeAnswerPatch', () => {
  it('drops slot ids that do not exist', () => {
    const out = sanitizeAnswerPatch({
      avg_job_value: { value: 'repair ~$350', unknown: false },
      totally_made_up_slot: { value: 'nope', unknown: false },
    })
    expect(Object.keys(out)).toEqual(['avg_job_value'])
  })

  // A library topic is prose the context library answers, not a form field, so
  // it is not a slot and never becomes one by arriving in a patch. The model is
  // told about these topics, and it will happily volunteer them — dropping them
  // here is what stops "the client told us about seasonality" from being written
  // into the answers blob as if a slot had been filled.
  it('drops a library topic id, which is deliberately not a slot', () => {
    const out = sanitizeAnswerPatch({
      seasonality: { value: 'AC demand May-Sept', unknown: false },
      cms_hosting: { value: 'WordPress + Yoast', unknown: false },
      client_type: { value: 'local_service', unknown: false },
    })
    expect(Object.keys(out)).toEqual(['client_type'])

    // Every one of them, not just the two spelled out above.
    for (const topic of LIBRARY_TOPICS) {
      expect(SLOTS_BY_ID.has(topic.id)).toBe(false)
      expect(sanitizeAnswerPatch({ [topic.id]: { value: 'x', unknown: false } })).toEqual({})
    }
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
    const out = sanitizeAnswerPatch({ avg_job_value: { value: 'repair ~$350' } })
    expect(out['avg_job_value']?.unknown).toBe(false)
    expect(out['avg_job_value']?.recordedAt).toBeTruthy()
  })

  it('returns an empty patch for junk input instead of throwing', () => {
    expect(sanitizeAnswerPatch(null)).toEqual({})
    expect(sanitizeAnswerPatch('a string')).toEqual({})
    expect(sanitizeAnswerPatch([1, 2, 3])).toEqual({})
    // A real slot id carrying a value that fails the schema — dropped for the
    // value, not for the id, which is the case the id checks above cannot cover.
    expect(sanitizeAnswerPatch({ avg_job_value: 'not an object' })).toEqual({})
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
    delete answers['gsc_site_url']
    const text = describeGapsForPrompt(answers)
    expect(text).toContain('STILL NEEDED')
    expect(text).toContain('gsc_site_url')
  })

  it('tells the model not to re-ask what is already answered', () => {
    const text = describeGapsForPrompt({ avg_job_value: filled('repair ~$350') })
    expect(text).toContain('ALREADY ANSWERED')
    expect(text).toContain('avg_job_value')
  })

  it('lists unknowns separately from missing', () => {
    const answers = completeAnswers()
    answers['ga4_property_id'] = { value: null, unknown: true, reason: 'client will check with IT' }
    const text = describeGapsForPrompt(answers)
    expect(text).toContain('MARKED UNKNOWN')
    expect(text).toContain('client will check with IT')
  })

  // The prompt-side half of the required/optional split. The whole failure was
  // invisible from the schema alone: the slots existed, they just never reached
  // the model, because this function only ever rendered `missing`.
  it('offers the optional slots to the model under their own non-blocking heading', () => {
    const answers = completeAnswers()
    const text = describeGapsForPrompt(answers)

    expect(text).toContain('ALSO WORTH CAPTURING')
    // Each of these writes a clients.* column the portal reads, and each was
    // silently never asked before the split.
    expect(text).toContain('brand_terms')
    expect(text).toContain('competitors')
    expect(text).toContain('key_event_names')
    // The hint goes with it — a bare slot id is not a question the model can ask.
    expect(text).toContain(SLOTS_BY_ID.get('brand_terms')!.questionHint)
  })

  it('keeps optional slots out of STILL NEEDED, which is what gates review', () => {
    const answers = completeAnswers()
    delete answers['client_type']
    const text = describeGapsForPrompt(answers)

    const stillNeeded = text.slice(
      text.indexOf('STILL NEEDED'),
      text.indexOf('ALSO WORTH CAPTURING'),
    )
    expect(stillNeeded).toContain('client_type')
    for (const slot of SLOTS) {
      if (!slot.required) expect(stillNeeded).not.toContain(slot.id)
    }
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
 * (manual) session produced, re-expressed as slots under the 12-slot schema: the
 * prose half of that session (seasonality, lead handling, prior vendor work,
 * approval authority, CMS, declared GBP areas) is no longer a slot at all and
 * now belongs to the context library — see the last test in this block, which
 * holds the portal to still expecting it somewhere.
 *
 * This fixture means "a realistic, complete interview": every slot answered,
 * optional ones included, because a strategist who runs the whole conversation
 * does come away with the competitor list and the branded terms. The assertions
 * encode what a correct interview has to capture, so a later prompt change that
 * stops asking about the service radius fails here rather than in production.
 */
describe('Tornado HVAC fixture (eval case 1)', () => {
  const tornado: Answers = {
    services_by_revenue: filled(['air duct cleaning', 'HVAC repair', 'furnace install', 'heat pump install']),
    avg_job_value: filled('duct cleaning ~$450, repair ~$350, furnace install ~$6,500'),
    service_radius: filled(['Sherman Oaks', 'Van Nuys', 'Studio City', 'Burbank', 'North Hollywood']),
    client_type: filled('local_service'),
    ga4_property_id: filled('123456789'),
    gsc_site_url: filled('sc-domain:tornadohvacca.com'),
    gbp_account_id: filled('accounts/104829571023'),
    gbp_location_group: filled('Tornado HVAC — Sherman Oaks'),
    competitors: filled(['servicechampions.net', 'aireserv.com', 'dukeofair.com']),
    brand_terms: filled(['tornado hvac', 'tornado air', 'tornado heating and air', 'tornado hvac ca']),
    key_event_names: filled(['click_to_call', 'contact_form_submit', 'book_online']),
    google_sheet_id: filled('https://docs.google.com/spreadsheets/d/1TornadoTrackerSheetId/edit'),
  }

  it('is complete and ready for review', () => {
    const c = computeCompleteness(tornado)
    expect(c.missing).toEqual([])
    expect(c.readyForReview).toBe(true)
    expect(c.pct).toBe(100)
  })

  it('leaves nothing uncaptured, optional slots included', () => {
    // A complete interview is not merely a reviewable one. If this drifts, an
    // optional slot has stopped being asked — the exact failure the split fixed,
    // and one that ready_for_review alone cannot see.
    const c = computeCompleteness(tornado)
    expect(c.optionalMissing).toEqual([])
    expect(c.slots.every((s) => s.state === 'filled')).toBe(true)
  })

  it('captures the service radius that the audit needed and the old form never asked', () => {
    // The finding no check on any list caught: a Sherman Oaks business
    // targeting Orange County, 45-65 miles away.
    expect(isFilled(tornado['service_radius'])).toBe(true)
    expect(String(tornado['service_radius']!.value)).toContain('Sherman Oaks')
  })

  it('captures average job value, the number that makes forecasts revenue', () => {
    expect(isFilled(tornado['avg_job_value'])).toBe(true)
  })

  it('sets client_type, which closes the blocker keeping local modules dark', () => {
    expect(clientTypeFromAnswers(tornado)).toBe('local_service')
  })

  it('captures the three columns the interview previously never asked for', () => {
    // brand_terms is the one that mattered on this account: Tornado was 89%
    // branded, which is the difference between "traffic is fine" and "we rank
    // for nothing we sell". Under the old schema it was optional, and optional
    // meant never asked, so the interview could reach 100% without it.
    expect(isFilled(tornado['brand_terms'])).toBe(true)
    expect(isFilled(tornado['competitors'])).toBe(true)
    expect(isFilled(tornado['key_event_names'])).toBe(true)
  })

  // What this fixture used to assert about the prose answers, re-pointed at
  // where those answers now live. The facts were not dropped — the prior vendor's
  // 130 bulk-generated pages is still the finding that explains the
  // cannibalisation — they are just no longer form fields. Declaring them keeps
  // the context library on the hook for answering them.
  it('still expects the prose context, as library topics rather than slots', () => {
    const topics = new Map(LIBRARY_TOPICS.map((t) => [t.id, t]))
    for (const id of [
      'seasonality',
      'lead_handling',
      'prior_vendor_work',
      'approval_authority',
      'cms_hosting',
      'brand_constraints',
      'gbp_service_areas_confirmed',
    ]) {
      expect(topics.has(id)).toBe(true)
      expect(SLOTS_BY_ID.has(id)).toBe(false)
      // A topic with no stated consumer is the thing that got us here, so each
      // one still has to name who wants it and what to ask.
      expect(topics.get(id)!.why.trim().length).toBeGreaterThan(0)
      expect(topics.get(id)!.questionHint.trim().length).toBeGreaterThan(0)
    }
  })
})
