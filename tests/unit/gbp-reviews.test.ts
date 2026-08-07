// The Google My Business v4 reader: reviews, media, and the summary LOCAL-007/008/009/010
// consume.
//
// fetchImpl is injected rather than stubbing global fetch — with a global stub a case the
// test forgot to route reaches the real API, and this module's whole point is that it
// touches a live, quota-metered Google endpoint. Same reasoning as station-robots.test.ts.
//
// The assertions that matter most are in "a failed read is not an empty one": every other
// property here is convenience, but a 403 that deserialises as `reviewCount: 0` makes
// LOCAL-007 report a fabricated fail against a client with four hundred reviews.

import { describe, expect, it } from 'vitest'
import type { OAuth2Client } from 'google-auth-library'
import {
  countReviewsSince,
  fetchLocationMedia,
  fetchLocationReviews,
  summariseReviews,
  v4LocationResourceName,
  type GbpAccessTokenSource,
  type GbpReview,
  type GbpReviewsPayload,
} from '@/lib/connectors/gbp-reviews'

// The reason the fetchers take a structural token source: the OAuth2Client that
// getAdminGBPOAuthClient() returns must satisfy it as-is, or the integration pass has to
// build a second auth path — which is the thing the task forbids. A compile-time check,
// so it fails at `tsc` rather than in production.
const _oauthClientIsATokenSource: (c: OAuth2Client) => GbpAccessTokenSource = (c) => c
void _oauthClientIsATokenSource

const AUTH: GbpAccessTokenSource = { getAccessToken: async () => ({ token: 'test-token' }) }

const ACCOUNT = 'accounts/104829571023'
const V1_LOCATION = 'locations/8891122'
const V4_LOCATION = 'accounts/104829571023/locations/8891122'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/** A fetch answering a scripted sequence, recording every URL it was asked for. */
function scriptedFetch(script: Array<() => Response | Promise<Response>>) {
  const calls: string[] = []
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    const next = script[calls.length - 1]
    if (!next) throw new Error(`unscripted request #${calls.length}: ${String(input)}`)
    return next()
  }) as typeof fetch
  return { impl, calls }
}

function rawReview(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reviewId: 'r1',
    starRating: 'FIVE',
    createTime: '2026-07-01T10:00:00Z',
    updateTime: '2026-07-01T10:00:00Z',
    reviewer: { displayName: 'A Customer', isAnonymous: false },
    comment: 'Great work',
    ...over,
  }
}

/** N raw reviews, so a paginated fixture does not need N literals. */
function rawReviews(n: number, startIndex = 0): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => rawReview({ reviewId: `r${startIndex + i}` }))
}

// ── resource names ────────────────────────────────────────────────────────────

describe('v4LocationResourceName', () => {
  // The conversion the whole module turns on. v1 hands back locations/{id}; v4 wants
  // accounts/{a}/locations/{l}, and handing v4 the v1 name 404s as though the location
  // simply had no reviews.
  it('converts a Business Information v1 name into the v4 form', () => {
    expect(v4LocationResourceName(ACCOUNT, V1_LOCATION)).toEqual({ ok: true, name: V4_LOCATION })
  })

  it('accepts a bare location id and an unprefixed account', () => {
    expect(v4LocationResourceName('104829571023', '8891122')).toEqual({
      ok: true,
      name: V4_LOCATION,
    })
  })

  it('passes an already-v4 name through, with or without a matching account', () => {
    expect(v4LocationResourceName(ACCOUNT, V4_LOCATION)).toEqual({ ok: true, name: V4_LOCATION })
    expect(v4LocationResourceName(null, V4_LOCATION)).toEqual({ ok: true, name: V4_LOCATION })
  })

  // The fa08ce6 rule: a read that cannot prove the resource belongs to the account it is
  // scoped to must refuse, not guess. Trusting the embedded account is how one client's
  // reviews land on another client's audit.
  it('refuses a v4 name whose account contradicts the scope it was read under', () => {
    const out = v4LocationResourceName('accounts/999', V4_LOCATION)
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.error).toContain('accounts/104829571023')
    expect(out.error).toContain('accounts/999')
  })

  it('refuses a v1 name with no account, and says why', () => {
    const out = v4LocationResourceName(null, V1_LOCATION)
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.error).toContain('accounts/{accountId}/locations/{locationId}')
  })

  it('refuses names it does not recognise', () => {
    expect(v4LocationResourceName(ACCOUNT, '').ok).toBe(false)
    expect(v4LocationResourceName(ACCOUNT, 'accounts/1/locations/2/reviews/3').ok).toBe(false)
    expect(v4LocationResourceName('accounts/1/locations/2', V1_LOCATION).ok).toBe(false)
  })
})

