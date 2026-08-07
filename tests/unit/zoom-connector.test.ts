import { describe, expect, it } from 'vitest'
import {
  dedupeCalls,
  domainFromQuery,
  encodeMeetingUuid,
  queryWords,
  summaryToText,
  topicMatches,
  vttToText,
  type ZoomCall,
} from '@/lib/connectors/zoom'

const call = (over: Partial<ZoomCall>): ZoomCall => ({
  uuid: 'u1',
  topic: 'Meeting',
  start: '2026-08-01T10:00:00Z',
  host: 'matt@igniteiq.com',
  durationMin: 30,
  kind: 'recording',
  hasContent: true,
  transcriptUrl: null,
  ...over,
})

describe('domainFromQuery', () => {
  it('recognises a bare domain', () => {
    expect(domainFromQuery('airworks.com')).toBe('airworks.com')
    expect(domainFromQuery('  AirWorks.COM ')).toBe('airworks.com')
  })

  it('takes the domain out of an email, since pasting a contact is the obvious move', () => {
    expect(domainFromQuery('bridget@airworks.com')).toBe('airworks.com')
    expect(domainFromQuery('BRIDGET@AirWorks.com')).toBe('airworks.com')
  })

  it('accepts a pasted website URL', () => {
    expect(domainFromQuery('https://www.airworks.com/contact')).toBe('airworks.com')
  })

  it('returns null for a company name, which must fall through to name matching', () => {
    expect(domainFromQuery('AirWorks Heating')).toBeNull()
    expect(domainFromQuery('')).toBeNull()
    expect(domainFromQuery('bridget@')).toBeNull()
  })
})

describe('queryWords', () => {
  // Without stop-word removal, "The Airworks Group LLC" matches every meeting
  // whose title contains "group" — which on a busy account is most of them.
  it('drops filler and short words', () => {
    expect(queryWords('The Airworks Group LLC')).toEqual(['airworks'])
    expect(queryWords('Pasha Health Co')).toEqual(['pasha', 'health'])
  })
})

describe('topicMatches', () => {
  it('matches on the full query and on a meaningful word', () => {
    expect(topicMatches('Airworks / IgniteIQ kickoff', 'airworks')).toBe(true)
    expect(topicMatches('Airworks / IgniteIQ kickoff', 'The Airworks Group LLC')).toBe(true)
  })

  it('does not match an unrelated topic', () => {
    expect(topicMatches('Weekly standup', 'airworks')).toBe(false)
    expect(topicMatches('', 'airworks')).toBe(false)
  })

  it('treats * as match-everything', () => {
    expect(topicMatches('Anything at all', '*')).toBe(true)
  })

  // The case the tiered search exists for: a call filed under the host's
  // personal room name says nothing about who was on it, so topic matching
  // MUST fail here and let attendee matching pick it up.
  it('misses a call titled after the host, which is what tier 2 is for', () => {
    expect(topicMatches("Matt Lawler's Meeting Room", 'airworks')).toBe(false)
  })
})

describe('dedupeCalls', () => {
  // A meeting that was recorded AND summarised arrives twice. Keeping both would
  // let the extractor treat one conversation as two corroborating sources.
  it('prefers the verbatim transcript over the AI summary of the same call', () => {
    const out = dedupeCalls([
      call({ uuid: 'same', kind: 'summary', transcriptUrl: null }),
      call({ uuid: 'same', kind: 'recording', hasContent: true, transcriptUrl: 'https://zoom.us/t' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('recording')
  })

  it('keeps a summary when there is no recording for that meeting', () => {
    const out = dedupeCalls([call({ uuid: 'only', kind: 'summary' })])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('summary')
  })

  it('does not collapse distinct meetings', () => {
    expect(dedupeCalls([call({ uuid: 'a' }), call({ uuid: 'b' })])).toHaveLength(2)
  })

  it('ignores a recording with no transcript in favour of a summary that has content', () => {
    const out = dedupeCalls([
      call({ uuid: 'x', kind: 'summary', hasContent: true }),
      call({ uuid: 'x', kind: 'recording', hasContent: false }),
    ])
    expect(out[0].kind).toBe('summary')
  })
})

describe('vttToText', () => {
  it('strips the header, cue numbers and timing lines', () => {
    const vtt = [
      'WEBVTT',
      '',
      '1',
      '00:00:01.000 --> 00:00:04.000',
      'Matt Lawler: So you are on ServiceTitan already?',
      '',
      '2',
      '00:00:04.500 --> 00:00:07.000',
      'Bridget: Three years now.',
    ].join('\n')

    expect(vttToText(vtt)).toBe(
      'Matt Lawler: So you are on ServiceTitan already?\nBridget: Three years now.',
    )
  })

  it('returns empty string for an empty or header-only file', () => {
    expect(vttToText('WEBVTT\n\n')).toBe('')
    expect(vttToText('')).toBe('')
  })
})

describe('encodeMeetingUuid', () => {
  // Zoom UUIDs can contain / and //. Single-encoding leaves a path separator in
  // place and the request 404s in a way that looks like a missing meeting.
  it('double-encodes, so a slash survives as a path segment', () => {
    expect(encodeMeetingUuid('abc/def==')).toBe('abc%252Fdef%253D%253D')
    expect(encodeMeetingUuid('a//b')).toBe('a%252F%252Fb')
  })

  it('leaves a plain uuid usable', () => {
    expect(encodeMeetingUuid('plainuuid123')).toBe('plainuuid123')
  })
})

describe('summaryToText', () => {
  it('flattens title, overview, details and next steps', () => {
    const text = summaryToText({
      summary_title: 'Airworks discovery',
      summary_overview: 'They run HVAC and plumbing.',
      summary_details: [{ label: 'Systems', summary: 'ServiceTitan for 3 years.' }],
      next_steps: ['Send proposal', 'Book kickoff'],
    })
    expect(text).toContain('[AI COMPANION SUMMARY] Airworks discovery')
    expect(text).toContain('They run HVAC and plumbing.')
    expect(text).toContain('Systems: ServiceTitan for 3 years.')
    expect(text).toContain('Next steps: Send proposal; Book kickoff')
  })

  it('survives a summary with nothing in it', () => {
    expect(summaryToText({})).toBe('[AI COMPANION SUMMARY]')
  })
})
