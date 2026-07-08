import { describe, expect, it } from 'vitest'

import { buildSummaryText, counts, DECISION_LABEL } from '@/lib/review/summary'
import type { ItemAnswers } from '@/lib/review/types'

const batch = { client: 'MantelMount', title: 'Blog images June' }

const items = [
  { id: 'item-b', sort_order: 2, title: 'Second Post' },
  { id: 'item-a', sort_order: 1, title: 'First Post' },
  { id: 'item-c', sort_order: 3, title: 'Third Post' },
]

describe('DECISION_LABEL', () => {
  it('maps decisions to display labels', () => {
    expect(DECISION_LABEL.approve).toBe('Approved')
    expect(DECISION_LABEL.deny).toBe('Denied')
  })
})

describe('counts', () => {
  it('tallies approved, denied, pending, and reviewed', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      'item-a': { rating: 8, decision: 'approve', note: null },
      'item-b': { rating: null, decision: 'deny', note: 'redo' },
      'item-c': undefined,
    }
    expect(counts(['item-a', 'item-b', 'item-c'], answers)).toEqual({
      approved: 1,
      denied: 1,
      reviewed: 2,
      pending: 1,
    })
  })

  it('treats rating-only answers as pending', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      'item-a': { rating: 7, decision: null, note: '' },
    }
    expect(counts(['item-a'], answers)).toEqual({
      approved: 0,
      denied: 0,
      reviewed: 0,
      pending: 1,
    })
  })

  it('returns zeros for no items', () => {
    expect(counts([], {})).toEqual({ approved: 0, denied: 0, reviewed: 0, pending: 0 })
  })
})

describe('buildSummaryText', () => {
  it('renders the exact per-item format, sorted by sort_order, with final counts line', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      'item-a': { rating: 9, decision: 'approve', note: '' },
      'item-b': { rating: null, decision: 'deny', note: 'Wrong colors' },
      'item-c': undefined,
    }
    expect(buildSummaryText(batch, items, answers)).toBe(
      [
        'MantelMount — Blog images June — decisions',
        '',
        '1. First Post',
        '   Rating: 9/10',
        '   Decision: Approved',
        '',
        '2. Second Post',
        '   Rating: (not rated)',
        '   Decision: Denied',
        '   Notes: Wrong colors',
        '',
        '3. Third Post',
        '   Rating: (not rated)',
        '   Decision: (not reviewed)',
        '',
        '1 approved · 1 denied · 1 pending',
      ].join('\n')
    )
  })

  it('omits the Notes line when the note is whitespace-only', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      'item-a': { rating: 5, decision: 'approve', note: '   ' },
    }
    const text = buildSummaryText(batch, [items[1]], answers)
    expect(text).not.toContain('Notes:')
  })

  it('trims notes before rendering them', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      'item-a': { rating: null, decision: 'deny', note: '  needs a new angle  ' },
    }
    const text = buildSummaryText(batch, [items[1]], answers)
    expect(text).toContain('   Notes: needs a new angle')
  })

  it('shows (not rated) for a rating of null', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      'item-a': { rating: null, decision: 'approve', note: null },
    }
    expect(buildSummaryText(batch, [items[1]], answers)).toContain('   Rating: (not rated)')
  })

  it('shows (not reviewed) when there is no decision', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      'item-a': { rating: 6, decision: null, note: null },
    }
    expect(buildSummaryText(batch, [items[1]], answers)).toContain(
      '   Decision: (not reviewed)'
    )
  })
})