// ── pagination ────────────────────────────────────────────────────────────────

describe('fetchLocationReviews pagination', () => {
  it('walks every page and returns the whole review set', async () => {
    const { impl, calls } = scriptedFetch([
      () => jsonResponse({ reviews: rawReviews(50, 0), totalReviewCount: 120, averageRating: 4.8, nextPageToken: 'p2' }),
      () => jsonResponse({ reviews: rawReviews(50, 50), totalReviewCount: 120, averageRating: 4.8, nextPageToken: 'p3' }),
      () => jsonResponse({ reviews: rawReviews(20, 100), totalReviewCount: 120, averageRating: 4.8 }),
    ])

    const res = await fetchLocationReviews(AUTH, V1_LOCATION, {
      accountName: ACCOUNT,
      fetchImpl: impl,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.reviews).toHaveLength(120)
    expect(res.data.pagesFetched).toBe(3)
    expect(res.data.complete).toBe(true)
    expect(res.data.totalReviewCount).toBe(120)
    expect(calls).toHaveLength(3)
  })

  // The conversion, observed at the wire rather than only in the pure helper.
  it('requests the v4 resource path, not the v1 one it was given', async () => {
    const { impl, calls } = scriptedFetch([() => jsonResponse({ reviews: [], totalReviewCount: 0 })])
    await fetchLocationReviews(AUTH, V1_LOCATION, { accountName: ACCOUNT, fetchImpl: impl })

    expect(calls[0]).toContain(`https://mybusiness.googleapis.com/v4/${V4_LOCATION}/reviews`)
    expect(calls[0]).not.toContain('/v4/locations/')
  })

  it('carries the page token forward', async () => {
    const { impl, calls } = scriptedFetch([
      () => jsonResponse({ reviews: rawReviews(2), nextPageToken: 'tok-2' }),
      () => jsonResponse({ reviews: rawReviews(1, 2) }),
    ])
    await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl })

    expect(calls[0]).not.toContain('pageToken')
    expect(calls[1]).toContain('pageToken=tok-2')
  })

  // A location with 300 reviews must not silently return the first page. When the cap
  // stops us short the rows are a FLOOR, and saying so is the difference between a
  // not_run and a wrong number.
  it('reports the page cap as a failure carrying a partial, never as a complete read', async () => {
    const { impl } = scriptedFetch([
      () => jsonResponse({ reviews: rawReviews(50, 0), totalReviewCount: 300, nextPageToken: 'p2' }),
      () => jsonResponse({ reviews: rawReviews(50, 50), totalReviewCount: 300, nextPageToken: 'p3' }),
    ])

    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl, maxPages: 2 })

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('page_cap')
    expect(res.error).toContain('floor')
    expect(res.partial?.reviews).toHaveLength(100)
    // The second line of defence: even a caller that digs into `partial` cannot mistake
    // 100 rows for the location's 300 reviews.
    expect(res.partial?.complete).toBe(false)
  })

  it('refuses a server that repeats its own page token rather than looping to the cap', async () => {
    const { impl } = scriptedFetch([
      () => jsonResponse({ reviews: rawReviews(1), nextPageToken: 'same' }),
      () => jsonResponse({ reviews: rawReviews(1, 1), nextPageToken: 'same' }),
    ])

    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl, maxPages: 50 })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('malformed_response')
  })
})

