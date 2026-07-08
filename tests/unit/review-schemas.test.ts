import { describe, expect, it } from 'vitest'

import {
  findMissingDenyNotes,
  responsePayloadSchema,
  TOKEN_RE,
  toWirePayload,
} from '@/lib/review/schemas'
import type { ItemAnswers } from '@/lib/review/types'

const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

describe('TOKEN_RE', () => {
  it('accepts exactly 32 hex chars, case-insensitive', () => {
    expect(TOKEN_RE.test('0123456789abcdef0123456789abcdef')).toBe(true)
    expect(TOKEN_RE.test('0123456789ABCDEF0123456789ABCDEF')).toBe(true)
  })

  it('rejects wrong length or non-hex', () => {
    expect(TOKEN_RE.test('0123456789abcdef0123456789abcde')).toBe(false)
    expect(TOKEN_RE.test('0123456789abcdef0123456789abcdefa')).toBe(false)
    expect(TOKEN_RE.test('0123456789abcdef0123456789abcdeg')).toBe(false)
  })
})

describe('toWirePayload', () => {
  it('maps rating 0 to null', () => {
    expect(toWirePayload(UUID, { rating: 0, decision: null, note: '' })).toEqual({
      itemId: UUID,
      rating: null,
      decision: null,
      note: '',
    })
  })

  it('withholds deny while the note is empty, keeping rating and note', () => {
    expect(toWirePayload(UUID, { rating: 4, decision: 'deny', note: '' })).toEqual({
      itemId: UUID,
      rating: 4,
      decision: null,
      note: '',
    })
  })

  it('withholds deny while the note is whitespace-only', () => {
    const payload = toWirePayload(UUID, { rating: 0, decision: 'deny', note: '   ' })
    expect(payload.decision).toBeNull()
    expect(payload.note).toBe('   ')
  })

  it('passes deny through once a note exists', () => {
    expect(toWirePayload(UUID, { rating: 2, decision: 'deny', note: 'too dark' })).toEqual({
      itemId: UUID,
      rating: 2,
      decision: 'deny',
      note: 'too dark',
    })
  })

  it('passes approve through with or without a note', () => {
    expect(toWirePayload(UUID, { rating: 10, decision: 'approve', note: '' })).toEqual({
      itemId: UUID,
      rating: 10,
      decision: 'approve',
      note: '',
    })
  })
})

describe('findMissingDenyNotes', () => {
  it('flags denies with empty or whitespace-only notes', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      a: { rating: null, decision: 'deny', note: '' },
      b: { rating: 3, decision: 'deny', note: '   ' },
      c: { rating: null, decision: 'deny', note: null },
    }
    expect(findMissingDenyNotes(answers, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('does not flag denies with real notes, approvals, or unanswered items', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      a: { rating: null, decision: 'deny', note: 'fix the framing' },
      b: { rating: 8, decision: 'approve', note: '' },
      c: undefined,
    }
    expect(findMissingDenyNotes(answers, ['a', 'b', 'c', 'd'])).toEqual([])
  })

  it('preserves itemIds order', () => {
    const answers: Record<string, ItemAnswers | undefined> = {
      x: { rating: null, decision: 'deny', note: '' },
      y: { rating: null, decision: 'deny', note: '' },
    }
    expect(findMissingDenyNotes(answers, ['y', 'x'])).toEqual(['y', 'x'])
  })
})

describe('responsePayloadSchema', () => {
  const valid = { itemId: UUID, rating: 5, decision: 'approve', note: 'nice' }

  it('accepts a valid payload', () => {
    expect(responsePayloadSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts null rating and null decision', () => {
    expect(
      responsePayloadSchema.safeParse({ itemId: UUID, rating: null, decision: null, note: '' })
        .success
    ).toBe(true)
  })

  it('accepts boundary ratings 1 and 10', () => {
    expect(responsePayloadSchema.safeParse({ ...valid, rating: 1 }).success).toBe(true)
    expect(responsePayloadSchema.safeParse({ ...valid, rating: 10 }).success).toBe(true)
  })

  it('rejects rating 0, 11, and non-integers', () => {
    expect(responsePayloadSchema.safeParse({ ...valid, rating: 0 }).success).toBe(false)
    expect(responsePayloadSchema.safeParse({ ...valid, rating: 11 }).success).toBe(false)
    expect(responsePayloadSchema.safeParse({ ...valid, rating: 1.5 }).success).toBe(false)
  })

  it('rejects unknown decisions', () => {
    expect(responsePayloadSchema.safeParse({ ...valid, decision: 'maybe' }).success).toBe(false)
  })

  it('rejects notes longer than 2000 chars, accepts exactly 2000', () => {
    expect(
      responsePayloadSchema.safeParse({ ...valid, note: 'x'.repeat(2001) }).success
    ).toBe(false)
    expect(
      responsePayloadSchema.safeParse({ ...valid, note: 'x'.repeat(2000) }).success
    ).toBe(true)
  })

  it('rejects a non-uuid itemId', () => {
    expect(
      responsePayloadSchema.safeParse({ ...valid, itemId: 'not-a-uuid' }).success
    ).toBe(false)
  })
})
