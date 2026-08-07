import { describe, expect, it, vi } from 'vitest'
import {
  buildExtractionPrompts,
  evidenceQuotesSource,
  extractSlotValues,
  parseModelJson,
  valueMatchesKind,
  validateExtractions,
  type CallModel,
  type ContextItem,
} from '@/lib/onboarding/extract'
import { SLOTS_BY_ID, isFilled } from '@/lib/onboarding/schema'

/** The source everything is quoted from. Verbatim matters here. */
const TRANSCRIPT_BODY = `Strategist: Which services actually bring the money in?
Owner: Honestly it's air duct cleaning first, then HVAC repair, then furnace installs.
Strategist: And roughly what does a job bill for?
Owner: Duct cleaning runs about $450, a repair is around $350.
Strategist: Where do your guys actually drive?
Owner: Sherman Oaks, Van Nuys, Studio City. We don't go past Burbank.
Strategist: And the site?
Owner: It's WordPress, our nephew hosts it somewhere.`

const item = (overrides: Partial<ContextItem> = {}): ContextItem => ({
  id: 'item-1',
  kind: 'meeting_transcript',
  title: 'Kickoff call',
  body: TRANSCRIPT_BODY,
  occurredAt: '2026-08-01',
  ...overrides,
})

const ITEMS = [item()]

/**
 * Every slot referenced below is treated as still open.
 *
 * All four are real entries in SLOTS. The prose questions this fixture used to
 * name — seasonality, cms_hosting — are LIBRARY_TOPICS now, not slots, so they
 * would be rejected as `unknown_slot` and would silently stop testing whatever
 * they were standing in for.
 */
const OPEN = ['services_by_revenue', 'avg_job_value', 'service_radius', 'client_type']

/** A stub model that returns whatever payload the test hands it. */
const stubModel = (payload: unknown): CallModel =>
  vi.fn(async () =>
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  )

const goodServices = {
  slotId: 'services_by_revenue',
  value: ['air duct cleaning', 'HVAC repair', 'furnace installs'],
  confidence: 'high',
  evidence: "it's air duct cleaning first, then HVAC repair, then furnace installs",
  sourceItemId: 'item-1',
}

const goodJobValue = {
  slotId: 'avg_job_value',
  value: 'Duct cleaning ~$450, repair ~$350',
  confidence: 'medium',
  evidence: 'Duct cleaning runs about $450, a repair is around $350.',
  sourceItemId: 'item-1',
}

describe('evidenceQuotesSource', () => {
  it('accepts a verbatim span', () => {
    expect(evidenceQuotesSource('Sherman Oaks, Van Nuys, Studio City', TRANSCRIPT_BODY)).toBe(true)
  })

  // A model reflowing whitespace or swapping in a curly apostrophe has not
  // fabricated anything, so the check is forgiving about exactly those.
  it('tolerates case, whitespace and smart-quote differences', () => {
    expect(evidenceQuotesSource('SHERMAN OAKS,   van nuys, Studio City', TRANSCRIPT_BODY)).toBe(true)
    expect(evidenceQuotesSource('we don’t go past Burbank', TRANSCRIPT_BODY)).toBe(true)
  })

  it('rejects a paraphrase, which is the fabrication that matters', () => {
    expect(
      evidenceQuotesSource('The owner said they serve the San Fernando Valley', TRANSCRIPT_BODY),
    ).toBe(false)
  })

  it('rejects empty evidence', () => {
    expect(evidenceQuotesSource('   ', TRANSCRIPT_BODY)).toBe(false)
  })

  // DOCUMENTS PRESENT BEHAVIOUR — this is not an endorsement of it.
  //
  // The check is a normalized substring match, so it has no notion that "30"
  // and "thirty" name the same fact. A model that helpfully digitises a spoken
  // number has not fabricated anything, but its quote is rejected all the same.
  // Recorded rather than fixed because the error runs in the safe direction: a
  // false REJECTION costs one suggestion the admin can still type in by hand,
  // where a false ACCEPT would put an invented quote in front of a reviewer and
  // hollow out the confirmation step this module exists to feed. If the check
  // is ever taught about numerals, this expectation is the one to flip.
  it('rejects a numeral where the source spelled the number out (present behaviour)', () => {
    const source = 'Owner: we run about thirty trucks out of the Van Nuys yard.'
    expect(evidenceQuotesSource('we run about 30 trucks', source)).toBe(false)
    // The same span copied verbatim is accepted, which pins the rejection on
    // the substitution alone rather than on anything else in the sentence.
    expect(evidenceQuotesSource('we run about thirty trucks', source)).toBe(true)
  })
})