// ── failure vs emptiness ──────────────────────────────────────────────────────

describe('a failed read is not an empty one', () => {
  it('surfaces a 403 as a failure, with no reviews payload at all', async () => {
    const { impl } = scriptedFetch([
      () => new Response('{"error":{"message":"caller lacks permission"}}', { status: 403 }),
    ])

    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('http_status')
    expect(res.httpStatus).toBe(403)
    expect(res.error).toContain('business.manage')
    expect(res.partial?.reviews ?? []).toEqual([])
    expect(res.partial?.complete ?? false).toBe(false)
  })

  // The likeliest real failure, and the one whose message has to teach: a v4 404 is
  // almost always the v1/v4 resource-name mismatch, not "this location has no reviews".
  it('surfaces a 404 as a failure and names the resource-name mismatch', async () => {
    const { impl } = scriptedFetch([() => new Response('not found', { status: 404 })])

    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.httpStatus).toBe(404)
    expect(res.error).toContain('accounts/{accountId}/locations/{locationId}')
  })

  it('surfaces a network error as a failure', async () => {
    const { impl } = scriptedFetch([
      () => {
        throw new Error('ECONNRESET')
      },
    ])
    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('network')
  })

  it('fails before any request when no access token can be minted', async () => {
    const { impl, calls } = scriptedFetch([])
    const res = await fetchLocationReviews(
      { getAccessToken: async () => ({ token: null }) },
      V4_LOCATION,
      { fetchImpl: impl },
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('no_access_token')
    expect(calls).toEqual([])
  })

  it('fails before any request when the resource name cannot be resolved', async () => {
    const { impl, calls } = scriptedFetch([])
    const res = await fetchLocationReviews(AUTH, V1_LOCATION, { fetchImpl: impl })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('bad_resource_name')
    expect(calls).toEqual([])
  })

  // The load-bearing distinction. Google saying "zero reviews" is a measurement a check
  // may act on; a 403 is not, and the two must never deserialise to the same thing.
  it('distinguishes a genuine zero-review location from a failed read', async () => {
    const empty = scriptedFetch([() => jsonResponse({ totalReviewCount: 0 })])
    const denied = scriptedFetch([() => new Response('nope', { status: 403 })])

    const zero = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: empty.impl })
    const failed = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: denied.impl })

    expect(zero.ok).toBe(true)
    if (!zero.ok) throw new Error(zero.error)
    expect(zero.data.reviews).toEqual([])
    expect(zero.data.totalReviewCount).toBe(0)
    expect(zero.data.complete).toBe(true)

    expect(failed.ok).toBe(false)
    // …and there is no `data` to read off the failure, so `if (!res.ok) return not_run`
    // is the only thing a caller can write.
    expect('data' in failed).toBe(false)

    // Both would summarise to reviewCount 0 — which is exactly why the ok flag, not the
    // number, is what a check must branch on.
    if (failed.ok) throw new Error('unreachable')
    expect(summariseReviews(zero.data).totalReviewCount).toBe(0)
    expect(summariseReviews(zero.data).complete).toBe(true)
  })
})

// ── parsing ───────────────────────────────────────────────────────────────────

