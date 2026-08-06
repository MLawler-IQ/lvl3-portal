import { describe, it, expect } from 'vitest'
import {
  CHART_SERIES,
  CHART_OTHER,
  CHART_PRIMARY,
  seriesColorForEntity,
  assignSeriesColors,
  describeTrend,
} from '@/lib/charts/palette'

describe('seriesColorForEntity', () => {
  it('gives organic the sienna anchor', () => {
    expect(seriesColorForEntity('organic')).toBe(CHART_SERIES[0])
    expect(seriesColorForEntity('Organic Search')).toBe(CHART_SERIES[0])
  })

  it('is case and whitespace insensitive', () => {
    expect(seriesColorForEntity('  DESKTOP  ')).toBe(seriesColorForEntity('desktop'))
    expect(seriesColorForEntity('Non-Branded')).toBe(seriesColorForEntity('non-branded'))
  })

  it('returns null for an entity with no permanent slot', () => {
    expect(seriesColorForEntity('some new channel')).toBeNull()
  })
})

describe('assignSeriesColors', () => {
  // The rule the module exists for: colour follows the entity, not its rank. This is
  // the test that would fail if someone reintroduced index-based assignment.
  it('gives an entity the same colour regardless of position or siblings', () => {
    const a = assignSeriesColors(['organic', 'direct', 'referral'])
    const b = assignSeriesColors(['referral', 'organic'])
    const c = assignSeriesColors(['direct', 'referral', 'organic', 'paid'])
    expect(a.organic).toBe(b.organic)
    expect(a.organic).toBe(c.organic)
    expect(a.referral).toBe(b.referral)
    expect(a.referral).toBe(c.referral)
  })

  // The DeviceDonutChart bug: the list was filtered by value > 0 before colouring,
  // so a client with no tablet traffic saw Desktop in Mobile's colour.
  it('keeps device colours stable when a device drops out of the data', () => {
    const all = assignSeriesColors(['Desktop', 'Mobile', 'Tablet'])
    const noTablet = assignSeriesColors(['Desktop', 'Mobile'])
    const onlyMobile = assignSeriesColors(['Mobile'])
    expect(noTablet.Desktop).toBe(all.Desktop)
    expect(onlyMobile.Mobile).toBe(all.Mobile)
  })

  it('folds the fifth series and beyond into Other', () => {
    const out = assignSeriesColors(['aa', 'bb', 'cc', 'dd', 'ee', 'ff'])
    const others = Object.values(out).filter((c) => c === CHART_OTHER)
    expect(others).toHaveLength(2)
    expect(new Set(Object.values(out)).size).toBe(5) // 4 series + Other
  })

  it('assigns unknown entities deterministically, not in input order', () => {
    const one = assignSeriesColors(['zebra', 'apple', 'mango'])
    const two = assignSeriesColors(['mango', 'zebra', 'apple'])
    expect(one).toEqual(two)
  })

  it('never hands the same series colour to two entities', () => {
    const out = assignSeriesColors(['organic', 'direct', 'referral', 'paid'])
    const used = Object.values(out)
    expect(new Set(used).size).toBe(used.length)
  })

  it('lets a known entity keep its slot even alongside unknowns', () => {
    const out = assignSeriesColors(['mystery', 'organic'])
    expect(out.organic).toBe(CHART_SERIES[0])
    expect(out.mystery).not.toBe(CHART_SERIES[0])
  })
})

describe('palette integrity', () => {
  it('exposes exactly the four validated series', () => {
    expect(CHART_SERIES).toHaveLength(4)
    expect(CHART_PRIMARY).toBe(CHART_SERIES[0])
  })

  // Status colours must never appear as a chart series (§4 / chart-palette.json).
  it('shares no colour with the status tokens', () => {
    const series = [...CHART_SERIES, CHART_OTHER]
    for (const s of series) {
      expect(s).not.toMatch(/--color-(error|warning|success)|--status-/)
    }
  })

  it('references only chart tokens, never a raw hex', () => {
    for (const s of [...CHART_SERIES, CHART_OTHER]) {
      expect(s).toMatch(/^var\(--chart-/)
    }
  })
})

describe('describeTrend', () => {
  it('narrates direction and magnitude', () => {
    expect(describeTrend('Clicks', 100, 150, '30 days')).toBe(
      'Clicks: up 50% over 30 days, from 100 to 150.',
    )
    expect(describeTrend('Clicks', 200, 100)).toBe('Clicks: down 50%, from 200 to 100.')
  })

  it('handles the degenerate cases without dividing by zero', () => {
    expect(describeTrend('Clicks', 0, 0)).toContain('flat at zero')
    expect(describeTrend('Clicks', 0, 40)).toContain('rose from zero')
    expect(describeTrend('Clicks', 50, 50)).toContain('flat')
  })

  it('says so when there is no data rather than inventing a trend', () => {
    expect(describeTrend('Clicks', null, 10)).toContain('no trend data')
    expect(describeTrend('Clicks', undefined, undefined)).toContain('no trend data')
    expect(describeTrend('Clicks', Number.NaN, 5)).toContain('no trend data')
  })
})
