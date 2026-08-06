// The GBP location-scope gate.
//
// The hole: app/actions/dashboard-gbp.ts read only `gbp_account_id` and listed every
// location under it, so on a shared container one brand's dashboard rendered another
// brand's locations — cached 18h under a key with no scope, on a surface gated by
// `client_type` rather than by role. `clients.gbp_location_group` was collected by
// onboarding and the settings form and read by no query anywhere.
import { describe, it, expect } from 'vitest'
import { decideGBPScope } from '@/lib/connectors/gbp'

const ACCT = 'accounts/112762669592346459441'

describe('decideGBPScope', () => {
  it('REFUSES when no scope is configured — the production state of all three clients', () => {
    const d = decideGBPScope(ACCT, null)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe('gbp_scope_unconfigured')
  })

  it('refuses an empty or whitespace-only group', () => {
    expect(decideGBPScope(ACCT, '').ok).toBe(false)
    expect(decideGBPScope(ACCT, '   ').ok).toBe(false)
  })

  it('REFUSES "Ungrouped" — the value the onboarding test expects to be stored', () => {
    // Business Profile Manager's name for locations in NO group. Treating it as a filter
    // would match nothing and silently empty the dashboard instead of scoping it; treating
    // it as permission would leave the hole wide open. Neither. Refuse.
    const d = decideGBPScope(ACCT, 'Ungrouped')
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.configured).toBe('Ungrouped')
  })

  it('uses an accounts/ location group as the list parent', () => {
    const d = decideGBPScope(ACCT, 'accounts/999')
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.parent).toBe('accounts/999')
      expect(d.scope).toBe('group')
      expect(d.parent).not.toBe(ACCT)
    }
  })

  it('accepts "*" as an explicit whole-account assertion', () => {
    // Needed so a single-client account, and a multi_location brand that owns every
    // location in its own account, are not broken by the gate — faulting correct
    // configuration is its own failure mode. But it has to be said deliberately.
    const d = decideGBPScope(ACCT, '*')
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.parent).toBe(ACCT)
      expect(d.scope).toBe('account-wide')
    }
  })

  it('tolerates surrounding whitespace on both accepted forms', () => {
    expect(decideGBPScope(ACCT, ' * ').ok).toBe(true)
    expect(decideGBPScope(ACCT, '  accounts/999  ').ok).toBe(true)
  })

  it('does not accept a bare group name, however plausible', () => {
    for (const v of ['Tapps Electric', 'tapps', 'group-1', 'accounts', 'account/999']) {
      expect(decideGBPScope(ACCT, v).ok, v).toBe(false)
    }
  })
})