describe('valueMatchesKind', () => {
  it('requires a list slot to hold an array of strings', () => {
    const slot = SLOTS_BY_ID.get('services_by_revenue')!
    expect(valueMatchesKind(slot, ['a', 'b'])).toBe(true)
    expect(valueMatchesKind(slot, 'a, b')).toBe(false)
    expect(valueMatchesKind(slot, ['a', 3])).toBe(false)
  })

  it('requires a text slot to hold a string', () => {
    const slot = SLOTS_BY_ID.get('avg_job_value')!
    expect(valueMatchesKind(slot, 'Duct cleaning ~$450')).toBe(true)
    expect(valueMatchesKind(slot, ['Duct cleaning ~$450'])).toBe(false)
  })
})

describe('parseModelJson', () => {
  it('reads a bare object, a fenced block, and prose-wrapped JSON', () => {
    expect(parseModelJson('{"extractions":[]}')).toEqual({ extractions: [] })
    expect(parseModelJson('```json\n{"extractions":[]}\n```')).toEqual({ extractions: [] })
    expect(parseModelJson('Here you go:\n{"extractions":[]}\nHope that helps.')).toEqual({
      extractions: [],
    })
  })

  it('returns null rather than throwing on junk', () => {
    expect(parseModelJson('I could not find anything.')).toBeNull()
    expect(parseModelJson('{not json at all')).toBeNull()
  })
})

describe('validateExtractions', () => {
  it('accepts a clean extraction and stamps it as a context suggestion', () => {
    const out = validateExtractions({ extractions: [goodServices, goodJobValue] }, ITEMS, OPEN)

    expect(out.accepted.sort()).toEqual(['avg_job_value', 'services_by_revenue'])
    expect(out.rejected).toEqual([])
    expect(out.answers['services_by_revenue']).toMatchObject({
      value: ['air duct cleaning', 'HVAC repair', 'furnace installs'],
      source: 'context',
      confidence: 'high',
    })
    expect(out.answers['avg_job_value']?.evidence).toContain('$450')
  })

  it('drops an unknown slot id', () => {
    const out = validateExtractions(
      {
        extractions: [
          goodServices,
          { ...goodServices, slotId: 'totally_made_up_slot' },
        ],
      },
      ITEMS,
      OPEN,
    )
    expect(out.accepted).toEqual(['services_by_revenue'])
    expect(out.rejected).toEqual([{ slotId: 'totally_made_up_slot', reason: 'unknown_slot' }])
  })

  it('drops a wrong-typed value (a string where a list belongs)', () => {
    const out = validateExtractions(
      {
        extractions: [
          {
            ...goodServices,
            value: 'air duct cleaning, HVAC repair, furnace installs',
          },
        ],
      },
      ITEMS,
      OPEN,
    )
    expect(out.accepted).toEqual([])
    expect(out.rejected[0]).toMatchObject({
      slotId: 'services_by_revenue',
      reason: 'wrong_type',
    })
  })

  it('drops a choice value outside the slot’s declared choices', () => {
    const body = 'Owner: we are basically a plumbing empire at this point.'
    const out = validateExtractions(
      {
        extractions: [
          {
            slotId: 'client_type',
            value: 'plumbing_empire',
            confidence: 'high',
            evidence: 'we are basically a plumbing empire',
            sourceItemId: 'item-2',
          },
        ],
      },
      [item({ id: 'item-2', body })],
      OPEN,
    )
    expect(out.accepted).toEqual([])
    expect(out.rejected).toEqual([{ slotId: 'client_type', reason: 'invalid_choice' }])
  })

  it('drops an item with no evidence at all', () => {
    const out = validateExtractions(
      { extractions: [{ ...goodServices, evidence: '   ' }] },
      ITEMS,
      OPEN,
    )
    expect(out.accepted).toEqual([])
    expect(out.rejected).toEqual([
      { slotId: 'services_by_revenue', reason: 'missing_evidence' },
    ])
  })

  // The check that does not exist anywhere else in the codebase, and the one
  // the whole human-confirmation step rests on: a plausible quote that was
  // never said. Without this, review is confirming the model's fluency.
  //
  // The slot here is one the transcript DOES discuss, and the invented quote
  // borrows its vocabulary — "furnace install", a dollar figure, the Owner
  // speaker label. That is the realistic shape of the failure: not a quote about
  // some unrelated topic, but a real topic embellished with a number nobody gave.
  it('drops fabricated evidence that is not present in the source', () => {
    const out = validateExtractions(
      {
        extractions: [
          {
            slotId: 'avg_job_value',
            value: 'Furnace install ~$1,200',
            confidence: 'high',
            evidence: 'Owner: a furnace install runs about $1,200 all in.',
            sourceItemId: 'item-1',
          },
        ],
      },
      ITEMS,
      OPEN,
    )
    expect(out.accepted).toEqual([])
    expect(out.rejected[0]).toMatchObject({
      slotId: 'avg_job_value',
      reason: 'evidence_not_in_source',
    })
  })

  it('drops a value attributed to a source item that was never sent', () => {
    // An unverifiable quote is treated exactly like a false one.
    const out = validateExtractions(
      { extractions: [{ ...goodServices, sourceItemId: 'item-99' }] },
      ITEMS,
      OPEN,
    )
    expect(out.accepted).toEqual([])
    expect(out.rejected[0]).toMatchObject({ reason: 'unknown_source_item' })
  })

  it('drops a suggestion for a slot that is not open', () => {
    // The open list names a different real slot, so services_by_revenue is a
    // valid slot that has already been answered — the case where a transcript
    // would otherwise overwrite something a human confirmed.
    const out = validateExtractions({ extractions: [goodServices] }, ITEMS, ['avg_job_value'])
    expect(out.accepted).toEqual([])
    expect(out.rejected).toEqual([
      { slotId: 'services_by_revenue', reason: 'already_answered' },
    ])
  })

  it('survives malformed entries instead of failing the batch', () => {
    const out = validateExtractions(
      { extractions: [null, 'nope', { value: 'x' }, goodServices] },
      ITEMS,
      OPEN,
    )
    expect(out.accepted).toEqual(['services_by_revenue'])
    expect(out.rejected).toHaveLength(3)
  })

  it('defaults an unrecognised confidence to low rather than dropping the item', () => {
    const out = validateExtractions(
      { extractions: [{ ...goodServices, confidence: 'extremely' }] },
      ITEMS,
      OPEN,
    )
    expect(out.answers['services_by_revenue']?.confidence).toBe('low')
  })
})

