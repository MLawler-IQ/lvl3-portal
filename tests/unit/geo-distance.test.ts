// The geo measuring instrument for LOCAL-016.
//
// fetchImpl is injected rather than stubbing global fetch, and no test supplies a real key:
// "this suite cannot reach the network" is a property of every call site here.
//
// The load-bearing block is the last one. Everything else checks that a good answer is
// correct; that block checks that a BAD answer cannot be mistaken for a good one — no
// failure path may expose a number a caller could read as zero miles. That is the property
// the check depends on to report not_run instead of fabricating a pass, which is the exact
// defect this module exists to stop (docs/CONTEXT-LIBRARY.md §3).

import { describe, expect, it, vi } from 'vitest'
import {
  driveDistance,
  geoFailureReason,
  geocode,
  haversineMiles,
  normalizeGeocodeQuery,
  weakestPrecision,
  type GeoRequestOptions,
} from '@/lib/geo/distance'

const KEY: GeoRequestOptions = { apiKey: 'test-key' }

/** Real coordinates — the pilot's origin and one of the Orange County cities it targeted. */
const SHERMAN_OAKS = { lat: 34.1508, lng: -118.4489 }
const SANTA_ANA = { lat: 33.7455, lng: -117.8677 }

/** A fetch that answers with one JSON body regardless of URL. */
function jsonFetch(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })) as typeof fetch
}

function geocodeResult(over: Record<string, unknown> = {}) {
  return {
    formatted_address: 'Sherman Oaks, Los Angeles, CA, USA',
    types: ['locality', 'political'],
    geometry: {
      location: { lat: SHERMAN_OAKS.lat, lng: SHERMAN_OAKS.lng },
      location_type: 'APPROXIMATE',
    },
    ...over,
  }
}

/** Every failure-shaped result this module can produce, for the fail-closed sweep. */
async function allFailures() {
  const denied = await geocode('anywhere', {
    ...KEY,
    fetchImpl: jsonFetch({ status: 'REQUEST_DENIED', error_message: 'not authorized' }),
  })
  const zero = await geocode('nowhere at all', {
    ...KEY,
    fetchImpl: jsonFetch({ status: 'ZERO_RESULTS', results: [] }),
  })
  const quota = await geocode('anywhere', {
    ...KEY,
    fetchImpl: jsonFetch({ status: 'OVER_QUERY_LIMIT' }),
  })
  const ambiguous = await geocode('Springfield', {
    ...KEY,
    fetchImpl: jsonFetch({
      status: 'OK',
      results: [
        geocodeResult({ formatted_address: 'Springfield, IL, USA', geometry: { location: { lat: 39.7817, lng: -89.6501 } } }),
        geocodeResult({ formatted_address: 'Springfield, MO, USA', geometry: { location: { lat: 37.2089, lng: -93.2923 } } }),
      ],
    }),
  })
  const noKey = await geocode('anywhere', { apiKey: '', fetchImpl: jsonFetch({}) })
  const empty = await geocode('   ', KEY)
  const transport = await geocode('anywhere', {
    ...KEY,
    fetchImpl: (async () => {
      throw new Error('socket hang up')
    }) as typeof fetch,
  })
  const noRoute = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
    ...KEY,
    fetchImpl: jsonFetch({ status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] }),
  })
  const driveDenied = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
    ...KEY,
    fetchImpl: jsonFetch({ status: 'REQUEST_DENIED', error_message: 'not authorized' }),
  })
  const http500 = await geocode('anywhere', {
    ...KEY,
    fetchImpl: jsonFetch({}, { status: 500 }),
  })

  return [denied, zero, quota, ambiguous, noKey, empty, transport, noRoute, driveDenied, http500]
}

// ── geocode: the happy path ───────────────────────────────────────────────────

