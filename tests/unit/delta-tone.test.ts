import { describe, it, expect } from 'vitest'
import { deltaTone, toneFromDirection, DELTA_TONE_TEXT } from '@/lib/delta-tone'

describe('deltaTone', () => {
  it('reads a rise as positive and a fall as negative', () => {
    expect(deltaTone(9)).toBe('positive')
    expect(deltaTone(0.1)).toBe('positive')
    expect(deltaTone(-6.6)).toBe('negative')
  })

  // The bug this module was extracted to kill: DashboardTabs used `>= 0`, so a
  // client with no change at all saw a green "+0%".
  it('treats exactly zero as flat, never positive', () => {
    expect(deltaTone(0)).toBe('flat')
    expect(deltaTone(-0)).toBe('flat')
  })

  it('inverts for metrics where down is good, like Avg Position', () => {
    expect(deltaTone(-3, 'down')).toBe('positive')
    expect(deltaTone(3, 'down')).toBe('negative')
    expect(deltaTone(0, 'down')).toBe('flat')
  })

  // Deltas are computed from division, so a zero prior window can produce these.
  it('does not colour a non-finite delta', () => {
    expect(deltaTone(Number.NaN)).toBe('flat')
    expect(deltaTone(Number.POSITIVE_INFINITY)).toBe('flat')
    expect(deltaTone(Number.NEGATIVE_INFINITY)).toBe('flat')
  })
})

describe('toneFromDirection', () => {
  it('maps a direction plus goodDirection to a tone', () => {
    expect(toneFromDirection('up')).toBe('positive')
    expect(toneFromDirection('down')).toBe('negative')
    expect(toneFromDirection('flat')).toBe('flat')
    // Avg Position: numerically down, but good news.
    expect(toneFromDirection('down', 'down')).toBe('positive')
    expect(toneFromDirection('up', 'down')).toBe('negative')
  })

  it('agrees with deltaTone on the same input', () => {
    for (const [value, direction] of [
      [5, 'up'],
      [-5, 'down'],
      [0, 'flat'],
    ] as const) {
      for (const good of ['up', 'down'] as const) {
        expect(toneFromDirection(direction, good)).toBe(deltaTone(value, good))
      }
    }
  })
})

describe('DELTA_TONE_TEXT', () => {
  // The point of the sweep: no raw Tailwind palette classes survive here, or the
  // five old implementations creep back one file at a time.
  it('uses only design tokens', () => {
    const classes = Object.values(DELTA_TONE_TEXT)
    expect(classes).toEqual(['text-success', 'text-error', 'text-surface-400'])
    for (const c of classes) {
      expect(c).not.toMatch(
        /(emerald|rose|amber|red|green|sky|blue|indigo|teal|violet|purple|yellow|orange)-\d/,
      )
    }
  })

  it('covers every tone', () => {
    for (const tone of ['positive', 'negative', 'flat'] as const) {
      expect(DELTA_TONE_TEXT[tone]).toBeTruthy()
    }
  })
})
