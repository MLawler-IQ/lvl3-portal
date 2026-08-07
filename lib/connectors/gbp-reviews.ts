// Google My Business API **v4** — reviews and media for a single Business Profile location.
//
// WHY THIS FILE EXISTS. lib/stations/gbp.ts records `rating`, `reviewCount` and `photoCount`
// as "no source", because the Business Information API v1 does not carry them and the
// earlier analysis concluded the legacy v4 API was unavailable. That conclusion was wrong:
// `mybusiness.googleapis.com` is enabled on the lvl3-portal Google Cloud project as a
// Private API with real granted quota (250,000 requests/day, 600/min, 3,000/min on "V4
// General Requests"), and the portal's Business Profile OAuth token already carries
// `https://www.googleapis.com/auth/business.manage` — the scope v4 needs. Nothing had ever
// called it; usage was 0%.
//
// Five permanently `not_run` rubric checks depend on what this reads:
//   LOCAL-007  review volume vs local-pack competitors   → totalReviewCount
//   LOCAL-008  review velocity and recency               → reviewsLast30/90/365, newestReviewAt
//   LOCAL-009  owner response rate, negatives included   → responseRate, negativeResponseRate
//   LOCAL-010  average star rating (target >= 4.5)       → averageRating
//   LOCAL-003  GBP completeness (photos limb)            → photoCount, from fetchLocationMedia
//
// THE PROPERTY THAT MATTERS MOST: a failed or truncated read is never an empty successful
// one. Commit fa08ce6 is the precedent for what a careless GBP read costs — it returned a
// whole shared container across clients — and the fabricated-verdict rule from
// lib/stations/gbp.ts applies here with the sign flipped: a check that reads
// `reviewCount: 0` out of a 403 reports "no reviews" as a measured fail about a client who
// may have four hundred. So `ok: true` means, and only means, "this is the COMPLETE review
// set for this location". A page-cap truncation is `ok: false` carrying `partial`, exactly
// like ToolErr<T>.partial, so the natural `if (!res.ok) return not_run` is automatically
// the correct thing to write. `{ ok: true, data: { reviews: [], totalReviewCount: 0 } }` is
// reachable only when Google actually said there are no reviews.
//
// TRANSPORT. `google` from the googleapis package has no typed v4 client — v4 is plain
// REST — so this uses `fetch` with the OAuth access token, the same shape as
// fetchGBPLocationInsights in lib/connectors/gbp.ts. Auth is the OAuth2Client from
// getAdminGBPOAuthClient(); it is taken structurally (see GbpAccessTokenSource) so tests
// never construct one.
//
// REQUEST COST, PER LOCATION. reviews.list pages at 50 (the documented v4 maximum) and
// media.list at 100, so one location costs ceil(reviews/50) + ceil(media/100) requests:
// 2–3 for a typical home-services profile (say 120 reviews, 25 photos), and at most
// MAX_REVIEW_PAGES + MAX_MEDIA_PAGES = 30 for the largest. A 107-brand Apex run is
// therefore ~300 requests typical and ~3,200 worst case against a 250,000/day grant — the
// per-minute ceiling (600) binds long before the daily one, so callers should keep
// locations sequential rather than fanning out.

// ── transport constants ───────────────────────────────────────────────────────

const GBP_V4_BASE = 'https://mybusiness.googleapis.com/v4'

/** v4's documented maximum for reviews.list. Asking for more is an INVALID_ARGUMENT. */
const MAX_REVIEW_PAGE_SIZE = 50
const DEFAULT_MEDIA_PAGE_SIZE = 100

/** 20 × 50 = 1,000 reviews before we stop and say so. */
const DEFAULT_MAX_REVIEW_PAGES = 20
/** 10 × 100 = 1,000 media items before we stop and say so. */
const DEFAULT_MAX_MEDIA_PAGES = 10

const DEFAULT_TIMEOUT_MS = 15000

// ── result model ──────────────────────────────────────────────────────────────

/**
 * Why a read did not produce a complete answer.
 *
 * `page_cap` is deliberately in the same union as `http_status`: both mean "do not treat
 * the numbers as the location's real numbers", and giving truncation its own happier
 * shape is how a floor gets reported as a total.
 */