describe('review parsing', () => {
  it('reads the owner reply from reviewReply, which is what v4 calls it', async () => {
    const { impl } = scriptedFetch([
      () =>
        jsonResponse({
          reviews: [
            rawReview({
              reviewId: 'replied',
              reviewReply: { comment: 'Thanks!', updateTime: '2026-07-02T09:00:00Z' },
            }),
            rawReview({ reviewId: 'unreplied' }),
          ],
          totalReviewCount: 2,
        }),
    ])

    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.reviews[0].reply).toEqual({
      comment: 'Thanks!',
      updateTime: '2026-07-02T09:00:00Z',
    })
    expect(res.data.reviews[1].reply).toBeNull()
    // The consequence of getting the field name wrong: a 50% response rate reads as 0%.
    expect(summariseReviews(res.data).responseRate).toBe(0.5)
  })

  it('maps the star enum to a number and leaves an unknown one null, never zero', async () => {
    const { impl } = scriptedFetch([
      () =>
        jsonResponse({
          reviews: [
            rawReview({ starRating: 'ONE' }),
            rawReview({ starRating: 'STAR_RATING_UNSPECIFIED' }),
            rawReview({ starRating: 'SIX_SOMEHOW' }),
          ],
          totalReviewCount: 3,
        }),
    ])

    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.reviews.map((r) => r.starRating)).toEqual([1, null, null])
    expect(res.data.reviews[2].starRatingRaw).toBe('SIX_SOMEHOW')
  })

  it('treats a star-only review as a review, not as missing data', async () => {
    const { impl } = scriptedFetch([
      () => jsonResponse({ reviews: [rawReview({ comment: undefined })], totalReviewCount: 1 }),
    ])
    const res = await fetchLocationReviews(AUTH, V4_LOCATION, { fetchImpl: impl })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.reviews[0].comment).toBeNull()
    expect(res.data.reviews[0].starRating).toBe(5)
  })
})

// ── summary maths ─────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-08-07T12:00:00Z')
const DAY = 86_400_000

function review(over: Partial<GbpReview> = {}): GbpReview {
  return {
    name: null,
    reviewId: 'x',
    starRating: 5,
    starRatingRaw: 'FIVE',
    createTime: new Date(NOW - DAY).toISOString(),
    updateTime: null,
    reviewer: { displayName: null, isAnonymous: false },
    comment: null,
    reply: null,
    ...over,
  }
}

function payload(reviews: GbpReview[], over: Partial<GbpReviewsPayload> = {}): GbpReviewsPayload {
  return {
    locationResourceName: V4_LOCATION,
    reviews,
    totalReviewCount: reviews.length,
    averageRating: null,
    pagesFetched: 1,
    complete: true,
    ...over,
  }
}

describe('summariseReviews — response rate (LOCAL-009)', () => {
  it('counts replies over reviews', () => {
    const s = summariseReviews(
      payload([
        review({ reply: { comment: 'thanks', updateTime: null } }),
        review({ reply: { comment: 'thanks', updateTime: null } }),
        review(),
        review(),
      ]),
      { now: NOW },
    )
    expect(s.repliedReviews).toBe(2)
    expect(s.responseRate).toBe(0.5)
  })

  // 0 of 0 is not a 0% response rate. A `0` here is a measured fail on a client with no
  // reviews to respond to — the fabricated-verdict failure mode, with a plausible number.
  it('returns null rather than 0 when there are no reviews', () => {
    const s = summariseReviews(payload([]), { now: NOW })
    expect(s.responseRate).toBeNull()
    expect(s.negativeResponseRate).toBeNull()
  })

  it('tracks negatives separately, at 3 stars and below', () => {
    const s = summariseReviews(
      payload([
        review({ starRating: 1, reply: { comment: 'sorry', updateTime: null } }),
        review({ starRating: 3 }),
        review({ starRating: 4 }),
        review({ starRating: 5 }),
      ]),
      { now: NOW },
    )
    expect(s.negativeReviews).toBe(2)
    expect(s.negativeRepliedReviews).toBe(1)
    expect(s.negativeResponseRate).toBe(0.5)
  })

  it('returns null negative response rate when every review is positive', () => {
    const s = summariseReviews(payload([review({ starRating: 5 }), review({ starRating: 4 })]), {
      now: NOW,
    })
    expect(s.negativeReviews).toBe(0)
    expect(s.negativeResponseRate).toBeNull()
  })

  it('honours a caller-supplied negative threshold', () => {
    const s = summariseReviews(payload([review({ starRating: 3 })]), {
      now: NOW,
      negativeMaxStars: 2,
    })
    expect(s.negativeReviews).toBe(0)
  })
})

