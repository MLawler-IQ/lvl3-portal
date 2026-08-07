import { describe, expect, it } from 'vitest'
import { computeCompleteness } from '@/lib/onboarding/completeness'
import { buildClientUpdate, type ServiceContext } from '@/lib/onboarding/promote'
import type { Answers } from '@/lib/onboarding/schema'
import { applyRecordAnswers } from '@/lib/onboarding/tools'

const filled = (value: unknown): Answers[string] =>
  ({ value, unknown: false } as Answers[string])

const APPROVED_AT = '2026-08-05T12:00:00.000Z'

function build(answers: Answers, priorContext?: unknown) {
  return buildClientUpdate(
    answers,
    computeCompleteness(answers),
    'sess-1',
    APPROVED_AT,
    priorContext,
  )
}

/** A previously-saved clients.service_context carrying manual overrides. */
const priorWith = (answers: Answers) =>
  ({
    answers,
    gaps: [],
    completenessPct: 100,
    approvedAt: '2026-01-01T00:00:00.000Z',
    sessionId: 'sess-0',
  }) as ServiceContext

const manual = (value: unknown): Answers[string] =>
  ({ value, unknown: false, source: 'manual' } as Answers[string])

describe('buildClientUpdate — access field promotion', () => {
  it('promotes a valid client_type', () => {
    expect(build({ client_type: filled('local_service') }).client_type).toBe('local_service')
  })

  it('omits client_type entirely when it is not a valid choice', () => {
    // sanitizeAnswerPatch would normally reject this upstream; belt and braces.
    const update = build({ client_type: filled('plumbing_empire') })
    expect('client_type' in update).toBe(false)
  })

  it('promotes GA4, GSC and GBP identifiers, trimmed', () => {
    const update = build({
      ga4_property_id: filled('  123456789  '),
      gsc_site_url: filled('sc-domain:tornadohvacca.com'),
      gbp_account_id: filled('accounts/999'),
    })
    expect(update.ga4_property_id).toBe('123456789')
    expect(update.gsc_site_url).toBe('sc-domain:tornadohvacca.com')
    expect(update.gbp_account_id).toBe('accounts/999')
  })

  it('normalizes a pasted Google Sheet URL down to the id', () => {
    const update = build({
      google_sheet_id: filled('https://docs.google.com/spreadsheets/d/ABC123xyz/edit#gid=0'),
    })
    expect(update.google_sheet_id).toBe('ABC123xyz')
  })

  it('accepts competitors as an array or a comma-separated string', () => {
    expect(build({ competitors: filled(['a.com', 'b.com']) }).competitors).toEqual(['a.com', 'b.com'])
    expect(build({ competitors: filled('a.com, b.com') }).competitors).toEqual(['a.com', 'b.com'])
  })

  it('drops blank entries from a competitor list rather than writing them', () => {
    expect(build({ competitors: filled(['a.com', '   ', '']) }).competitors).toEqual(['a.com'])
  })

  it('promotes the other list columns the intake form used to set', () => {
    const update = build({
      brand_terms: filled(['tornado hvac', 'tornadohvac']),
      key_event_names: filled('generate_lead, phone_call'),
    })
    expect(update.brand_terms).toEqual(['tornado hvac', 'tornadohvac'])
    expect(update.key_event_names).toEqual(['generate_lead', 'phone_call'])
  })

  it('promotes gbp_location_group, which scopes GBP to one client', () => {
    expect(build({ gbp_location_group: filled('Ungrouped') }).gbp_location_group).toBe('Ungrouped')
  })

  it('omits each list column when its slot was not answered', () => {
    const update = build({ competitors: filled(['a.com']) })
    expect('brand_terms' in update).toBe(false)
    expect('key_event_names' in update).toBe(false)
    expect('gbp_location_group' in update).toBe(false)
  })
})

describe('buildClientUpdate — never clobber live config', () => {
  // The load-bearing property of this file. An interview that could not confirm
  // a GA4 property must leave the existing one alone, not null it. Absent keys
  // in the patch mean "untouched" to Supabase's .update().
  it('omits a slot the client could not answer', () => {
    const update = build({
      ga4_property_id: { value: null, unknown: true, reason: 'client will send it later' },
    })
    expect('ga4_property_id' in update).toBe(false)
  })

  it('omits an empty-string slot', () => {
    const update = build({ gsc_site_url: filled('   ') })
    expect('gsc_site_url' in update).toBe(false)
  })

  it('omits every access field when nothing was answered', () => {
    const update = build({})
    expect(Object.keys(update)).toEqual(['service_context'])
  })
})