export type GbpReadFailureReason =
  | 'bad_resource_name'
  | 'no_access_token'
  | 'http_status'
  | 'network'
  | 'malformed_response'
  | 'page_cap'

export interface GbpReadFailure<T> {
  ok: false
  reason: GbpReadFailureReason
  /** Human-readable, safe to put in a station note. */
  error: string
  /** Present for `http_status`. 403 and 404 are the two worth branching on. */
  httpStatus?: number
  /**
   * What was read before the failure, when anything was. NEVER a substitute for a
   * complete read — `partial.complete` is false, so any consumer that reaches in here
   * still has the truncation in hand.
   */
  partial?: T
}

export type GbpReadResult<T> = { ok: true; data: T } | GbpReadFailure<T>

/** One review, flattened out of the v4 payload. */
export interface GbpReview {
  /** v4 resource name: accounts/{a}/locations/{l}/reviews/{r}. */
  name: string | null
  reviewId: string | null
  /** 1–5, or null when Google sent STAR_RATING_UNSPECIFIED or an enum we do not know. */
  starRating: number | null
  /** The raw enum, kept so an unmapped value is diagnosable rather than just missing. */
  starRatingRaw: string | null
  /** RFC 3339, as Google sent it. */
  createTime: string | null
  updateTime: string | null
  reviewer: { displayName: string | null; isAnonymous: boolean }
  /** Review text. Null for a star-only review, which is common and is not an error. */
  comment: string | null
  /** The owner's reply, or null when there is none. This is what LOCAL-009 counts. */
  reply: { comment: string | null; updateTime: string | null } | null
}

export interface GbpReviewsPayload {
  /** The v4 name actually requested — useful when the caller passed the v1 shape. */
  locationResourceName: string
  reviews: GbpReview[]
  /**
   * Google's own aggregate, returned on EVERY page.
   *
   * Authoritative over the rows: it covers reviews we never paged to, so LOCAL-007 and
   * LOCAL-010 are answerable from page one even when the row list is truncated. Null only
   * when the response omitted it.
   */
  totalReviewCount: number | null
  averageRating: number | null
  pagesFetched: number
  /**
   * True only when pagination ran to Google's own end. The second line of defence behind
   * the ok/!ok split: a consumer that digs into `partial` still cannot mistake a floor
   * for a total.
   */
  complete: boolean
}

export interface GbpMediaPayload {
  locationResourceName: string
  /** Media items with mediaFormat === 'PHOTO'. This is the number LOCAL-003 reads. */
  photoCount: number
  videoCount: number
  /** Rows actually read (photos + videos + anything of an unknown format). */
  mediaItemCount: number
  /** Google's aggregate over ALL media, videos included — not a photo count. */
  totalMediaItemCount: number | null
  pagesFetched: number
  complete: boolean
}

// ── auth ──────────────────────────────────────────────────────────────────────

/**
 * Just enough of google-auth-library's OAuth2Client to mint a bearer token.
 *
 * Structural rather than the concrete class so a test can pass `{ getAccessToken: async
 * () => ({ token: 'x' }) }` and no test can accidentally reach Google. The OAuth2Client
 * returned by getAdminGBPOAuthClient() satisfies this as-is — do not build a second auth
 * path; that client already handles refresh and persists the new access token.
 */
export interface GbpAccessTokenSource {
  getAccessToken(): Promise<{ token?: string | null }>
}

// ── resource names ────────────────────────────────────────────────────────────

/**
 * Convert a Business Information v1 location name into the v4 form.
 *
 * THE SINGLE MOST LIKELY CAUSE OF A 404 HERE. v1 (`mybusinessbusinessinformation`)
 * returns `locations/{locationId}` — no account segment; that is what GBPLocation.name
 * holds throughout this repo, and what the Business Profile Performance API accepts. v4
 * addresses the same location as `accounts/{accountId}/locations/{locationId}`. Handing
 * v4 a v1 name is a well-formed request for a resource that does not exist, so it 404s
 * rather than complaining about the shape, and the 404 looks exactly like "this location
 * has no reviews endpoint" to anyone reading the log.
 *
 * REFUSING A CROSS-ACCOUNT NAME IS THE fa08ce6 RULE, not fussiness. If the caller hands
 * in a fully-qualified v4 name whose account differs from the account it says it is
 * reading, one of the two is wrong, and silently trusting the embedded one is how a read
 * scoped to client A returns client B's reviews. Refuse, and make the caller resolve it.
 */
