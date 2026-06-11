import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildDateRange,
  buildTrendRange,
  CALENDAR_PRESETS,
  pickGranularity,
} from '@/lib/date-range'

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

  it('uses daily buckets for month-scale calendar presets', () => {
    expect(pickGranularity('last_full_month')).toBe('daily')
    expect(pickGranularity('mtd')).toBe('daily')
  })

  it('uses weekly buckets for quarter-to-date', () => {
    expect(pickGranularity('qtd')).toBe('weekly')
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

  it('shares its window with buildDateRange for calendar presets', () => {
    for (const period of ['last_full_month', 'mtd', 'qtd']) {
      const range = buildDateRange(period, 'prior')
      const trend = buildTrendRange(period, 'prior')
      expect(trend.startDate).toBe(range.startDate)
      expect(trend.endDate).toBe(range.endDate)
      expect(trend.compareStart).toBe(range.compareStart)
      expect(trend.compareEnd).toBe(range.compareEnd)
    }
  })

  it('carries the granularity for calendar presets', () => {
    expect(buildTrendRange('last_full_month').granularity).toBe('daily')
    expect(buildTrendRange('mtd').granularity).toBe('daily')
    expect(buildTrendRange('qtd').granularity).toBe('weekly')
  })
})

describe('CALENDAR_PRESETS export', () => {
  it('exposes an iterable value/label list for the UI', () => {
    expect(Array.isArray(CALENDAR_PRESETS)).toBe(true)
    expect(CALENDAR_PRESETS).toEqual([
      { value: 'last_full_month', label: 'Last full month' },
      { value: 'mtd', label: 'Month to date' },
      { value: 'qtd', label: 'Quarter to date' },
    ])
  })
})

// Whole days between two ISO yyyy-mm-dd strings (b − a). Inclusive length = +1.
const isoDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