describe('geocode', () => {
  it('returns coordinates, the formatted address and a precision', async () => {
    const result = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'OK', results: [geocodeResult()] }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a located point')
    expect(result.point.lat).toBeCloseTo(34.1508, 4)
    expect(result.point.lng).toBeCloseTo(-118.4489, 4)
    expect(result.point.formattedAddress).toBe('Sherman Oaks, Los Angeles, CA, USA')
    expect(result.point.precision).toBe('locality')
    expect(result.point.types).toContain('locality')
  })

  it('reads a street address as the strongest precision', async () => {
    const result = await geocode('14006 Riverside Dr, Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [
          geocodeResult({
            formatted_address: '14006 Riverside Dr, Sherman Oaks, CA 91423, USA',
            types: ['street_address'],
            geometry: { location: SHERMAN_OAKS, location_type: 'ROOFTOP' },
          }),
        ],
      }),
    })

    if (!result.ok) throw new Error('expected a located point')
    expect(result.point.precision).toBe('address')
    expect(result.point.locationType).toBe('ROOFTOP')
  })

  it('sends the query to the address parameter and the key to the key parameter', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ status: 'OK', results: [geocodeResult()] }), { status: 200 }),
    )
    await geocode('Sherman Oaks, CA', { ...KEY, fetchImpl: spy as unknown as typeof fetch })

    const url = new URL(String(spy.mock.calls[0][0]))
    expect(url.searchParams.get('address')).toBe('Sherman Oaks, CA')
    expect(url.searchParams.get('key')).toBe('test-key')
  })

  // The cache seam. The module builds no cache, but a caller memoising on this key must get
  // the same key for the same place regardless of how a page slug happened to be cased.
  it('normalises the query into a stable cache key without inventing anything', () => {
    expect(normalizeGeocodeQuery('  Sherman   Oaks,  CA ')).toBe('sherman oaks, ca')
    expect(normalizeGeocodeQuery('SHERMAN OAKS, CA')).toBe(normalizeGeocodeQuery('sherman oaks, ca'))
    // No state, no country, no "USA" appended — under-specifying is honest, guessing is not.
    expect(normalizeGeocodeQuery('Brentwood')).toBe('brentwood')
  })
})

// ── geocode: the failure vocabulary ───────────────────────────────────────────

describe('geocode maps Google statuses to distinct, typed failures', () => {
  it('reports ZERO_RESULTS as not_found and does not invite a retry', async () => {
    const result = await geocode('Atlantis, Nowhere', {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'ZERO_RESULTS', results: [] }),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('not_found')
    expect(result.failure.retryable).toBe(false)
    expect(result.failure.status).toBe('ZERO_RESULTS')
  })

  // OVER_QUERY_LIMIT and REQUEST_DENIED both mean "no answer", and the caller's next move is
  // completely different. Collapsing them into one error string is what makes an operator
  // retry a permanently-denied key forever.
  it('separates a retryable quota exhaustion from a permanent denial', async () => {
    const quota = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'OVER_QUERY_LIMIT' }),
    })
    if (quota.ok) throw new Error('expected a failure')
    expect(quota.failure.kind).toBe('quota')
    expect(quota.failure.retryable).toBe(true)
    expect(geoFailureReason(quota.failure)).toContain('retryable')

    const denied = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'REQUEST_DENIED' }),
    })
    if (denied.ok) throw new Error('expected a failure')
    expect(denied.failure.kind).toBe('denied')
    expect(denied.failure.retryable).toBe(false)
    expect(geoFailureReason(denied.failure)).not.toContain('retryable')
  })

  // The risk that will actually bite: GOOGLE_PLACES_API_KEY is live against Places, and both
  // Geocoding and Distance Matrix are enabled on the project — so a REQUEST_DENIED here is
  // the KEY's API-restriction allowlist, not the project. An operator reading a generic
  // failure will check the enabled-API list, find both enabled, and blame the code.
  it('carries the key-restriction fix in the REQUEST_DENIED message', async () => {
    const result = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'REQUEST_DENIED',
        error_message: 'This API project is not authorized to use this API.',
      }),
    })
    if (result.ok) throw new Error('expected a failure')

    const msg = result.failure.message
    expect(msg).toContain('API restrictions')
    expect(msg).toContain('Geocoding API')
    expect(msg).toContain('Distance Matrix API')
    expect(msg).toContain('Credentials')
    expect(msg).toContain('GOOGLE_PLACES_API_KEY')
    // Google's own words survive, so the operator can search for them.
    expect(msg).toContain('This API project is not authorized to use this API.')
  })

  it('says the same thing when Distance Matrix is the API that was denied', async () => {
    const result = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'REQUEST_DENIED' }),
    })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('denied')
    expect(result.failure.message).toContain('Distance Matrix')
    expect(result.failure.message).toContain('API restrictions')
  })

  it('reports INVALID_REQUEST as a bad request rather than a missing place', async () => {
    const result = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'INVALID_REQUEST' }),
    })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('bad_request')
    expect(result.failure.retryable).toBe(false)
  })

  // An unrecognised status has never been reasoned about, so retrying it burns paid quota
  // against an outcome nobody predicted. It must name the literal status instead.
  it('refuses to retry a status it does not recognise, and quotes it', async () => {
    const result = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'SOMETHING_NEW' }),
    })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('unavailable')
    expect(result.failure.retryable).toBe(false)
    expect(result.failure.message).toContain('SOMETHING_NEW')
  })

  it('treats a network fault and a 5xx as retryable transport failures', async () => {
    const thrown = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: (async () => {
        throw new Error('ETIMEDOUT')
      }) as typeof fetch,
    })
    if (thrown.ok) throw new Error('expected a failure')
    expect(thrown.failure.kind).toBe('unavailable')
    expect(thrown.failure.retryable).toBe(true)

    const server = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({}, { status: 503 }),
    })
    if (server.ok) throw new Error('expected a failure')
    expect(server.failure.retryable).toBe(true)
  })

  it('reports a missing key as its own kind, before any request is made', async () => {
    const spy = vi.fn()
    const result = await geocode('Sherman Oaks, CA', {
      apiKey: '',
      fetchImpl: spy as unknown as typeof fetch,
    })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('no_key')
    expect(result.failure.message).toContain('GOOGLE_PLACES_API_KEY')
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an empty query without spending a request', async () => {
    const spy = vi.fn()
    const result = await geocode('   ', { ...KEY, fetchImpl: spy as unknown as typeof fetch })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('bad_request')
    expect(spy).not.toHaveBeenCalled()
  })
})