export function v4LocationResourceName(
  accountName: string | null | undefined,
  locationName: string | null | undefined,
): { ok: true; name: string } | { ok: false; error: string } {
  const loc = (locationName ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (loc.length === 0) {
    return { ok: false, error: 'no location name was supplied' }
  }

  const account = normaliseAccountName(accountName)

  // Already v4: accounts/{a}/locations/{l}.
  const full = /^accounts\/([^/]+)\/locations\/([^/]+)$/.exec(loc)
  if (full) {
    if (account && account !== `accounts/${full[1]}`) {
      return {
        ok: false,
        error:
          `location ${JSON.stringify(loc)} belongs to accounts/${full[1]}, but the read was ` +
          `scoped to ${account}. Refusing rather than guessing which is right — reading one ` +
          `account's location under another account's scope is how one client's data ends ` +
          `up on another client's audit.`,
      }
    }
    return { ok: true, name: loc }
  }

  // v1 shape, or a bare id. Both need an account to become addressable.
  const short = /^locations\/([^/]+)$/.exec(loc)
  const locationId = short ? short[1] : /^[^/]+$/.test(loc) ? loc : null
  if (locationId === null) {
    return { ok: false, error: `${JSON.stringify(loc)} is not a recognisable GBP location name` }
  }
  if (!account) {
    return {
      ok: false,
      error:
        `${JSON.stringify(loc)} is a Business Information v1 location name and v4 needs ` +
        `accounts/{accountId}/locations/{locationId}, but no account was supplied. Pass the ` +
        `client's gbp_account_id (or the scoped parent from decideGBPScope).`,
    }
  }
  return { ok: true, name: `${account}/locations/${locationId}` }
}

/** 'accounts/123' | '123' -> 'accounts/123'. Null/blank -> null. Any other shape -> null. */
function normaliseAccountName(accountName: string | null | undefined): string | null {
  const raw = (accountName ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (raw.length === 0) return null
  const m = /^accounts\/([^/]+)$/.exec(raw)
  if (m) return `accounts/${m[1]}`
  if (/^[^/]+$/.test(raw)) return `accounts/${raw}`
  return null
}

// ── fetch options ─────────────────────────────────────────────────────────────

export interface GbpV4FetchOptions {
  /**
   * The client's GBP account, needed whenever `locationResourceName` is the v1
   * `locations/{id}` shape. Ignored when a full v4 name is passed, except that a
   * mismatch is refused — see v4LocationResourceName.
   */
  accountName?: string | null
  /**
   * Injected in tests. A global-fetch stub would let a case the test forgot to route
   * make a real network call; an injected impl makes "this cannot reach the network" a
   * property of the call site. Same reasoning as lib/stations/robots.ts.
   */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Pages, not rows. Hitting it is a failure, not a quiet truncation. */
  maxPages?: number
  pageSize?: number
}

// ── reviews ───────────────────────────────────────────────────────────────────

interface RawV4Review {
  name?: string | null
  reviewId?: string | null
  starRating?: string | null
  comment?: string | null
  createTime?: string | null
  updateTime?: string | null
  reviewer?: { displayName?: string | null; isAnonymous?: boolean | null } | null
  // NOTE the field name: v4 calls the owner's reply `reviewReply`, not `reply`. Reading
  // `reply` here would make every location look like it never responds to anyone, which
  // LOCAL-009 would report as a measured 0% response rate.
  reviewReply?: { comment?: string | null; updateTime?: string | null } | null
}

interface RawV4ReviewsPage {
  reviews?: RawV4Review[] | null
  averageRating?: number | null
  totalReviewCount?: number | null
  nextPageToken?: string | null
}

/**
 * Every review on one location, with the owner's replies.
 *
 * Paginates to the end. A location with 300 reviews returns 300 reviews or an explicit
 * failure — never the first 50 dressed up as the whole set.
 */
export async function fetchLocationReviews(
  auth: GbpAccessTokenSource,
  locationResourceName: string,
  opts: GbpV4FetchOptions = {},
): Promise<GbpReadResult<GbpReviewsPayload>> {
  const resolved = v4LocationResourceName(opts.accountName, locationResourceName)
  if (!resolved.ok) {
    return { ok: false, reason: 'bad_resource_name', error: resolved.error }
  }
  const name = resolved.name

  const token = await accessToken(auth)
  if (!token.ok) return { ok: false, reason: 'no_access_token', error: token.error }

  const pageSize = clamp(opts.pageSize ?? MAX_REVIEW_PAGE_SIZE, 1, MAX_REVIEW_PAGE_SIZE)
  const maxPages = Math.max(1, opts.maxPages ?? DEFAULT_MAX_REVIEW_PAGES)

  const reviews: GbpReview[] = []
  let totalReviewCount: number | null = null
  let averageRating: number | null = null
  let pageToken: string | undefined
  let pagesFetched = 0

  for (;;) {
    const params = new URLSearchParams({ pageSize: String(pageSize) })
    if (pageToken) params.set('pageToken', pageToken)
    const url = `${GBP_V4_BASE}/${name}/reviews?${params.toString()}`

    const page = await getJson(url, token.token, opts)
    if (!page.ok) {
      return {
        ...page,
        error: describeHttpFailure(page, name, 'reviews'),
        partial: snapshotReviews(),
      }
    }

    const body = page.json as RawV4ReviewsPage | null
    if (body === null || typeof body !== 'object') {
      return {
        ok: false,
        reason: 'malformed_response',
        error: `the reviews response for ${name} was not a JSON object`,
        partial: snapshotReviews(),
      }
    }

    pagesFetched += 1
    for (const raw of body.reviews ?? []) reviews.push(parseReview(raw))

    // Google's aggregates ride on every page; the last one seen wins. They cover reviews
    // we may never page to, which is why they are kept separate from the rows.
    if (isFiniteNumber(body.totalReviewCount)) totalReviewCount = body.totalReviewCount
    // A rating of 0 is not expressible on a 1–5 scale, so Google omitting the field and
    // sending 0 mean the same thing: no rating. Carrying a 0 through would hand LOCAL-010
    // a fabricated fail on a location with no reviews at all.
    if (isFiniteNumber(body.averageRating) && body.averageRating > 0) {
      averageRating = body.averageRating
    }

    const next = body.nextPageToken?.trim() || undefined
    if (!next) break

    // A server that repeats its own page token would spin here forever. Treat it as a
    // malformed response rather than looping to the cap and calling it truncation.
    if (next === pageToken) {
      return {
        ok: false,
        reason: 'malformed_response',
        error: `the reviews response for ${name} repeated page token ${JSON.stringify(next)}`,
        partial: snapshotReviews(),
      }
    }
    pageToken = next

    if (pagesFetched >= maxPages) {
      return {
        ok: false,
        reason: 'page_cap',
        error:
          `stopped after ${pagesFetched} pages (${reviews.length} reviews) for ${name} and ` +
          `Google offered more. The rows are a floor, not a total, so they must not be ` +
          `reported as this location's review history. Raise maxPages if this is a genuinely ` +
          `large profile.`,
        partial: snapshotReviews(),
      }
    }
  }

  return { ok: true, data: { ...snapshotReviews(), complete: true } }

  function snapshotReviews(): GbpReviewsPayload {
    return {
      locationResourceName: name,
      reviews: [...reviews],
      totalReviewCount,
      averageRating,
      pagesFetched,
      complete: false,
    }
  }
}

/** v4 star ratings are an enum, not a number. Anything unlisted stays null, never 0. */
const STAR_RATING_VALUES: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

function parseReview(raw: RawV4Review): GbpReview {
  const rating = raw.starRating ?? null
  const reply = raw.reviewReply ?? null
  return {
    name: raw.name ?? null,
    reviewId: raw.reviewId ?? null,
    starRating: rating !== null ? (STAR_RATING_VALUES[rating] ?? null) : null,
    starRatingRaw: rating,
    createTime: raw.createTime ?? null,
    updateTime: raw.updateTime ?? null,
    reviewer: {
      displayName: raw.reviewer?.displayName ?? null,
      isAnonymous: raw.reviewer?.isAnonymous === true,
    },
    comment: raw.comment ?? null,
    reply: reply
      ? { comment: reply.comment ?? null, updateTime: reply.updateTime ?? null }
      : null,
  }
}

// ── media ─────────────────────────────────────────────────────────────────────

interface RawV4MediaItem {
  name?: string | null
  mediaFormat?: string | null
}

interface RawV4MediaPage {
  mediaItems?: RawV4MediaItem[] | null
  totalMediaItemCount?: number | null
  nextPageToken?: string | null
}

/**
 * Enough media to count photos for LOCAL-003.
 *
 * `totalMediaItemCount` is Google's count of ALL media on the location — videos included —
 * so it cannot stand in for a photo count, which is why this pages and counts formats
 * rather than reading the aggregate and stopping. The count covers the media v4's
 * media.list returns for the location; verify against a live account before describing it
 * to a client as "every photo on the profile".
 */
export async function fetchLocationMedia(
  auth: GbpAccessTokenSource,
  locationResourceName: string,
  opts: GbpV4FetchOptions = {},
): Promise<GbpReadResult<GbpMediaPayload>> {
  const resolved = v4LocationResourceName(opts.accountName, locationResourceName)
  if (!resolved.ok) {
    return { ok: false, reason: 'bad_resource_name', error: resolved.error }
  }
  const name = resolved.name

  const token = await accessToken(auth)
  if (!token.ok) return { ok: false, reason: 'no_access_token', error: token.error }

  const pageSize = clamp(opts.pageSize ?? DEFAULT_MEDIA_PAGE_SIZE, 1, DEFAULT_MEDIA_PAGE_SIZE)
  const maxPages = Math.max(1, opts.maxPages ?? DEFAULT_MAX_MEDIA_PAGES)

  let photoCount = 0
  let videoCount = 0
  let mediaItemCount = 0
  let totalMediaItemCount: number | null = null
  let pageToken: string | undefined
  let pagesFetched = 0

  for (;;) {
    const params = new URLSearchParams({ pageSize: String(pageSize) })
    if (pageToken) params.set('pageToken', pageToken)
    const url = `${GBP_V4_BASE}/${name}/media?${params.toString()}`

    const page = await getJson(url, token.token, opts)
    if (!page.ok) {
      return {
        ...page,
        error: describeHttpFailure(page, name, 'media'),
        partial: snapshotMedia(),
      }
    }

    const body = page.json as RawV4MediaPage | null
    if (body === null || typeof body !== 'object') {
      return {
        ok: false,
        reason: 'malformed_response',
        error: `the media response for ${name} was not a JSON object`,
        partial: snapshotMedia(),
      }
    }

    pagesFetched += 1
    for (const item of body.mediaItems ?? []) {
      mediaItemCount += 1
      if (item.mediaFormat === 'PHOTO') photoCount += 1
      else if (item.mediaFormat === 'VIDEO') videoCount += 1
    }
    if (isFiniteNumber(body.totalMediaItemCount)) totalMediaItemCount = body.totalMediaItemCount

    const next = body.nextPageToken?.trim() || undefined
    if (!next) break
    if (next === pageToken) {
      return {
        ok: false,
        reason: 'malformed_response',
        error: `the media response for ${name} repeated page token ${JSON.stringify(next)}`,
        partial: snapshotMedia(),
      }
    }
    pageToken = next

    if (pagesFetched >= maxPages) {
      return {
        ok: false,
        reason: 'page_cap',
        error:
          `stopped after ${pagesFetched} pages (${mediaItemCount} media items) for ${name} ` +
          `and Google offered more, so ${photoCount} is a floor rather than the photo count.`,
        partial: snapshotMedia(),
      }
    }
  }

  return { ok: true, data: { ...snapshotMedia(), complete: true } }

  function snapshotMedia(): GbpMediaPayload {
    return {
      locationResourceName: name,
      photoCount,
      videoCount,
      mediaItemCount,
      totalMediaItemCount,
      pagesFetched,
      complete: false,
    }
  }
}

// ── summary ───────────────────────────────────────────────────────────────────

export interface GbpReviewSummary {
  /**
   * Copied from the payload. False means the rows came from a truncated read and a check
   * must report not_run rather than a verdict — `responseRate` over the first 1,000 of
   * 3,000 reviews is a statistic about our pagination, not about the client.
   */
  complete: boolean

  /** LOCAL-007. Google's own total where available; otherwise the rows we hold. */
  totalReviewCount: number
  totalReviewCountSource: 'api' | 'rows'
  /** Rows actually summarised — differs from totalReviewCount on a truncated read. */
  reviewsRead: number

  /** LOCAL-010. Google's aggregate where available, else the mean of rated rows. */
  averageRating: number | null
  averageRatingSource: 'api' | 'derived' | 'none'
  /** Rows Google gave no usable star enum for. Excluded from a derived mean, never zeroed. */
  unratedReviews: number

  /** LOCAL-008. Windows are inclusive at the lower bound; see countReviewsSince. */
  reviewsLast30Days: number
  reviewsLast90Days: number
  reviewsLast365Days: number
  newestReviewAt: string | null
  daysSinceNewestReview: number | null
  /** Rows with no parseable createTime. Counted in no window, rather than dated to now. */
  undatedReviews: number

  /** LOCAL-009. */
  repliedReviews: number
  /** null when there are no reviews at all — 0 of 0 is not a 0% response rate. */
  responseRate: number | null
  negativeReviews: number
  negativeRepliedReviews: number
  /** null when there are no negative reviews — the same 0-of-0 rule. */
  negativeResponseRate: number | null
}

export interface GbpReviewSummaryOptions {
  /** Injected in tests so the recency windows are deterministic. Defaults to Date.now(). */
  now?: Date | number
  /** Inclusive upper bound for "negative". Default 3 — a 3-star review is a complaint. */
  negativeMaxStars?: number
}

const DAY_MS = 86_400_000

/**
 * Turn a review payload into the numbers LOCAL-007/008/009/010 read.
 *
 * PURE, and takes the payload rather than the result, so it cannot itself fail. That puts
 * the fail-closed decision at the call site where it belongs: a caller holding a
 * `GbpReadFailure` must not summarise `partial` and present it as a measurement. When it
 * does anyway, `complete: false` travels through to the summary.
 */
export function summariseReviews(
  payload: GbpReviewsPayload,
  opts: GbpReviewSummaryOptions = {},
): GbpReviewSummary {
  const nowMs = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now())
  const negativeMax = opts.negativeMaxStars ?? 3
  const reviews = payload.reviews

  let ratedSum = 0
  let ratedCount = 0
  let unratedReviews = 0
  let undatedReviews = 0
  let repliedReviews = 0
  let negativeReviews = 0
  let negativeRepliedReviews = 0
  let newestMs: number | null = null
  let newestIso: string | null = null

  for (const r of reviews) {
    if (r.starRating === null) unratedReviews += 1
    else {
      ratedSum += r.starRating
      ratedCount += 1
      if (r.starRating <= negativeMax) {
        negativeReviews += 1
        if (r.reply !== null) negativeRepliedReviews += 1
      }
    }

    if (r.reply !== null) repliedReviews += 1

    const t = parseTime(r.createTime)
    if (t === null) undatedReviews += 1
    else if (newestMs === null || t > newestMs) {
      newestMs = t
      newestIso = r.createTime
    }
  }

  const apiTotal = payload.totalReviewCount
  const hasApiTotal = isFiniteNumber(apiTotal) && apiTotal >= 0

  const apiRating = payload.averageRating
  const hasApiRating = isFiniteNumber(apiRating) && apiRating > 0

  return {
    complete: payload.complete,

    totalReviewCount: hasApiTotal ? apiTotal : reviews.length,
    totalReviewCountSource: hasApiTotal ? 'api' : 'rows',
    reviewsRead: reviews.length,

    averageRating: hasApiRating
      ? apiRating
      : ratedCount > 0
        ? ratedSum / ratedCount
        : null,
    averageRatingSource: hasApiRating ? 'api' : ratedCount > 0 ? 'derived' : 'none',
    unratedReviews,

    reviewsLast30Days: countReviewsSince(reviews, nowMs - 30 * DAY_MS),
    reviewsLast90Days: countReviewsSince(reviews, nowMs - 90 * DAY_MS),
    reviewsLast365Days: countReviewsSince(reviews, nowMs - 365 * DAY_MS),
    newestReviewAt: newestIso,
    // Clamped at 0: a createTime slightly ahead of our clock is skew, and "-1 days since
    // the last review" is not a sentence any report should contain.
    daysSinceNewestReview:
      newestMs === null ? null : Math.max(0, Math.floor((nowMs - newestMs) / DAY_MS)),
    undatedReviews,

    repliedReviews,
    responseRate: reviews.length === 0 ? null : repliedReviews / reviews.length,
    negativeReviews,
    negativeRepliedReviews,
    negativeResponseRate:
      negativeReviews === 0 ? null : negativeRepliedReviews / negativeReviews,
  }
}

/**
 * Reviews created at or after `cutoffMs`.
 *
 * INCLUSIVE at the lower bound, so a review landing exactly on the window edge is inside
 * it — an exclusive bound loses a review to a rounding artefact, and LOCAL-008 turns on
 * counts small enough for one to matter. A review with no parseable createTime is in no
 * window; treating an undated row as recent would invent velocity.
 */
export function countReviewsSince(reviews: GbpReview[], cutoffMs: number): number {
  let n = 0
  for (const r of reviews) {
    const t = parseTime(r.createTime)
    if (t !== null && t >= cutoffMs) n += 1
  }
  return n
}

function parseTime(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

type JsonPage =
  | { ok: true; json: unknown }
  | { ok: false; reason: 'http_status'; error: string; httpStatus: number }
  | { ok: false; reason: 'network' | 'malformed_response'; error: string }

async function getJson(
  url: string,
  token: string,
  opts: GbpV4FetchOptions,
): Promise<JsonPage> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return {
      ok: false,
      reason: 'network',
      error: timedOut
        ? `the request timed out after ${timeoutMs} ms`
        : err instanceof Error
          ? err.message
          : String(err),
    }
  }

  if (!res.ok) {
    // No retry on 429/5xx. A retry loop inside a per-location read multiplies the
    // per-minute quota draw across a 107-brand run; backoff belongs to whatever schedules
    // the run, and a clean failure here is already honest.
    let body = ''
    try {
      body = (await res.text()).slice(0, 400)
    } catch {
      body = '<unreadable body>'
    }
    return {
      ok: false,
      reason: 'http_status',
      httpStatus: res.status,
      error: `HTTP ${res.status}${body ? `: ${body}` : ''}`,
    }
  }

  try {
    return { ok: true, json: await res.json() }
  } catch (err) {
    return {
      ok: false,
      reason: 'malformed_response',
      error: `the response body was not JSON (${err instanceof Error ? err.message : String(err)})`,
    }
  }
}

