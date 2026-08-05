import { describe, expect, it } from 'vitest'
import { computeCompleteness } from '@/lib/onboarding/completeness'
import { buildClientUpdate, type ServiceContext } from '@/lib/onboarding/promote'
import type { Answers } from '@/lib/onboarding/schema'
import { applyRecordAnswers } from '@/lib/onboarding/tools'

const filled = (value: unknown): Answers[string] =>
  ({ value, unknown: false } as Answers[string])

const APPROVED_AT = '2026-08-05T12:00:00.000Z'

function build(answers: Answers) {
  return buildClientUpdate(answers, computeCompleteness(answers), 'sess-1', APPROVED_AT)
}

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

describe('applyRecordAnswers', () => {
  it('merges a patch onto existing answers without dropping earlier slots', () => {
    const current: Answers = { seasonality: filled('summer') }
    const result = applyRecordAnswers(
      { answers: { cms_hosting: { value: 'WordPress + Yoast' } } },
      current,
    )
    expect(Object.keys(result.applied).sort()).toEqual(['cms_hosting', 'seasonality'])
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
    expect(result.applied.seasonality).toBeTruthy()
  })

  it('does not wipe existing answers when the whole patch is invalid', () => {
    const current: Answers = { seasonality: filled('summer') }
    const result = applyRecordAnswers({ answers: { bogus: { value: 1 } } }, current)
    // applied is empty, so the caller keeps `current` — the route assigns
    // result.applied only on success paths.
    expect(result.applied).toEqual({})
    expect(result.message).toContain('bogus')
  })

  it('survives a malformed tool input without throwing', () => {
    expect(() => applyRecordAnswers({}, {})).not.toThrow()
    expect(() => applyRecordAnswers({ answers: 'nope' }, {})).not.toThrow()
    expect(applyRecordAnswers({ answers: null }, {}).applied).toEqual({})
  })
})
