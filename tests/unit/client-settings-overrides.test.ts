import { describe, expect, it } from 'vitest'
import { SLOTS, isFilled, sanitizeSessionAnswers, type Answers } from '@/lib/onboarding/schema'
import { buildClientUpdate } from '@/lib/onboarding/promote'
import { computeCompleteness } from '@/lib/onboarding/completeness'

/**
 * The settings-side half of the override contract.
 *
 * app/actions/clients.ts is a 'use server' module and cannot be imported here,
 * so recordManualOverrides is reproduced below EXACTLY as it behaves there. That
 * is a real limitation worth naming: this file proves the rule is right, not
 * that the action implements it. The end-to-end proof that the override reaches
 * promote is the round-trip test at the bottom, which feeds this output straight
 * into buildClientUpdate — the same shape approveOnboardingSession passes.
 */

const SHARED_SLOTS = SLOTS.filter((s) => !!s.promotesTo).map((s) => ({
  slotId: s.id,
  column: s.promotesTo!,
}))

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (v: unknown) =>
      (Array.isArray(v) ? v : [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .sort()
    const [x, y] = [norm(a), norm(b)]
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
  return norm(a) === norm(b)
}

function recordManualOverrides(
  before: unknown,
  submitted: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!before || typeof before !== 'object') return null
  const row = before as Record<string, unknown>
  const context = (row.service_context ?? {}) as Record<string, unknown>
  const answers = { ...((context.answers ?? {}) as Record<string, unknown>) }

  let changed = false
  for (const { slotId, column } of SHARED_SLOTS) {
    if (!(column in submitted)) continue
    if (sameValue(submitted[column], row[column])) continue
    answers[slotId] = {
      value: (submitted[column] ?? null) as never,
      unknown: false,
      source: 'manual',
      confidence: 'high',
      evidence: 'Set by hand in client settings',
      recordedAt: new Date().toISOString(),
    }
    changed = true
  }
  return changed ? { ...context, answers } : null
}

describe('recording a manual override', () => {
  it('records only the fields that actually changed', () => {
    const before = {
      service_context: { answers: {}, sessionId: 's1' },
      ga4_property_id: 'properties/111',
      gsc_site_url: 'https://acme.com',
    }
    const ctx = recordManualOverrides(before, {
      ga4_property_id: 'properties/999', // changed
      gsc_site_url: 'https://acme.com', // untouched
    })
    const answers = ctx!.answers as Answers
    expect(answers['ga4_property_id']?.source).toBe('manual')
    expect(answers['gsc_site_url']).toBeUndefined()
  })

  // The rule that keeps the feature usable. If merely saving the form froze
  // every field as an override, the first save would permanently detach the
  // client from setup and nothing could ever update it again.
  it('returns null when nothing changed, so an untouched save writes no context', () => {
    const before = {
      service_context: { answers: {} },
      ga4_property_id: 'properties/111',
      competitors: ['a', 'b'],
    }
    expect(
      recordManualOverrides(before, {
        ga4_property_id: 'properties/111',
        competitors: ['b', 'a'], // same set, different order
      }),
    ).toBeNull()
  })

  it('preserves the rest of service_context', () => {
    const before = {
      service_context: {
        answers: { service_radius: { value: '30 miles', unknown: false, source: 'interview' } },
        gaps: [{ slot: 'avg_job_value', reason: 'client does not track it' }],
        completenessPct: 80,
        sessionId: 's1',
      },
      ga4_property_id: null,
    }
    const ctx = recordManualOverrides(before, { ga4_property_id: 'properties/999' })!
    expect(ctx.completenessPct).toBe(80)
    expect(ctx.sessionId).toBe('s1')
    expect(ctx.gaps).toHaveLength(1)
    expect((ctx.answers as Answers)['service_radius']?.source).toBe('interview')
  })

  it('records a blank as a released override rather than dropping the key', () => {
    const before = {
      service_context: {
        answers: { ga4_property_id: { value: 'properties/111', unknown: false, source: 'manual' } },
      },
      ga4_property_id: 'properties/111',
    }
    const ctx = recordManualOverrides(before, { ga4_property_id: null })!
    const released = (ctx.answers as Answers)['ga4_property_id']
    expect(released?.source).toBe('manual')
    // Not filled → promote treats it as released, so setup can fill it again.
    expect(isFilled(released)).toBe(false)
  })
})