describe('buildClientUpdate — service_context provenance', () => {
  it('carries unknown slots forward as named gaps with their reasons', () => {
    const answers: Answers = {
      seasonality: filled('summer peak'),
      avg_job_value: { value: null, unknown: true, reason: 'not tracked by service' },
    }
    const ctx = build(answers).service_context as ServiceContext

    expect(ctx.gaps).toEqual([{ slot: 'avg_job_value', reason: 'not tracked by service' }])
    expect(ctx.sessionId).toBe('sess-1')
    expect(ctx.approvedAt).toBe(APPROVED_AT)
    expect(ctx.answers.seasonality?.value).toBe('summer peak')
  })

  it('records a completeness percentage below 100 when a gap exists', () => {
    const ctx = build({
      avg_job_value: { value: null, unknown: true, reason: 'unknown' },
    }).service_context as ServiceContext
    expect(ctx.completenessPct).toBeLessThan(100)
  })

  it('reports no gaps when every answer is real', () => {
    const ctx = build({ seasonality: filled('summer') }).service_context as ServiceContext
    expect(ctx.gaps).toEqual([])
  })
})

describe('buildClientUpdate — manual overrides survive a re-run', () => {
  // The arbitration rule. Onboarding is authoritative for a column nobody has
  // touched by hand; a manual edit in settings is an explicit, recorded decision
  // and a later interview must not silently undo it.
  it('leaves an overridden column alone even when the interview answered it', () => {
    const update = build(
      { ga4_property_id: filled('999999999') },
      priorWith({ ga4_property_id: manual('123456789') }),
    )
    expect('ga4_property_id' in update).toBe(false)
  })

  it('overrides every one of the nine shared columns, not just the scalars', () => {
    const update = build(
      {
        client_type: filled('local_service'),
        ga4_property_id: filled('999'),
        gsc_site_url: filled('sc-domain:new.com'),
        gbp_account_id: filled('accounts/999'),
        gbp_location_group: filled('New Group'),
        google_sheet_id: filled('NEWSHEETID'),
        competitors: filled(['new-a.com']),
        brand_terms: filled(['new brand']),
        key_event_names: filled(['new_event']),
      },
      priorWith({
        client_type: manual('ecommerce'),
        ga4_property_id: manual('111'),
        gsc_site_url: manual('sc-domain:old.com'),
        gbp_account_id: manual('accounts/111'),
        gbp_location_group: manual('Old Group'),
        google_sheet_id: manual('OLDSHEETID'),
        competitors: manual(['old-a.com']),
        brand_terms: manual(['old brand']),
        key_event_names: manual(['old_event']),
      }),
    )
    expect(Object.keys(update)).toEqual(['service_context'])
  })

  it('carries the override forward into the new context so it survives the NEXT re-run too', () => {
    const ctx = build(
      { ga4_property_id: filled('999999999') },
      priorWith({ ga4_property_id: manual('123456789') }),
    ).service_context as ServiceContext

    expect(ctx.answers.ga4_property_id?.value).toBe('123456789')
    expect(ctx.answers.ga4_property_id?.source).toBe('manual')

    // Feed the result back in: the override must still hold.
    const second = build({ ga4_property_id: filled('999999999') }, ctx)
    expect('ga4_property_id' in second).toBe(false)
  })

  it('still promotes the slots that were NOT overridden', () => {
    const update = build(
      { ga4_property_id: filled('999'), gsc_site_url: filled('sc-domain:x.com') },
      priorWith({ ga4_property_id: manual('111') }),
    )
    expect('ga4_property_id' in update).toBe(false)
    expect(update.gsc_site_url).toBe('sc-domain:x.com')
  })

  // Guards the pre-existing behaviour: without a prior context, or with one that
  // records no manual edits, promotion is exactly what it always was.
  it('promotes normally when there is no prior context at all', () => {
    expect(build({ ga4_property_id: filled('123') }).ga4_property_id).toBe('123')
  })

  it('promotes normally over an interview-, auto- or context-sourced prior value', () => {
    for (const source of ['interview', 'auto', 'context'] as const) {
      const update = build(
        { ga4_property_id: filled('999') },
        priorWith({ ga4_property_id: { value: '111', unknown: false, source } }),
      )
      expect(update.ga4_property_id).toBe('999')
    }
  })

  it('ignores a malformed or empty prior context rather than throwing', () => {
    for (const prior of [null, undefined, 'nonsense', 42, {}, { answers: null }, { answers: 'x' }]) {
      expect(build({ ga4_property_id: filled('123') }, prior).ga4_property_id).toBe('123')
    }
  })

  // Clearing an override. Decision: an override is released by BLANKING the
  // field in settings, which records a manual value that is empty (or unknown).
  // An empty manual entry is not sticky, so the interview is free to fill the
  // column again. The alternative — sticky-forever until someone deletes the
  // JSON by hand — would mean a blanked field could never be re-populated by
  // onboarding, which is a trap with no visible cause.
  it('releases the override when the manual value has been blanked', () => {
    const update = build(
      { ga4_property_id: filled('999') },
      priorWith({ ga4_property_id: manual('   ') }),
    )
    expect(update.ga4_property_id).toBe('999')
  })

  it('releases the override when the manual entry was marked unknown', () => {
    const update = build(
      { ga4_property_id: filled('999') },
      priorWith({
        ga4_property_id: { value: '111', unknown: true, reason: 'no longer valid', source: 'manual' },
      }),
    )
    expect(update.ga4_property_id).toBe('999')
  })

  // Replacing an override: settings simply writes a new manual value, and that
  // newer one is what a promote must respect.
  it('respects the newest manual value when an override is replaced', () => {
    const update = build(
      { ga4_property_id: filled('999') },
      priorWith({ ga4_property_id: manual('222') }),
    )
    const ctx = update.service_context as ServiceContext
    expect(ctx.answers.ga4_property_id?.value).toBe('222')
  })

  // An override on a slot the interview never touched must not invent a column
  // write out of the prior context.
  it('does not promote an overridden slot the interview left empty', () => {
    const update = build({}, priorWith({ ga4_property_id: manual('111') }))
    expect(Object.keys(update)).toEqual(['service_context'])
  })
})

