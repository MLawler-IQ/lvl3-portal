// Places → coordinates → distance. The measuring instrument for LOCAL-016.
//
// WHY THIS EXISTS. The rubric row for LOCAL-016 says "an SAB ranks by proximity to its
// REAL address, not declared areas". The check as written (lib/findings/checks.ts) instead
// tests SET MEMBERSHIP of a page's derived target geography against the profile's DECLARED
// service areas. Those are different tests, and the difference is the documented pilot
// failure: Tornado HVAC serves Orange County pages from a Sherman Oaks address 45-65 miles
// away. A business that DECLARED Orange County passes set membership while still being
// unable to rank — a §9 P1 rendered as a green tick. See docs/CONTEXT-LIBRARY.md §3.
//
// This module builds the means to measure the real thing. It deliberately does NOT decide
// what distance is too far, or how a low-precision geocode should change a verdict. Those
// are rubric decisions belonging to the check; this file's job is to hand the check an
// honest number or an honest refusal, and to make the refusal impossible to misread.
//
// THE ONE PROPERTY EVERYTHING RESTS ON. A geocode that fails, is ambiguous, or resolves a
// whole county rather than a city must never be usable as a distance. That is enforced
// structurally, not by convention: coordinates exist only inside the `ok: true` branch of a
// discriminated union, so `result.point.lat` does not type-check until the caller has
// narrowed. There is no null coordinate to accidentally read as 0, and no numeric sentinel.
// A caller who cannot narrow has exactly one honest option left, which is to report
// `not_run` — which is the whole point.
//
// CACHING. Both entry points are pure in their inputs: same query, same request. One audit
// geocodes the same handful of cities across dozens of location pages, so memoising on
// `normalizeGeocodeQuery(query)` (exported for that purpose) collapses that to one call per
// distinct city. No cache is built here on purpose — a cache with the wrong lifetime is
// harder to remove than to add, and the orchestrator knows the run boundary; this module
// does not.

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json'

const DEFAULT_TIMEOUT_MS = 10_000

/** Mean Earth radius (IUGG), 6371.0088 km expressed in statute miles. */
const EARTH_RADIUS_MILES = 3958.7613

const METERS_PER_MILE = 1609.344

/**
 * Two results further apart than this are different places, not one place described twice.
 *
 * Google returns several results for many queries. "Sherman Oaks, CA" can come back twice a
 * mile apart — same place, two boundary conventions, and picking the first is harmless.
 * "Springfield" comes back in Illinois and Missouri 90 miles apart, and there is no
 * defensible way to pick. The threshold is what separates those, and it sits well above
 * any city's own diameter and well below the distances LOCAL-016 cares about.
 */
const AMBIGUITY_SPREAD_MILES = 25

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number
  lng: number
}

/**
 * How big a thing the returned point stands for.
 *
 * Keyed on Google's `types` (WHAT was found) rather than `geometry.location_type` (HOW the
 * point was derived), because the question here is "how much ground does this coordinate
 * claim to represent", and that is a property of the feature, not of the interpolation.
 *
 *  - `address` — a street address or premise. The strongest claim available.
 *  - `locality` — a city, neighbourhood or postal code centroid. Fine for "how far is the
 *    business from the city this page targets".
 *  - `area`  — a county, state or country centroid. A distance measured from here is a much
 *    weaker claim: "Orange County, CA" resolves to a point in the hills near Santiago Peak,
 *    which is nowhere near Anaheim, Irvine or Santa Ana. Surfaced so a check can weaken or
 *    withhold its verdict rather than quietly reporting a confident number.
 */
export type GeocodePrecision = 'address' | 'locality' | 'area'

export interface GeocodedPoint {
  lat: number
  lng: number
  formattedAddress: string
  precision: GeocodePrecision
  /** Google's own vocabulary, kept verbatim so a finding can quote what was matched. */
  types: string[]
  /** ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE, or null if absent. */
  locationType: string | null
  /** The query as sent, so a cached or logged point can be traced back to its input. */
  query: string
}

