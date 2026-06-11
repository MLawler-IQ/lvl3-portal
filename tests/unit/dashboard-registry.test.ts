import { describe, expect, it } from 'vitest'

import {
  MODULES,
  defaultModulesForType,
  inferClientType,
} from '@/lib/dashboard/registry'
import type { DashboardModuleId } from '@/lib/dashboard/types'

describe('MODULES registry invariants', () => {
  it('every entry key matches its id', () => {
    for (const [key, def] of Object.entries(MODULES)) {
      expect(def.id).toBe(key)
    }
  })

  it('leads with the executive summary (default render order)', () => {
    expect(Object.keys(MODULES)[0]).toBe('exec_summary')
  })

  it('only valid client types appear in defaultFor', () => {
    const valid = new Set(['local_service', 'multi_location', 'ecommerce', 'lead_gen'])
    for (const def of Object.values(MODULES)) {
      for (const t of def.defaultFor) expect(valid.has(t)).toBe(true)
    }
  })
})

describe('defaultModulesForType', () => {
  it('generic (null) returns exactly the core modules', () => {
    const generic = defaultModulesForType(null)
    const core = (Object.values(MODULES) as { id: DashboardModuleId; core?: boolean }[])
      .filter((m) => m.core)
      .map((m) => m.id)
    expect(generic).toEqual(core)
  })

  it('multi_location adds location + GBP modules but not ecom', () => {
    const mods = defaultModulesForType('multi_location')
    expect(mods).toContain('gbp_overview')
    expect(mods).toContain('location_leaderboard')
    expect(mods).not.toContain('ecom_funnel')
  })

  it('ecommerce adds funnel + products but not location leaderboard', () => {
    const mods = defaultModulesForType('ecommerce')
    expect(mods).toContain('ecom_funnel')
    expect(mods).toContain('top_products')
    expect(mods).not.toContain('location_leaderboard')
  })

  it('lead_gen adds converting pages + content performance', () => {
    const mods = defaultModulesForType('lead_gen')
    expect(mods).toContain('converting_pages')
    expect(mods).toContain('content_performance')
  })

  it('always includes core modules regardless of type', () => {
    for (const type of [null, 'local_service', 'multi_location', 'ecommerce', 'lead_gen'] as const) {
      expect(defaultModulesForType(type)).toContain('exec_summary')
      expect(defaultModulesForType(type)).toContain('traffic_trend')
    }
  })
})

describe('inferClientType', () => {
  it('ecommerce when there is revenue or transactions', () => {
    expect(inferClientType({ purchaseRevenue: 5000 })).toBe('ecommerce')
    expect(inferClientType({ transactions: 3 })).toBe('ecommerce')
    expect(inferClientType({ purchaseRevenue: 5000, gbpLocationCount: 40 })).toBe('ecommerce')
  })

  it('multi_location when more than 5 GBP locations and no revenue', () => {
    expect(inferClientType({ gbpLocationCount: 6 })).toBe('multi_location')
    expect(inferClientType({ gbpLocationCount: 250 })).toBe('multi_location')
  })

  it('local_service for 1–5 GBP locations and no revenue', () => {
    expect(inferClientType({ gbpLocationCount: 1 })).toBe('local_service')
    expect(inferClientType({ gbpLocationCount: 5 })).toBe('local_service')
  })

  it('lead_gen as the fallback', () => {
    expect(inferClientType({})).toBe('lead_gen')
    expect(inferClientType({ gbpLocationCount: 0 })).toBe('lead_gen')
  })
})