// ── Ambiguity: refusing rather than guessing ──────────────────────────────────

describe('an ambiguous geocode refuses rather than picking one', () => {
  it('rejects several matches that are materially different places', async () => {
    const result = await geocode('Springfield', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [
          {
            formatted_address: 'Springfield, IL, USA',
            types: ['locality', 'political'],
            geometry: { location: { lat: 39.7817, lng: -89.6501 }, location_type: 'APPROXIMATE' },
          },
          {
            formatted_address: 'Springfield, MO, USA',
            types: ['locality', 'political'],
            geometry: { location: { lat: 37.2089, lng: -93.2923 }, location_type: 'APPROXIMATE' },
          },
        ],
      }),
    })

    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('ambiguous')
    // Both candidates named, so a human reading the finding can resolve it themselves.
    expect(result.failure.message).toContain('Springfield, IL, USA')
    expect(result.failure.message).toContain('Springfield, MO, USA')
  })

  // The inverse failure, which would make the rule useless: Google routinely returns the
  // same place twice under different boundary conventions, and refusing those would turn
  // every ordinary city into an `ambiguous` and take the check permanently offline.
  it('accepts several matches that are all the same place', async () => {
    const result = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [
          geocodeResult(),
          geocodeResult({
            formatted_address: 'Sherman Oaks, CA 91423, USA',
            geometry: { location: { lat: 34.1553, lng: -118.4489 } },
          }),
        ],
      }),
    })

    expect(result.ok).toBe(true)
  })

  it('rejects a partial match, which is a guess wearing a result’s clothes', async () => {
    const result = await geocode('Shermn Oaks', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [geocodeResult({ partial_match: true })],
      }),
    })

    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('ambiguous')
    expect(result.failure.message).toContain('partially matched')
  })
})

// ── Precision: the county-centroid problem ────────────────────────────────────

