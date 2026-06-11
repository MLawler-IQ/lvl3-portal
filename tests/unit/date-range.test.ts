import { describe, expect, it } from 'vitest'

import { buildDateRange, buildTrendRange, pickGranularity } from '@/lib/date-range'

describe('pickGranularity', () => {
  it('uses daily buckets for short periods', () => {
    expect(pickGranularity('7d')).toBe('daily')
    expect(pickGranularity('28d')).toBe('daily')
  })

  it('uses weekly buckets for mid periods', () => {
    expect(pickGranularity('90d')).toBe('weekly')
    expect(pickGranularity('180d')).toBe('weekly')
  })

  it('uses monthly buckets for a full year', () => {
    expect(pickGranularity('365d')).toBe('monthly')
  })

  it('falls back by window length for unknown periods', () => {
    expect(pickGranularity('14d')).toBe('daily')
    expect(pickGranularity()).toBe('daily')
  })
})

describe('buildTrendRange', () => {
  it('shares its window with buildDateRange so KPI and trend agree', () => {
    const range = buildDateRange('90d', 'prior')
    const trend = buildTrendRange('90d', 'prior')
    expect(trend.startDate).toBe(range.startDate)
    expect(trend.endDate).toBe(range.endDate)
    expect(trend.compareStart).toBe(range.compareStart)
    expect(trend.compareEnd).toBe(range.compareEnd)
  })

  it('carries the granularity for the period', () => {
    expect(buildTrendRange('28d').granularity).toBe('daily')
    expect(buildTrendRange('90d').granularity).toBe('weekly')
    expect(buildTrendRange('365d').granularity).toBe('monthly')
  })

  it('respects the comparison mode', () => {
    const yoy = buildTrendRange('28d', 'yoy')
    const prior = buildTrendRange('28d', 'prior')
    expect(yoy.compareStart).not.toBe(prior.compareStart)
  })
})