describe('buildClientUpdate — a context-sourced value never reaches a column', () => {
  // isFilled() rejects source 'context' at every confidence, permanently. This
  // is the load-bearing distinction of the whole phase: a sentence a model
  // generated from a transcript is a suggestion, not a fact, and must never
  // silently become live pipeline config.
  const ctxValue = (value: unknown, confidence: 'high' | 'medium' | 'low'): Answers[string] =>
    ({ value, unknown: false, source: 'context', confidence } as Answers[string])

  for (const confidence of ['high', 'medium', 'low'] as const) {
    it(`omits every shared column for a ${confidence}-confidence context value`, () => {
      const update = build({
        client_type: ctxValue('local_service', confidence),
        ga4_property_id: ctxValue('123456789', confidence),
        gsc_site_url: ctxValue('sc-domain:x.com', confidence),
        gbp_account_id: ctxValue('accounts/1', confidence),
        gbp_location_group: ctxValue('Ungrouped', confidence),
        google_sheet_id: ctxValue('SHEETID', confidence),
        competitors: ctxValue(['a.com'], confidence),
        brand_terms: ctxValue(['brand'], confidence),
        key_event_names: ctxValue(['generate_lead'], confidence),
      })
      expect(Object.keys(update)).toEqual(['service_context'])
    })
  }

  it('still records the context suggestion in service_context so a human can confirm it', () => {
    const ctx = build({
      ga4_property_id: { value: '123', unknown: false, source: 'context', evidence: 'from the kickoff notes' },
    }).service_context as ServiceContext
    expect(ctx.answers.ga4_property_id?.source).toBe('context')
    expect(ctx.answers.ga4_property_id?.evidence).toBe('from the kickoff notes')
  })
})

describe('applyRecordAnswers', () => {
  it('merges a patch onto existing answers without dropping earlier slots', () => {
    const current: Answers = { seasonality: filled('summer') }
    const result = applyRecordAnswers(
      { answers: { cms_hosting: { value: 'WordPress + Yoast' } } },
      current,
    )
    expect(Object.keys(result.answers).sort()).toEqual(['cms_hosting', 'seasonality'])
    expect(result.appliedIds).toEqual(['cms_hosting'])
    expect(result.rejected).toEqual([])
  })

  it('reports rejected slot ids back to the model so it can correct itself', () => {
    const result = applyRecordAnswers(
      {
        answers: {
          seasonality: { value: 'summer' },
          invented_slot: { value: 'x' },
        },
      },
      {},
    )
    expect(result.rejected).toEqual(['invented_slot'])
    expect(result.message).toContain('invented_slot')
    expect(result.answers.seasonality).toBeTruthy()
  })

  // Regression. `answers` used to be the applied DELTA, so a fully-rejected
  // patch returned {} — and the route assigns this onto its answers variable and
  // persists it, which silently wiped the whole interview. It must always come
  // back as the complete map.
  it('returns the existing answers intact when the whole patch is invalid', () => {
    const current: Answers = {
      seasonality: filled('summer'),
      cms_hosting: filled('WordPress'),
    }
    const result = applyRecordAnswers({ answers: { bogus: { value: 1 } } }, current)

    expect(result.answers).toEqual(current)
    expect(result.appliedIds).toEqual([])
    expect(result.message).toContain('bogus')
  })

  it('returns the existing answers intact for malformed input, without throwing', () => {
    const current: Answers = { seasonality: filled('summer') }
    expect(() => applyRecordAnswers({}, current)).not.toThrow()
    expect(applyRecordAnswers({}, current).answers).toEqual(current)
    expect(applyRecordAnswers({ answers: 'nope' }, current).answers).toEqual(current)
    expect(applyRecordAnswers({ answers: null }, current).answers).toEqual(current)
    expect(applyRecordAnswers({ answers: null }, current).appliedIds).toEqual([])
  })

  it('never returns an empty map when it was given a non-empty one', () => {
    const current: Answers = { seasonality: filled('summer') }
    for (const bad of [{}, { answers: null }, { answers: 'x' }, { answers: [] }, { answers: { bogus: {} } }]) {
      expect(Object.keys(applyRecordAnswers(bad, current).answers).length).toBeGreaterThan(0)
    }
  })
})