/**
 * Why a lookup produced no usable coordinate.
 *
 * Google's status strings are their own vocabulary and they are NOT interchangeable — the
 * caller's next move differs per kind, which is the entire reason this is not one `error`
 * string. OVER_QUERY_LIMIT means wait and retry; REQUEST_DENIED means a human has to change
 * a setting and retrying forever will never work.
 *
 *  - `no_key`      — no API key available at all. Config, not runtime.
 *  - `bad_request` — empty query, or Google's INVALID_REQUEST.
 *  - `not_found`   — Google looked and found nothing (ZERO_RESULTS).
 *  - `ambiguous`   — several materially different matches, or a partial match. Refusing here
 *                    is the fail-closed choice: picking one would invent the fact under test.
 *  - `denied`      — REQUEST_DENIED. Almost always the key's own API restrictions. Carries
 *                    the console path to fix it, because a generic failure teaches nobody.
 *  - `quota`       — OVER_QUERY_LIMIT / OVER_DAILY_LIMIT. Retryable.
 *  - `no_route`    — a drivable route does not exist between the two points (islands,
 *                    international pairs). Distinct from "we could not look".
 *  - `unavailable` — network, timeout, 5xx, unparseable body, UNKNOWN_ERROR.
 */
export type GeoFailureKind =
  | 'no_key'
  | 'bad_request'
  | 'not_found'
  | 'ambiguous'
  | 'denied'
  | 'quota'
  | 'no_route'
  | 'unavailable'

export interface GeoFailure {
  kind: GeoFailureKind
  /** A sentence fit to put straight into a finding's `reason`. */
  message: string
  /**
   * Whether trying again could plausibly succeed without a human changing something.
   * Carried explicitly rather than derived from `kind` at each call site, because an
   * unrecognised status is deliberately NOT retryable even though it lands in `unavailable`.
   */
  retryable: boolean
  /** Google's raw status string when there was one, for logs and evidence. */
  status: string | null
}

/**
 * Coordinates live only in the `ok: true` branch. This is the fail-closed guarantee: there
 * is no shape of this type carrying both a failure and a number, so no caller can treat
 * "we could not locate this" as a distance of zero or as any distance at all.
 */
export type GeocodeResult =
  | { ok: true; point: GeocodedPoint }
  | { ok: false; failure: GeoFailure }

export interface DriveDistance {
  miles: number
  minutes: number
  /**
   * Haversine over the same two points, computed locally and free.
   *
   * Carried alongside so a caller can read the circuity ratio (`miles / straightLineMiles`)
   * without a second call. A high ratio means terrain or water between the two points, and
   * for a service-area business that is a ranking-relevant fact on its own: 20 straight-line
   * miles across a canyon is not a serviceable 20 miles.
   */
  straightLineMiles: number
  /** Google's own human strings ("52.3 mi", "1 hour 8 mins"), fit to quote in evidence. */
  distanceText: string
  durationText: string
}

export type DriveDistanceResult =
  | { ok: true; distance: DriveDistance }
  | { ok: false; failure: GeoFailure }