describe('summariseReviews — recency (LOCAL-008)', () => {
  it('counts the 30/90/365 day windows', () => {
    const s = summariseReviews(
      payload([
        review({ createTime: new Date(NOW - 5 * DAY).toISOString() }),
        review({ createTime: new Date(NOW - 45 * DAY).toISOString() }),
        review({ createTime: new Date(NOW - 200 * DAY).toISOString() }),
        review({ createTime: new Date(NOW - 500 * DAY).toISOString() }),
      ]),
      { now: NOW },
    )
    expect(s.reviewsLast30Days).toBe(1)
    expect(s.reviewsLast90Days).toBe(2)
    expect(s.reviewsLast365Days).toBe(3)
  })

  // Inclusive at the lower bound. LOCAL-008 turns on counts small enough that losing one
  // review to a rounding artefact changes the verdict.
  it('includes a review landing exactly on the window edge, and excludes one a millisecond older', () => {
    const onEdge = review({ createTime: new Date(NOW - 30 * DAY).toISOString() })
    const justOutside = review({ createTime: new Date(NOW - 30 * DAY - 1).toISOString() })

    expect(summariseReviews(payload([onEdge]), { now: NOW }).reviewsLast30Days).toBe(1)
    expect(summariseReviews(payload([justOutside]), { now: NOW }).reviewsLast30Days).toBe(0)
    expect(countReviewsSince([onEdge], NOW - 30 * DAY)).toBe(1)
    expect(countReviewsSince([justOutside], NOW - 30 * DAY)).toBe(0)
  })

  // An undated review is not a recent one. Dating it to now would invent velocity on a
  // profile that has none.
  it('counts an undated review in no window, but still in the rows read', () => {
    const s = summariseReviews(
      payload([review({ createTime: null }), review({ createTime: 'not a date' })]),
      { now: NOW },
    )
    expect(s.undatedReviews).toBe(2)
    expect(s.reviewsLast365Days).toBe(0)
    expect(s.reviewsRead).toBe(2)
    expect(s.newestReviewAt).toBeNull()
    expect(s.daysSinceNewestReview).toBeNull()
  })

  it('reports the newest review and how stale it is', () => {
    const newest = new Date(NOW - 10 * DAY).toISOString()
    const s = summariseReviews(
      payload([
        review({ createTime: new Date(NOW - 400 * DAY).toISOString() }),
        review({ createTime: newest }),
      ]),
      { now: NOW },
    )
    expect(s.newestReviewAt).toBe(newest)
    expect(s.daysSinceNewestReview).toBe(10)
  })

  it('clamps clock skew instead of reporting negative staleness', () => {
    const s = summariseReviews(
      payload([review({ createTime: new Date(NOW + 2 * DAY).toISOString() })]),
      { now: NOW },
    )
    expect(s.daysSinceNewestReview).toBe(0)
    expect(s.reviewsLast30Days).toBe(1)
  })
})

describe('summariseReviews — volume and rating (LOCAL-007, LOCAL-010)', () => {
  // Google's aggregate covers reviews we may never page to, which is what makes these two
  // checks answerable from page one.
  it("prefers Google's own total and average over the rows", () => {
    const s = summariseReviews(
      payload([review({ starRating: 1 })], { totalReviewCount: 412, averageRating: 4.7 }),
      { now: NOW },
    )
    expect(s.totalReviewCount).toBe(412)
    expect(s.totalReviewCountSource).toBe('api')
    expect(s.averageRating).toBe(4.7)
    expect(s.averageRatingSource).toBe('api')
    expect(s.reviewsRead).toBe(1)
  })

  it('derives the average from rated rows when the API omitted it', () => {
    const s = summariseReviews(
      payload([review({ starRating: 5 }), review({ starRating: 4 })], {
        totalReviewCount: null,
        averageRating: null,
      }),
      { now: NOW },
    )
    expect(s.averageRating).toBe(4.5)
    expect(s.averageRatingSource).toBe('derived')
    expect(s.totalReviewCountSource).toBe('rows')
    expect(s.totalReviewCount).toBe(2)
  })

  // 0 is not expressible on a 1–5 scale, so a 0 average means "absent". Carrying it
  // through would hand LOCAL-010 (target >= 4.5) a fabricated fail.
  it('treats an averageRating of 0 as absent, not as a zero-star profile', () => {
    const s = summariseReviews(payload([], { totalReviewCount: 0, averageRating: 0 }), { now: NOW })
    expect(s.averageRating).toBeNull()
    expect(s.averageRatingSource).toBe('none')
  })

  it('excludes unrated rows from a derived mean and counts them', () => {
    const s = summariseReviews(
      payload([review({ starRating: 4 }), review({ starRating: null, starRatingRaw: 'STAR_RATING_UNSPECIFIED' })], {
        averageRating: null,
      }),
      { now: NOW },
    )
    // 4, not 2 — an unrated review must not be averaged in as a zero.
    expect(s.averageRating).toBe(4)
    expect(s.unratedReviews).toBe(1)
  })

  it('carries the incompleteness of a truncated read into the summary', () => {
    const s = summariseReviews(payload([review()], { complete: false }), { now: NOW })
    expect(s.complete).toBe(false)
  })
})