describe('a coarse geocode is flagged rather than silently used', () => {
  // The concrete case from the pilot. "Orange County, CA" geocodes to a point in the hills
  // near Santiago Peak — nowhere near Anaheim, Irvine or Santa Ana, the cities the location
  // pages actually target. A distance measured from there is a much weaker claim, and the
  // check has to be able to see that in order to weaken or withhold its verdict.
  it('marks a county centroid as area precision, not locality', async () => {
    const result = await geocode('Orange County, CA', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [
          {
            formatted_address: 'Orange County, CA, USA',
            types: ['administrative_area_level_2', 'political'],
            geometry: {
              location: { lat: 33.7175, lng: -117.8311 },
              location_type: 'APPROXIMATE',
            },
          },
        ],
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a located point')
    expect(result.point.precision).toBe('area')
    expect(result.point.types).toContain('administrative_area_level_2')
  })

  it('marks a state centroid as area precision too', async () => {
    const result = await geocode('California', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [
          {
            formatted_address: 'California, USA',
            types: ['administrative_area_level_1', 'political'],
            geometry: { location: { lat: 36.7783, lng: -119.4179 }, location_type: 'APPROXIMATE' },
          },
        ],
      }),
    })
    if (!result.ok) throw new Error('expected a located point')
    expect(result.point.precision).toBe('area')
  })

  // A county carrying `locality` among its types must still read as a county. Checking the
  // fine types first would let the coarser fact hide behind the finer one.
  it('reads coarse before fine when a result carries both', async () => {
    const result = await geocode('Denver, CO', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [
          {
            formatted_address: 'Denver, CO, USA',
            types: ['locality', 'administrative_area_level_2', 'political'],
            geometry: { location: { lat: 39.7392, lng: -104.9903 }, location_type: 'APPROXIMATE' },
          },
        ],
      }),
    })
    if (!result.ok) throw new Error('expected a located point')
    expect(result.point.precision).toBe('area')
  })

  it('falls back to the weakest precision when a result carries no usable types', async () => {
    const result = await geocode('somewhere', {
      ...KEY,
      fetchImpl: jsonFetch({
        status: 'OK',
        results: [
          {
            formatted_address: 'Somewhere',
            types: [],
            geometry: { location: SHERMAN_OAKS, location_type: 'APPROXIMATE' },
          },
        ],
      }),
    })
    if (!result.ok) throw new Error('expected a located point')
    expect(result.point.precision).toBe('area')
  })

  // A distance is only as trustworthy as its worse endpoint: a rooftop address measured
  // against a county centroid is a county-centroid claim, and must be reported as one.
  it('reports the weaker of two endpoints, since that is what the pair is worth', () => {
    expect(weakestPrecision('address', 'area')).toBe('area')
    expect(weakestPrecision('address', 'locality')).toBe('locality')
    expect(weakestPrecision('address', 'address')).toBe('address')
    expect(weakestPrecision('locality', 'area', 'address')).toBe('area')
  })
})

// ── Haversine ─────────────────────────────────────────────────────────────────

describe('haversineMiles', () => {
  // The pilot pair, as a range rather than a magic number — the point is that the arithmetic
  // lands in the real world, not that it reproduces one constant to six places.
  it('puts Sherman Oaks to Santa Ana in the low-forties of miles', () => {
    const miles = haversineMiles(SHERMAN_OAKS, SANTA_ANA)
    expect(miles).toBeGreaterThan(40)
    expect(miles).toBeLessThan(50)
  })

  it('is symmetric', () => {
    expect(haversineMiles(SHERMAN_OAKS, SANTA_ANA)).toBeCloseTo(
      haversineMiles(SANTA_ANA, SHERMAN_OAKS),
      9,
    )
  })

  // A computed zero from two real coordinates is a true answer and must stay available. The
  // zero this module forbids is the OTHER one — a failure read as a distance.
  it('returns a real zero for one point measured against itself', () => {
    expect(haversineMiles(SHERMAN_OAKS, SHERMAN_OAKS)).toBe(0)
  })

  it('gets a known long-haul pair right to within a percent', () => {
    // LAX to JFK, ~2475 statute miles great-circle.
    const miles = haversineMiles({ lat: 33.9416, lng: -118.4085 }, { lat: 40.6413, lng: -73.7781 })
    expect(miles).toBeGreaterThan(2450)
    expect(miles).toBeLessThan(2500)
  })

  it('needs no key, no network and no options', () => {
    // No fetchImpl anywhere in this describe block — the signature makes that structural.
    expect(typeof haversineMiles(SHERMAN_OAKS, SANTA_ANA)).toBe('number')
  })
})

// ── driveDistance ─────────────────────────────────────────────────────────────