export interface GeoRequestOptions {
  /** Falls back to process.env.GOOGLE_PLACES_API_KEY. */
  apiKey?: string
  /** Injected in tests. A global-fetch stub lets an unanticipated case hit the network. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

// ── The key-restriction hint ──────────────────────────────────────────────────

/**
 * REQUEST_DENIED on this project almost certainly means the KEY, not the project.
 *
 * Geocoding, Distance Matrix and Places are all enabled on the Cloud project, and the key is
 * in live use against Places. So a denial on the other two is the key's own API restrictions
 * list — an allowlist that names Places and nothing else. An operator reading a generic
 * "request denied" will go and check the enabled-API list, find both APIs enabled, and
 * conclude the code is broken. Hence the literal console path.
 */
const KEY_RESTRICTION_HINT =
  'The Geocoding and Distance Matrix APIs are enabled on this Cloud project, so the usual ' +
  "cause is the API KEY's own restrictions rather than the project. Fix: Google Cloud " +
  'Console → APIs & Services → Credentials → click the key behind GOOGLE_PLACES_API_KEY → ' +
  'API restrictions → "Restrict key" → add "Geocoding API" and "Distance Matrix API" → Save. ' +
  'Allow up to 5 minutes to propagate.'

// ── Failure construction ──────────────────────────────────────────────────────

function fail(
  kind: GeoFailureKind,
  message: string,
  opts: { retryable?: boolean; status?: string | null } = {},
): GeoFailure {
  return {
    kind,
    message,
    retryable: opts.retryable ?? false,
    status: opts.status ?? null,
  }
}

/**
 * Map one of Google's status strings to a typed failure.
 *
 * Shared by both endpoints because the vocabulary is shared, but the API name is threaded
 * through so the message names the call that actually failed.
 *
 * The default arm is deliberately NOT retryable. An unrecognised status is a case this code
 * has never reasoned about, and retrying it on a hunch burns paid quota against an outcome
 * nobody has predicted. Naming the literal status in the message is what lets the next
 * reader add a real arm for it.
 */
function failureForStatus(
  status: string,
  errorMessage: string | undefined,
  api: 'Geocoding' | 'Distance Matrix',
): GeoFailure {
  const detail = errorMessage ? ` Google said: "${errorMessage}".` : ''
  switch (status) {
    case 'ZERO_RESULTS':
      return fail('not_found', `${api} found no match.${detail}`, { status })
    case 'REQUEST_DENIED':
      return fail('denied', `${api} rejected the key (REQUEST_DENIED).${detail} ${KEY_RESTRICTION_HINT}`, {
        status,
        retryable: false,
      })
    case 'OVER_QUERY_LIMIT':
    case 'OVER_DAILY_LIMIT':
      return fail('quota', `${api} quota exhausted (${status}).${detail} Retry later.`, {
        status,
        retryable: true,
      })
    case 'INVALID_REQUEST':
    case 'MAX_ELEMENTS_EXCEEDED':
    case 'MAX_DIMENSIONS_EXCEEDED':
      return fail('bad_request', `${api} rejected the request (${status}).${detail}`, { status })
    case 'UNKNOWN_ERROR':
      return fail('unavailable', `${api} returned UNKNOWN_ERROR, a server-side fault.${detail}`, {
        status,
        retryable: true,
      })
    case 'NOT_FOUND':
      return fail('not_found', `${api} could not resolve one of the endpoints (NOT_FOUND).${detail}`, {
        status,
      })
    default:
      return fail('unavailable', `${api} returned an unrecognised status "${status}".${detail}`, {
        status,
        retryable: false,
      })
  }
}

/** One sentence naming both what went wrong and whether anyone can do anything about it. */
export function geoFailureReason(failure: GeoFailure): string {
  return failure.retryable ? `${failure.message} (retryable)` : failure.message
}

// ── Query normalisation ───────────────────────────────────────────────────────

/**
 * The canonical form of a geocode query — and therefore a safe cache key.
 *
 * Case and whitespace are the only things folded. Nothing is added: appending a state or a
 * country to "sharpen" a query would invent the very fact LOCAL-016 is testing, which is the
 * same rule lib/ingest/sitebulb/geo.ts holds for targetGeo derivation.
 */
export function normalizeGeocodeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── Precision ─────────────────────────────────────────────────────────────────

const ADDRESS_TYPES = new Set([
  'street_address',
  'premise',
  'subpremise',
  'establishment',
  'point_of_interest',
  'route',
  'intersection',
])

const LOCALITY_TYPES = new Set([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'neighborhood',
  'postal_code',
  'postal_town',
  'administrative_area_level_3',
])

/** Coarse first: a result typed both `locality` and `administrative_area_level_2` is a county. */
function precisionFromTypes(types: string[], locationType: string | null): GeocodePrecision {
  if (
    types.includes('administrative_area_level_2') ||
    types.includes('administrative_area_level_1') ||
    types.includes('country') ||
    types.includes('continent')
  ) {
    return 'area'
  }
  if (types.some((t) => ADDRESS_TYPES.has(t))) return 'address'
  if (types.some((t) => LOCALITY_TYPES.has(t))) return 'locality'
  // No usable `types` at all. Fall back to how the point was derived: ROOFTOP and
  // RANGE_INTERPOLATED are only ever produced for real addresses, so they are safe to trust.
  // Anything else is unclassified, and unclassified must read as the weakest claim.
  if (locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED') return 'address'
  return 'area'
}

const PRECISION_RANK: Record<GeocodePrecision, number> = {
  address: 2,
  locality: 1,
  area: 0,
}

/**
 * The weakest precision among several points.
 *
 * A distance is only as trustworthy as its worse endpoint: a rooftop business address
 * measured against a county centroid is a county-centroid claim. A check comparing two
 * geocoded points should qualify its verdict on this, not on either point alone.
 */
export function weakestPrecision(...precisions: GeocodePrecision[]): GeocodePrecision {
  return precisions.reduce(
    (worst, p) => (PRECISION_RANK[p] < PRECISION_RANK[worst] ? p : worst),
    'address' as GeocodePrecision,
  )
}

// ── Haversine ─────────────────────────────────────────────────────────────────

const toRadians = (deg: number): number => (deg * Math.PI) / 180

/**
 * Great-circle distance in statute miles. No network, no key, no quota.
 *
 * WHEN TO USE THIS RATHER THAN driveDistance: any time the answer is needed for every page
 * of a crawl, or inside a loop, or where a wrong answer costs little — screening, sorting,
 * "is this even in the same state". It is exact arithmetic on inputs that are already paid
 * for, so it can be called a million times.
 *
 * WHEN NOT TO: as the final basis of a LOCAL-016 verdict. See driveDistance.
 *
 * Takes LatLng, which by construction can only come out of a successful geocode — so there
 * is no path by which an unlocated place reaches this function as a zero.
 */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

function resolveKey(opts: GeoRequestOptions): string | null {
  const key = opts.apiKey ?? process.env.GOOGLE_PLACES_API_KEY
  return key && key.trim().length > 0 ? key : null
}

interface GoogleEnvelope {
  status?: string
  error_message?: string
}

/**
 * Perform the request and hand back either a parsed body or a typed failure.
 *
 * HTTP-level faults are separated from Google's own status vocabulary because they mean
 * different things: a 5xx or a socket error is the transport failing and is worth retrying,
 * whereas a 200 carrying REQUEST_DENIED is a decision Google made and will keep making.
 */
async function getJson<T extends GoogleEnvelope>(
  url: URL,
  api: 'Geocoding' | 'Distance Matrix',
  opts: GeoRequestOptions,
): Promise<{ ok: true; body: T } | { ok: false; failure: GeoFailure }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let res: Response
  try {
    res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      failure: fail('unavailable', `${api} request failed: ${detail}`, { retryable: true }),
    }
  }