/**
 * Attach the interpretation a bare status code does not carry.
 *
 * 404 gets the resource-name warning because that is far and away its likeliest cause
 * here, and a 404 read as "this location has no reviews" is the fabricated-fail this
 * module exists to prevent. 403 gets the scope/enablement warning for the same reason
 * pointing the other way.
 */
function describeHttpFailure(
  page: Extract<JsonPage, { ok: false }>,
  name: string,
  what: 'reviews' | 'media',
): string {
  if (page.reason !== 'http_status') {
    return `could not read ${what} for ${name}: ${page.error}`
  }
  if (page.httpStatus === 404) {
    return (
      `could not read ${what} for ${name}: ${page.error}. A v4 404 usually means the ` +
      `resource name is wrong rather than that the location has none — v4 needs ` +
      `accounts/{accountId}/locations/{locationId}, while the Business Information API ` +
      `hands back locations/{locationId}.`
    )
  }
  if (page.httpStatus === 401 || page.httpStatus === 403) {
    return (
      `could not read ${what} for ${name}: ${page.error}. Check that the connected Business ` +
      `Profile identity can manage this account and that the token carries ` +
      `https://www.googleapis.com/auth/business.manage.`
    )
  }
  return `could not read ${what} for ${name}: ${page.error}`
}

async function accessToken(
  auth: GbpAccessTokenSource,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const { token } = await auth.getAccessToken()
    if (!token) {
      return { ok: false, error: 'the Business Profile OAuth client returned no access token' }
    }
    return { ok: true, token }
  } catch (err) {
    return {
      ok: false,
      error: `could not obtain a Business Profile access token: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)))
}
