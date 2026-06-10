import { describe, expect, it } from 'vitest'

import { buildCsv, csvEscape } from '@/lib/csv-builder'
import { parseDelimited, parsePromptRows } from '@/lib/parse-csv'

describe('csvEscape (RFC 4180)', () => {
  it('leaves plain values unquoted', () => {
    expect(csvEscape('hello')).toBe('hello')
    expect(csvEscape(42)).toBe('42')
  })

  it('renders null/undefined as empty string', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
  })

  it('quotes values containing commas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })

  it('doubles embedded quotes and wraps in quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes values containing newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"')
  })
})

describe('buildCsv', () => {
  it('joins headers and rows with escaping applied', () => {
    const csv = buildCsv(['name', 'note'], [
      ['Acme', 'plain'],
      ['Beta, Inc', 'said "ok"'],
    ])
    expect(csv).toBe('name,note\nAcme,plain\n"Beta, Inc","said ""ok"""')
  })
})

describe('parseDelimited', () => {
  it('round-trips buildCsv output with embedded delimiters, quotes, and newlines', () => {
    const headers = ['name', 'note']
    const rows = [
      ['Beta, Inc', 'said "ok"'],
      ['Gamma', 'line1\nline2'],
    ]
    const parsed = parseDelimited(buildCsv(headers, rows), ',')
    expect(parsed).toEqual([headers, ...rows])
  })

  it('parses TSV with quoted fields containing tabs', () => {
    const parsed = parseDelimited('a\t"b\tc"\nd\te', '\t')
    expect(parsed).toEqual([
      ['a', 'b\tc'],
      ['d', 'e'],
    ])
  })

  it('handles CRLF line endings and skips blank rows', () => {
    const parsed = parseDelimited('a,b\r\n\r\nc,d\r\n', ',')
    expect(parsed).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parsePromptRows', () => {
  it('detects a CSV header row and maps title/prompt columns', () => {
    const rows = parsePromptRows(
      'Post Title,Image Prompt\nHow to Fix a Faucet,"A plumber, smiling"\n',
    )
    expect(rows).toEqual([
      { filename: 'how-to-fix-a-faucet', prompt: 'A plumber, smiling' },
    ])
  })

  it('detects a TSV header row by tab in the first line', () => {
    const rows = parsePromptRows('Title\tPrompt\nWinter HVAC Tips\tA cozy furnace\n')
    expect(rows).toEqual([{ filename: 'winter-hvac-tips', prompt: 'A cozy furnace' }])
  })

  it('handles headerless input using the first two columns', () => {
    // First-row cells must not contain header keywords (title/prompt/etc.)
    const rows = parsePromptRows('My Post,A cozy scene\nSecond Post,A bright scene\n')
    expect(rows).toEqual([
      { filename: 'my-post', prompt: 'A cozy scene' },
      { filename: 'second-post', prompt: 'A bright scene' },
    ])
  })

  it('skips rows missing a title or prompt', () => {
    const rows = parsePromptRows('Title,Prompt\nHas Both,yes\nOnly Title,\n,Only Prompt\n')
    expect(rows).toEqual([{ filename: 'has-both', prompt: 'yes' }])
  })
})