// The load-bearing property of this entire module.
describe('everything extracted is a suggestion, never an answer', () => {
  it('marks every surviving value source: context, which isFilled refuses', () => {
    const out = validateExtractions(
      { extractions: [goodServices, goodJobValue] },
      ITEMS,
      OPEN,
    )

    expect(Object.keys(out.answers).length).toBeGreaterThan(0)
    for (const [slotId, value] of Object.entries(out.answers)) {
      expect(value.source, slotId).toBe('context')
      // Not a restatement of isFilled's unit test: this asserts the seam. If a
      // future change here stamped 'interview' to "save the admin a click", a
      // transcript would silently satisfy a required slot and unlock approval.
      expect(isFilled(value), slotId).toBe(false)
    }
  })
})

describe('extractSlotValues', () => {
  it('calls the model once and returns validated suggestions', async () => {
    const callModel = stubModel({ extractions: [goodServices] })
    const out = await extractSlotValues(ITEMS, OPEN, { callModel })

    expect(callModel).toHaveBeenCalledTimes(1)
    expect(out.accepted).toEqual(['services_by_revenue'])
    expect(out.unparseable).toBe(false)
    expect(isFilled(out.answers['services_by_revenue'])).toBe(false)
  })

  it('reports an unparseable response as a visible no-op, not a throw', async () => {
    const out = await extractSlotValues(ITEMS, OPEN, {
      callModel: stubModel('I was unable to find anything useful.'),
    })
    expect(out.unparseable).toBe(true)
    expect(out.answers).toEqual({})
  })

  it('does not call the model when there is nothing to read or nothing open', async () => {
    const callModel = stubModel({ extractions: [goodServices] })

    expect((await extractSlotValues([], OPEN, { callModel })).accepted).toEqual([])
    expect((await extractSlotValues(ITEMS, [], { callModel })).accepted).toEqual([])
    // Blank bodies are not context.
    expect(
      (await extractSlotValues([item({ body: '   ' })], OPEN, { callModel })).accepted,
    ).toEqual([])
    expect(callModel).not.toHaveBeenCalled()
  })

  it('ignores slot ids the caller invented rather than prompting for them', async () => {
    let seen = ''
    const callModel: CallModel = async ({ system }) => {
      seen = system
      return '{"extractions":[]}'
    }
    await extractSlotValues(ITEMS, ['avg_job_value', 'not_a_slot'], { callModel })
    expect(seen).toContain('avg_job_value')
    expect(seen).not.toContain('not_a_slot')
  })
})

describe('buildExtractionPrompts', () => {
  it('sends each item with its id so evidence can be attributed', () => {
    const { user } = buildExtractionPrompts(ITEMS, OPEN)
    expect(user).toContain('id: item-1')
    expect(user).toContain('kind: meeting_transcript')
    expect(user).toContain('Sherman Oaks')
  })

  it('lists the open slots and their allowed choices', () => {
    const { system } = buildExtractionPrompts(ITEMS, ['client_type'])
    expect(system).toContain('client_type')
    expect(system).toContain('local_service')
    // A slot that is not open must not be offered.
    expect(system).not.toContain('services_by_revenue')
  })
})