// ── media ─────────────────────────────────────────────────────────────────────

describe('fetchLocationMedia (LOCAL-003 photo count)', () => {
  it('counts photos across pages and keeps videos out of the photo count', async () => {
    const { impl, calls } = scriptedFetch([
      () =>
        jsonResponse({
          mediaItems: [
            { mediaFormat: 'PHOTO' },
            { mediaFormat: 'PHOTO' },
            { mediaFormat: 'VIDEO' },
          ],
          totalMediaItemCount: 5,
          nextPageToken: 'm2',
        }),
      () =>
        jsonResponse({
          mediaItems: [{ mediaFormat: 'PHOTO' }, { mediaFormat: 'MEDIA_FORMAT_UNSPECIFIED' }],
          totalMediaItemCount: 5,
        }),
    ])

    const res = await fetchLocationMedia(AUTH, V1_LOCATION, {
      accountName: ACCOUNT,
      fetchImpl: impl,
    })
    if (!res.ok) throw new Error(res.error)

    expect(res.data.photoCount).toBe(3)
    expect(res.data.videoCount).toBe(1)
    expect(res.data.mediaItemCount).toBe(5)
    // Google's aggregate spans videos too, so it is not the number LOCAL-003 reads.
    expect(res.data.totalMediaItemCount).toBe(5)
    expect(res.data.complete).toBe(true)
    expect(calls[0]).toContain(`/v4/${V4_LOCATION}/media`)
  })

  it('reports a location with no media as a real zero', async () => {
    const { impl } = scriptedFetch([() => jsonResponse({ totalMediaItemCount: 0 })])
    const res = await fetchLocationMedia(AUTH, V4_LOCATION, { fetchImpl: impl })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.photoCount).toBe(0)
    expect(res.data.complete).toBe(true)
  })

  // The LOCAL-003 fabricated-fail guard: photoCount 0 out of a 403 reads as "missing
  // photos" on a profile with two dozen.
  it('surfaces a 403 as a failure rather than a zero photo count', async () => {
    const { impl } = scriptedFetch([() => new Response('denied', { status: 403 })])
    const res = await fetchLocationMedia(AUTH, V4_LOCATION, { fetchImpl: impl })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.httpStatus).toBe(403)
    expect('data' in res).toBe(false)
    expect(res.partial?.complete).toBe(false)
  })

  it('reports the page cap as a floor rather than a count', async () => {
    const { impl } = scriptedFetch([
      () => jsonResponse({ mediaItems: [{ mediaFormat: 'PHOTO' }], nextPageToken: 'm2' }),
    ])
    const res = await fetchLocationMedia(AUTH, V4_LOCATION, { fetchImpl: impl, maxPages: 1 })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.reason).toBe('page_cap')
    expect(res.partial?.photoCount).toBe(1)
    expect(res.partial?.complete).toBe(false)
  })
})
