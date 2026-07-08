import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildCsv } from '@/lib/csv-builder'
import { parseDelimited } from '@/lib/parse-csv'
import {
  answersFromResponses,
  batchProgress,
  buildResponsesCsvRows,
  reviewUrl,
} from '@/lib/review/helpers'
import type { ReviewItem } from '@/lib/review/types'

function makeItem(id: string, sortOrder: number, title: string, handle: string | null): ReviewItem {
  return {
    id,
    batch_id: 'batch-1',
    sort_order: sortOrder,
    title,
    copy: null,
    copy_url: null,
    image_url: `https://cdn.example.com/${id}.webp`,
    shopify_handle: handle,
  }
}

describe('reviewUrl', () => {
  const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  afterEach(() => {
    if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL
  })

  it('falls back to the production portal domain', () => {
    expect(reviewUrl('abc123')).toBe('https://portal.igniteiq.com/mm-image-review/abc123')
  })

  it('uses NEXT_PUBLIC_SITE_URL when set', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
    expect(reviewUrl('abc123')).toBe('http://localhost:3000/mm-image-review/abc123')
  })

  it('uses an explicit base over the environment', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
    expect(reviewUrl('tok', 'https://example.com')).toBe(
      'https://example.com/mm-image-review/tok'
    )
  })

  it('strips trailing slashes from the base', () => {
    expect(reviewUrl('tok', 'https://example.com///')).toBe(
      'https://example.com/mm-image-review/tok'
    )
  })
})

describe('batchProgress', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('counts decisions, note-only responses, and pending items', () => {
    const responses = [
      { item_id: 'a', rating: 8, decision: 'approve' as const, note: null },
      { item_id: 'b', rating: null, decision: 'deny' as const, note: 'too dark' },
      // Note-only response still counts as responded.
      { item_id: 'c', rating: null, decision: null, note: '  needs a second look  ' },
    ]
    expect(batchProgress(items, responses)).toEqual({
      approved: 1,
      denied: 1,
      responded: 3,
      pending: 2,
    })
  })

  it('counts a rating-only response as responded but not decided', () => {
    const responses = [{ item_id: 'a', rating: 6, decision: null, note: null }]
    expect(batchProgress(items, responses)).toEqual({
      approved: 0,
      denied: 0,
      responded: 1,
      pending: 4,
    })
  })

  it('does not count a whitespace-only note as responded', () => {
    const responses = [{ item_id: 'a', rating: null, decision: null, note: '   ' }]
    expect(batchProgress(items, responses)).toEqual({
      approved: 0,
      denied: 0,
      responded: 0,
      pending: 4,
    })
  })

  it('ignores responses for unknown item ids', () => {
    const responses = [
      { item_id: 'not-an-item', rating: 9, decision: 'approve' as const, note: 'great' },
    ]
    expect(batchProgress(items, responses)).toEqual({
      approved: 0,
      denied: 0,
      responded: 0,
      pending: 4,
    })
  })
})

describe('buildResponsesCsvRows', () => {
  const items = [
    makeItem('i2', 2, 'Second Image', 'second-image'),
    makeItem('i1', 1, 'First Image', 'first-image'),
    makeItem('i3', 3, 'Third Image', null),
  ]

  it('orders rows by sort_order and numbers them sequentially', () => {
    const { headers, rows } = buildResponsesCsvRows(items, [])
    expect(headers).toEqual(['#', 'Title', 'Handle', 'Rating', 'Decision', 'Note', 'Updated'])
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      [1, 'First Image'],
      [2, 'Second Image'],
      [3, 'Third Image'],
    ])
  })

  it('fills null cells for items without a response', () => {
    const responses = [
      {
        item_id: 'i1',
        rating: 7,
        decision: 'approve' as const,
        note: 'ship it',
        updated_at: '2026-07-08T12:00:00Z',
      },
    ]
    const { rows } = buildResponsesCsvRows(items, responses)
    expect(rows[0]).toEqual([
      1,
      'First Image',
      'first-image',
      7,
      'approve',
      'ship it',
      '2026-07-08T12:00:00Z',
    ])
    expect(rows[1]).toEqual([2, 'Second Image', 'second-image', null, null, null, null])
    expect(rows[2]).toEqual([3, 'Third Image', null, null, null, null, null])
  })

  it('round-trips a gnarly note through buildCsv + parseDelimited', () => {
    const note = 'Line one, with commas\nLine "two" has quotes\r\nand a CRLF'
    const responses = [
      {
        item_id: 'i1',
        rating: 3,
        decision: 'deny' as const,
        note,
        updated_at: '2026-07-08T12:00:00Z',
      },
    ]
    const { headers, rows } = buildResponsesCsvRows(items, responses)
    const parsed = parseDelimited(buildCsv(headers, rows), ',')

    expect(parsed[0]).toEqual(headers)
    // First data row: the note survives exactly, numbers become strings.
    expect(parsed[1]).toEqual([
      '1',
      'First Image',
      'first-image',
      '3',
      'deny',
      note,
      '2026-07-08T12:00:00Z',
    ])
    // Missing-response rows serialize nulls as empty cells.
    expect(parsed[2]).toEqual(['2', 'Second Image', 'second-image', '', '', '', ''])
  })
})

describe('answersFromResponses', () => {
  it('folds rows into a per-item map', () => {
    const map = answersFromResponses([
      { item_id: 'a', rating: 5, decision: 'approve', note: null },
      { item_id: 'b', rating: null, decision: null, note: 'hmm' },
    ])
    expect(map).toEqual({
      a: { rating: 5, decision: 'approve', note: null },
      b: { rating: null, decision: null, note: 'hmm' },
    })
  })

  it('lets a later response for the same item overwrite an earlier one', () => {
    const map = answersFromResponses([
      { item_id: 'a', rating: 2, decision: 'deny', note: 'v1' },
      { item_id: 'a', rating: 9, decision: 'approve', note: 'v2' },
    ])
    expect(map).toEqual({ a: { rating: 9, decision: 'approve', note: 'v2' } })
  })
})