describe('calendar presets', () => {
  // Pin "now" to a deterministic mid-month instant so calendar boundaries are exact.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('last_full_month', () => {
    it('spans the most recent fully-completed calendar month', () => {
      const r = buildDateRange('last_full_month', 'prior')
      // now = May 2026 → last full month is April 2026.
      expect(r.startDate).toBe('2026-04-01')
      expect(r.endDate).toBe('2026-04-30')
    })

    it('starts on the 1st and ends on the last day of the month', () => {
      const r = buildDateRange('last_full_month', 'prior')
      expect(r.startDate.slice(8)).toBe('01')
      // April has 30 days.
      expect(isoDiff(r.startDate, r.endDate)).toBe(29)
    })

    it('never ends in the future', () => {
      const r = buildDateRange('last_full_month', 'prior')
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      expect(r.endDate <= yesterday).toBe(true)
    })

    it('compares against the preceding month (prior)', () => {
      const r = buildDateRange('last_full_month', 'prior')
      expect(r.compareStart).toBe('2026-03-01')
      expect(r.compareEnd).toBe('2026-03-31')
      expect(r.compareLabel).toBe('vs. prior month')
    })

    it('compares against the same month a year earlier (yoy)', () => {
      const r = buildDateRange('last_full_month', 'yoy')
      expect(r.compareStart).toBe('2025-04-01')
      expect(r.compareEnd).toBe('2025-04-30')
      expect(r.compareLabel).toBe('vs. prior year')
    })
  })

  describe('mtd', () => {
    it('spans the 1st of the current month through yesterday', () => {
      const r = buildDateRange('mtd', 'prior')
      // yesterday = 2026-05-14.
      expect(r.startDate).toBe('2026-05-01')
      expect(r.endDate).toBe('2026-05-14')
    })

    it('never ends in the future', () => {
      const r = buildDateRange('mtd', 'prior')
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      expect(r.endDate).toBe(yesterday)
      expect(r.endDate <= yesterday).toBe(true)
    })

    it('uses a same-length window in the prior month (prior)', () => {
      const r = buildDateRange('mtd', 'prior')
      expect(r.compareStart).toBe('2026-04-01')
      expect(r.compareEnd).toBe('2026-04-14')
      // Compare window matches the main window length.
      expect(isoDiff(r.compareStart, r.compareEnd)).toBe(isoDiff(r.startDate, r.endDate))
      expect(r.compareLabel).toBe('vs. prior month to date')
    })

    it('uses a same-length window a year earlier (yoy)', () => {
      const r = buildDateRange('mtd', 'yoy')
      expect(r.compareStart).toBe('2025-05-01')
      expect(r.compareEnd).toBe('2025-05-14')
      expect(isoDiff(r.compareStart, r.compareEnd)).toBe(isoDiff(r.startDate, r.endDate))
      expect(r.compareLabel).toBe('vs. prior year')
    })
  })

  describe('qtd', () => {
    it('spans the 1st of the current quarter through yesterday', () => {
      const r = buildDateRange('qtd', 'prior')
      // May is in Q2 (Apr–Jun) → quarter starts 2026-04-01; yesterday = 2026-05-14.
      expect(r.startDate).toBe('2026-04-01')
      expect(r.endDate).toBe('2026-05-14')
    })

    it('starts on the first day of a quarter month (Jan/Apr/Jul/Oct)', () => {
      const r = buildDateRange('qtd', 'prior')
      const month = Number(r.startDate.slice(5, 7))
      expect([1, 4, 7, 10]).toContain(month)
      expect(r.startDate.slice(8)).toBe('01')
    })

    it('never ends in the future', () => {
      const r = buildDateRange('qtd', 'prior')
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      expect(r.endDate).toBe(yesterday)
      expect(r.endDate <= yesterday).toBe(true)
    })

    it('uses a same-length window in the prior quarter (prior)', () => {
      const r = buildDateRange('qtd', 'prior')
      // Prior quarter Q1 starts 2026-01-01; same offset length (43 days).
      expect(r.compareStart).toBe('2026-01-01')
      expect(r.compareEnd).toBe('2026-02-13')
      expect(isoDiff(r.compareStart, r.compareEnd)).toBe(isoDiff(r.startDate, r.endDate))
      expect(r.compareLabel).toBe('vs. prior quarter to date')
    })

    it('uses a same-length window a year earlier (yoy)', () => {
      const r = buildDateRange('qtd', 'yoy')
      expect(r.compareStart).toBe('2025-04-01')
      expect(r.compareEnd).toBe('2025-05-14')
      expect(isoDiff(r.compareStart, r.compareEnd)).toBe(isoDiff(r.startDate, r.endDate))
      expect(r.compareLabel).toBe('vs. prior year')
    })
  })

  it('keeps period/compare echoed back on the result', () => {
    const r = buildDateRange('mtd', 'yoy')
    expect(r.period).toBe('mtd')
    expect(r.compare).toBe('yoy')
  })
})

describe('calendar preset edge cases', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('last_full_month rolls back across a year boundary in January', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'))
    const r = buildDateRange('last_full_month', 'prior')
    expect(r.startDate).toBe('2025-12-01')
    expect(r.endDate).toBe('2025-12-31')
    expect(r.compareStart).toBe('2025-11-01')
    expect(r.compareEnd).toBe('2025-11-30')
  })

  it('qtd prior-quarter compare crosses the year boundary in Q1', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T12:00:00Z'))
    const r = buildDateRange('qtd', 'prior')
    // Q1 2026 starts Jan 1; yesterday = 2026-02-09.
    expect(r.startDate).toBe('2026-01-01')
    expect(r.endDate).toBe('2026-02-09')
    // Prior quarter is Q4 2025, starting Oct 1.
    expect(r.compareStart).toBe('2025-10-01')
    expect(isoDiff(r.compareStart, r.compareEnd)).toBe(isoDiff(r.startDate, r.endDate))
  })

  it('mtd handles the first day of a month (single-day window)', () => {
    // now = Mar 1 → yesterday = Feb 28 (2026 is not a leap year).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
    const r = buildDateRange('mtd', 'prior')
    expect(r.startDate).toBe('2026-02-01')
    expect(r.endDate).toBe('2026-02-28')
    expect(r.compareStart).toBe('2026-01-01')
    expect(isoDiff(r.compareStart, r.compareEnd)).toBe(isoDiff(r.startDate, r.endDate))
  })
})