describe('override round trip: settings write → promote read', () => {
  const answered = (): Answers => {
    const a: Answers = {}
    for (const slot of SLOTS) {
      if (!slot.required) continue
      a[slot.id] = {
        value: slot.kind === 'list' ? ['x'] : slot.kind === 'choice' ? slot.choices![0] : 'y',
        unknown: false,
        source: 'interview',
      } as Answers[string]
    }
    a['ga4_property_id'] = {
      value: 'properties/FROM-INTERVIEW',
      unknown: false,
      source: 'interview',
    } as Answers[string]
    return a
  }

  it('a hand-typed GA4 property survives an interview approve', () => {
    const ctx = recordManualOverrides(
      { service_context: { answers: {} }, ga4_property_id: 'properties/OLD' },
      { ga4_property_id: 'properties/BY-HAND' },
    )

    const answers = answered()
    const update = buildClientUpdate(answers, computeCompleteness(answers), 's1', 'now', ctx)

    // The column is left alone entirely, not overwritten with the interview value.
    expect(update.ga4_property_id).toBeUndefined()
    // And the carried-forward provenance still says manual, so the badge matches.
    const ctxOut = update.service_context as { answers: Answers }
    expect(ctxOut.answers['ga4_property_id']?.source).toBe('manual')
    expect(ctxOut.answers['ga4_property_id']?.value).toBe('properties/BY-HAND')
  })

  it('a released override hands the field back to setup', () => {
    const ctx = recordManualOverrides(
      { service_context: { answers: {} }, ga4_property_id: 'properties/OLD' },
      { ga4_property_id: null },
    )

    const answers = answered()
    const update = buildClientUpdate(answers, computeCompleteness(answers), 's1', 'now', ctx)

    expect(update.ga4_property_id).toBe('properties/FROM-INTERVIEW')
  })
})

describe('a session draft can never mint a manual override', () => {
  // The laundering path: anything that can write a session — the interview model
  // included — must not be able to award itself the one source that outranks a
  // re-run.
  it('strips manual from a session-bound payload', () => {
    const out = sanitizeSessionAnswers({
      ga4_property_id: { value: 'properties/1', unknown: false, source: 'manual' },
    })
    expect(out['ga4_property_id']?.source).toBeUndefined()
  })

  it('forces interview for the model tool call, whatever it claimed', () => {
    const out = sanitizeSessionAnswers(
      { ga4_property_id: { value: 'properties/1', unknown: false, source: 'auto', confidence: 'high' } },
      { forceSource: 'interview' },
    )
    expect(out['ga4_property_id']?.source).toBe('interview')
  })

  it('leaves a genuine auto match alone on an admin edit', () => {
    const out = sanitizeSessionAnswers({
      ga4_property_id: {
        value: 'properties/1',
        unknown: false,
        source: 'auto',
        confidence: 'high',
        evidence: 'matched acme.com',
      },
    })
    expect(out['ga4_property_id']?.source).toBe('auto')
  })

  it('still refuses to count a context value that survives sanitization', () => {
    const out = sanitizeSessionAnswers({
      ga4_property_id: {
        value: 'properties/1',
        unknown: false,
        source: 'context',
        confidence: 'high',
        evidence: 'they mentioned it on the call',
      },
    })
    expect(out['ga4_property_id']?.source).toBe('context')
    expect(isFilled(out['ga4_property_id'])).toBe(false)
  })
})