  if (!res.ok) {
    // 429 and 5xx are transient by definition; a 4xx is the request itself being wrong.
    const retryable = res.status === 429 || res.status >= 500
    return {
      ok: false,
      failure: fail('unavailable', `${api} returned HTTP ${res.status}.`, { retryable }),
    }
  }

  let body: T
  try {
    body = (await res.json()) as T
  } catch {
    return {
      ok: false,
      failure: fail('unavailable', `${api} returned a body that is not JSON.`, { retryable: true }),
    }
  }

  const status = body?.status
  if (status !== 'OK') {
    return {
      ok: false,
      failure: failureForStatus(String(status ?? 'MISSING_STATUS'), body?.error_message, api),
    }
  }
  return { ok: true, body }
}

// ── geocode ───────────────────────────────────────────────────────────────────

interface GeocodeApiResponse extends GoogleEnvelope {
  results?: Array<{
    formatted_address?: string
    partial_match?: boolean
    types?: string[]
    geometry?: {
      location?: { lat?: number; lng?: number }
      location_type?: string
    }
  }>
}

/**
 * Resolve a place description to a coordinate, or say precisely why it could not.
 *
 * Region biasing (`&region=us`) is deliberately not applied. It would quietly resolve
 * "Springfield" to a US city and hide the ambiguity this function exists to report.
 */