describe('driveDistance', () => {
  const okBody = {
    status: 'OK',
    rows: [
      {
        elements: [
          {
            status: 'OK',
            distance: { text: '52.3 mi', value: 84_170 },
            duration: { text: '1 hour 8 mins', value: 4_080 },
          },
        ],
      },
    ],
  }

  it('parses meters to miles and seconds to minutes', async () => {
    const result = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: jsonFetch(okBody),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a distance')
    expect(result.distance.miles).toBeCloseTo(52.3, 1)
    expect(result.distance.minutes).toBeCloseTo(68, 5)
    expect(result.distance.distanceText).toBe('52.3 mi')
    expect(result.distance.durationText).toBe('1 hour 8 mins')
  })

  // The circuity companion: 52 road miles over ~44 straight-line miles is the shape of a
  // real freeway detour, and the caller gets it without a second paid call.
  it('carries the straight-line distance alongside, for free', async () => {
    const result = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: jsonFetch(okBody),
    })
    if (!result.ok) throw new Error('expected a distance')
    expect(result.distance.straightLineMiles).toBeCloseTo(
      haversineMiles(SHERMAN_OAKS, SANTA_ANA),
      9,
    )
    expect(result.distance.miles).toBeGreaterThan(result.distance.straightLineMiles)
  })

  it('sends driving mode and both coordinate pairs', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(okBody), { status: 200 }),
    )
    await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: spy as unknown as typeof fetch,
    })

    const url = new URL(String(spy.mock.calls[0][0]))
    expect(url.searchParams.get('origins')).toBe('34.1508,-118.4489')
    expect(url.searchParams.get('destinations')).toBe('33.7455,-117.8677')
    expect(url.searchParams.get('mode')).toBe('driving')
  })

  // The trap in this API. The envelope says OK while the element says ZERO_RESULTS; reading
  // only the top-level status yields an undefined distance that coerces to 0 — literally the
  // "no answer read as zero miles" this module exists to prevent.
  it('catches a per-element failure hiding under a top-level OK', async () => {
    const result = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] }),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('no_route')
    expect(result.failure.retryable).toBe(false)
  })

  it('rejects an OK element that carries no distance at all', async () => {
    const result = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'OK', rows: [{ elements: [{ status: 'OK' }] }] }),
    })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('unavailable')
  })

  it('rejects an empty rows array rather than reading it as adjacency', async () => {
    const result = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'OK', rows: [] }),
    })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('unavailable')
  })

  it('maps a per-element NOT_FOUND to not_found, not to a route problem', async () => {
    const result = await driveDistance(SHERMAN_OAKS, SANTA_ANA, {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'OK', rows: [{ elements: [{ status: 'NOT_FOUND' }] }] }),
    })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('not_found')
  })
})

// ── The property everything else depends on ───────────────────────────────────

describe('no failure path can be mistaken for a zero distance', () => {
  // This is the whole reason the module exists. LOCAL-016's current implementation turns a
  // documented P1 into a green tick; the replacement must be able to say "we could not look"
  // and be structurally unable to say "zero miles" instead.
  it('exposes no numeric field on any failure, from any entry point', async () => {
    const failures = await allFailures()
    expect(failures.length).toBeGreaterThan(0)

    for (const result of failures) {
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected a failure')

      // No coordinate, no distance, no duration — not as zero, not as null, not at all.
      const bag = result as unknown as Record<string, unknown>
      for (const field of ['point', 'distance', 'lat', 'lng', 'miles', 'minutes', 'straightLineMiles']) {
        expect(bag[field]).toBeUndefined()
        expect(field in bag).toBe(false)
      }

      // And nothing anywhere on the object is a number that could be read as a distance.
      for (const value of Object.values(bag.failure as Record<string, unknown>)) {
        expect(typeof value).not.toBe('number')
      }
    }
  })

  it('gives every failure a kind, a human reason and a retry verdict', async () => {
    for (const result of await allFailures()) {
      if (result.ok) throw new Error('expected a failure')
      expect(result.failure.kind).toBeTruthy()
      expect(result.failure.message.trim().length).toBeGreaterThan(0)
      expect(typeof result.failure.retryable).toBe('boolean')
      // Fit to drop straight into a finding's `reason` field.
      expect(geoFailureReason(result.failure).trim().length).toBeGreaterThan(0)
    }
  })

  it('distinguishes every documented cause from every other one', async () => {
    const [denied, zero, quota, ambiguous, noKey, empty, transport, noRoute] = await allFailures()
    const kindOf = (r: Awaited<ReturnType<typeof geocode>> | Awaited<ReturnType<typeof driveDistance>>) => {
      if (r.ok) throw new Error('expected a failure')
      return r.failure.kind
    }

    expect(kindOf(denied)).toBe('denied')
    expect(kindOf(zero)).toBe('not_found')
    expect(kindOf(quota)).toBe('quota')
    expect(kindOf(ambiguous)).toBe('ambiguous')
    expect(kindOf(noKey)).toBe('no_key')
    expect(kindOf(empty)).toBe('bad_request')
    expect(kindOf(transport)).toBe('unavailable')
    expect(kindOf(noRoute)).toBe('no_route')
  })

  // A success and a failure are different shapes, so `if (!result.ok) return notRun(...)` is
  // the only way to reach a number. TypeScript enforces it; this pins the runtime half.
  it('puts the coordinate only inside the ok branch', async () => {
    const good = await geocode('Sherman Oaks, CA', {
      ...KEY,
      fetchImpl: jsonFetch({ status: 'OK', results: [geocodeResult()] }),
    })
    expect(good.ok).toBe(true)
    if (!good.ok) throw new Error('expected a located point')
    expect('failure' in good).toBe(false)
    expect(typeof good.point.lat).toBe('number')
  })
})