export async function geocode(query: string, opts: GeoRequestOptions = {}): Promise<GeocodeResult> {
  const normalized = normalizeGeocodeQuery(query)
  if (normalized.length === 0) {
    return { ok: false, failure: fail('bad_request', 'Geocode query was empty.') }
  }

  const key = resolveKey(opts)
  if (!key) {
    return {
      ok: false,
      failure: fail(
        'no_key',
        'No Google API key available: set GOOGLE_PLACES_API_KEY or pass apiKey. ' +
          KEY_RESTRICTION_HINT,
      ),
    }
  }

  const url = new URL(GEOCODE_URL)
  // The raw query, not the normalized one — normalization is a cache key, not a wire format.
  url.searchParams.set('address', query.trim())
  url.searchParams.set('key', key)

  const fetched = await getJson<GeocodeApiResponse>(url, 'Geocoding', opts)
  if (!fetched.ok) return { ok: false, failure: fetched.failure }

  const results = fetched.body.results ?? []
  if (results.length === 0) {
    // Status OK with an empty array is not a documented Google response, but treating it as
    // anything other than "no match" would be inventing a location.
    return {
      ok: false,
      failure: fail('not_found', `Geocoding returned no results for "${query.trim()}".`, {
        status: 'OK',
      }),
    }
  }

  const top = results[0]
  const lat = top.geometry?.location?.lat
  const lng = top.geometry?.location?.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return {
      ok: false,
      failure: fail('unavailable', `Geocoding returned a result with no usable coordinate.`, {
        status: 'OK',
        retryable: true,
      }),
    }
  }

  // A partial match means Google matched something other than what was asked for — a
  // misspelling, or a query it had to truncate. That is a guess wearing a result's clothes,
  // and a guessed origin produces a confident distance to the wrong place.
  if (top.partial_match === true) {
    return {
      ok: false,
      failure: fail(
        'ambiguous',
        `Geocoding only partially matched "${query.trim()}" (best guess: ` +
          `"${top.formatted_address ?? 'unnamed'}"), so the location is not established.`,
        { status: 'OK' },
      ),
    }
  }

  // Several results far enough apart to be genuinely different places. Picking the first
  // would silently pick a state.
  const second = results[1]
  const secondLat = second?.geometry?.location?.lat
  const secondLng = second?.geometry?.location?.lng
  if (typeof secondLat === 'number' && typeof secondLng === 'number') {
    const spread = haversineMiles({ lat, lng }, { lat: secondLat, lng: secondLng })
    if (spread > AMBIGUITY_SPREAD_MILES) {
      return {
        ok: false,
        failure: fail(
          'ambiguous',
          `"${query.trim()}" matched ${results.length} places ${Math.round(spread)} miles apart ` +
            `("${top.formatted_address ?? 'unnamed'}" vs "${second.formatted_address ?? 'unnamed'}"), ` +
            'so there is no defensible single location.',
          { status: 'OK' },
        ),
      }
    }
  }

  const types = top.types ?? []
  const locationType = top.geometry?.location_type ?? null

  return {
    ok: true,
    point: {
      lat,
      lng,
      formattedAddress: top.formatted_address ?? query.trim(),
      precision: precisionFromTypes(types, locationType),
      types,
      locationType,
      query: normalized,
    },
  }
}

// ── driveDistance ─────────────────────────────────────────────────────────────

interface DistanceMatrixApiResponse extends GoogleEnvelope {
  rows?: Array<{
    elements?: Array<{
      status?: string
      distance?: { text?: string; value?: number }
      duration?: { text?: string; value?: number }
    }>
  }>
}

/**
 * Road distance and drive time between two located points.
 *
 * DRIVE DISTANCE IS THE BETTER TEST FOR LOCAL-016, and it is worth being explicit about why.
 * A service-area business is constrained by how far a van will actually drive to a job, not
 * by how the crow flies. "Sherman Oaks to Orange County is 68 minutes" is a truer statement
 * about whether that business can serve — and therefore rank in — that geography than "52
 * miles" is, because the 405 at 4pm is a real constraint on the business and the great
 * circle is not. Drive time is also the quantity an owner can sanity-check against their own
 * experience, which matters for a finding a human has to approve.
 *
 * It costs a paid request per pair, so haversineMiles remains the right instrument for
 * screening: filter the obviously-local pages out with haversine, then spend a Distance
 * Matrix call only on the pairs whose verdict actually turns on the number.
 *
 * Takes coordinates rather than address strings ON PURPOSE. Distance Matrix would happily
 * accept "Orange County, CA" and return a number, and that number would arrive with no
 * precision signal and no ambiguity check — exactly the hole this module exists to close.
 * Forcing the caller through geocode() means every distance carries a known provenance.
 */
export async function driveDistance(
  origin: LatLng,
  destination: LatLng,
  opts: GeoRequestOptions = {},
): Promise<DriveDistanceResult> {
  const key = resolveKey(opts)
  if (!key) {
    return {
      ok: false,
      failure: fail(
        'no_key',
        'No Google API key available: set GOOGLE_PLACES_API_KEY or pass apiKey. ' +
          KEY_RESTRICTION_HINT,
      ),
    }
  }

  const url = new URL(DISTANCE_MATRIX_URL)
  url.searchParams.set('origins', `${origin.lat},${origin.lng}`)
  url.searchParams.set('destinations', `${destination.lat},${destination.lng}`)
  url.searchParams.set('mode', 'driving')
  url.searchParams.set('units', 'imperial')
  url.searchParams.set('key', key)

  const fetched = await getJson<DistanceMatrixApiResponse>(url, 'Distance Matrix', opts)
  if (!fetched.ok) return { ok: false, failure: fetched.failure }

  // The trap in this API: the envelope says OK while the single element says ZERO_RESULTS.
  // Reading only the top-level status yields an undefined distance that coerces to 0 — the
  // exact "no answer read as zero miles" this module is built to prevent.
  const element = fetched.body.rows?.[0]?.elements?.[0]
  if (!element) {
    return {
      ok: false,
      failure: fail('unavailable', 'Distance Matrix returned no element for the pair.', {
        status: 'OK',
        retryable: true,
      }),
    }
  }

  const elementStatus = element.status ?? 'MISSING_STATUS'
  if (elementStatus !== 'OK') {
    if (elementStatus === 'ZERO_RESULTS') {
      return {
        ok: false,
        failure: fail(
          'no_route',
          'Distance Matrix found no drivable route between the two points.',
          { status: elementStatus },
        ),
      }
    }
    return { ok: false, failure: failureForStatus(elementStatus, fetched.body.error_message, 'Distance Matrix') }
  }

  const meters = element.distance?.value
  const seconds = element.duration?.value
  if (typeof meters !== 'number' || typeof seconds !== 'number') {
    return {
      ok: false,
      failure: fail('unavailable', 'Distance Matrix element was OK but carried no distance.', {
        status: 'OK',
        retryable: true,
      }),
    }
  }

  return {
    ok: true,
    distance: {
      miles: meters / METERS_PER_MILE,
      minutes: seconds / 60,
      straightLineMiles: haversineMiles(origin, destination),
      distanceText: element.distance?.text ?? '',
      durationText: element.duration?.text ?? '',
    },
  }
}
