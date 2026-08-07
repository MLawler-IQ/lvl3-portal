// The GBP station, and the rules it exists to enforce.
//
// The assertions that carry the weight here are all negative, and they are the same shape
// as the ones that caught the fabricated pass in commit c36a9a3: a station that cannot
// answer must not let a check answer either — in EITHER direction. A partial GBP record
// producing "GBP profile incomplete: missing photos" is not a smaller version of a
// correct finding, it is a wrong one, and it is more dangerous than the fabricated pass
// because it comes with a plausible magnitude attached.
//
// TWO THINGS CHANGED ON 2026-08-07 AND BOTH ARE PINNED BELOW.
//
//  1. The ledger was factually wrong. photoCount, rating and reviewCount were recorded as
//     `obtainable: false` with notes asserting the Media API and My Business v4 were "not
//     authorised" / "not enabled for this project". The console says otherwise: v4 is
//     ENABLED on project lvl3-portal with 250,000 requests/day granted, and the token
//     carries business.manage. lib/connectors/gbp-reviews.ts reads all three, so
//     blockingFields() is empty and the station EMITS — a path that had never once
//     executed, and therefore had never been tested.
//
//  2. LOCAL-016 could return a fabricated FAIL from a well-formed record. `serviceAreas`
//     is [] for every storefront client (the API returns Location.serviceArea only for a
//     service-area business), and with an empty set every location page fell outside it.
//     `THE STOREFRONT FABRICATION` below is the reproduction, driven through the real
//     runChecks against the real CHECKS registry rather than a stub.
//
// Nothing here touches the network, Supabase or a Google token: `listLocations`,
// `decideScope`, `fetchMedia` and `fetchReviews` are all injected, and every module
// reached at import time is type-only or pure.

import { describe, expect, it } from 'vitest'
import {
  GBP_ASSUMED_FIELDS,
  GBP_FIELDS_READ_BY_CHECKS,
  GBP_FIELD_SOURCES,
  GBP_UNOBTAINABLE_FIELDS,
  blockingFields,
  completeRecord,
  draftFromLocation,
  hasNoPrimaryCategory,
  runGbpStation,
  type GbpStationDeps,
} from '@/lib/stations/gbp'
import { auditLocation, decideGBPScope, type GBPLocation } from '@/lib/connectors/gbp'
import type {
  GbpMediaPayload,
  GbpReadResult,
  GbpReviewsPayload,
} from '@/lib/connectors/gbp-reviews'
import { CHECKS } from '@/lib/findings/checks'
import { runChecks } from '@/lib/findings/engine'
import type { Finding, StationBundle } from '@/lib/findings/types'
import { toolOk } from '@/lib/tools/contract'
import type { CrawlPageRecord, CrawlStationData, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { OAuth2Client } from 'google-auth-library'

const check = (id: string) => CHECKS.find((c) => c.id === id)!

/** A stand-in: the station only ever passes it through to the injected readers. */
const AUTH = {} as OAuth2Client

function location(over: Partial<GBPLocation> = {}): GBPLocation {
  return {
    name: 'locations/456',
    title: 'Tornado HVAC',
    primaryPhone: '+1-818-555-0100',
    additionalPhones: [],
    websiteUri: 'https://tornadohvacca.com',
    address: {
      addressLines: ['15115 Califa St'],
      locality: 'Sherman Oaks',
      administrativeArea: 'CA',
      postalCode: '91411',
      regionCode: 'US',
    },
    primaryCategory: 'HVAC contractor',
    description: 'Heating, cooling and duct cleaning across the San Fernando Valley.',
    openStatus: 'OPEN',
    hasRegularHours: true,
    hoursPeriods: [],
    mapsUri: null,
    newReviewUri: null,
    isServiceAreaBusiness: false,
    serviceAreaBusinessType: null,
    serviceAreas: [],
    ...over,
  }
}

/** The documented Tornado shape: SAB, address hidden by Google, areas declared. */
function hiddenAddressSab(over: Partial<GBPLocation> = {}): GBPLocation {
  return location({
    address: null,
    isServiceAreaBusiness: true,
    serviceAreaBusinessType: 'CUSTOMER_LOCATION_ONLY',
    serviceAreas: ['Sherman Oaks, CA', 'Van Nuys, CA', 'Burbank, CA'],
    ...over,
  })
}

const lister = (locations: GBPLocation[]) => async () => locations

// ── injected v4 readers ───────────────────────────────────────────────────────

function mediaOk(photoCount = 22): GbpReadResult<GbpMediaPayload> {
  return {
    ok: true,
    data: {
      locationResourceName: 'accounts/123/locations/456',
      photoCount,
      videoCount: 3,
      mediaItemCount: photoCount + 3,
      totalMediaItemCount: photoCount + 3,
      pagesFetched: 1,
      complete: true,
    },
  }
}

function reviewsOk(
  over: Partial<GbpReviewsPayload> = {},
): GbpReadResult<GbpReviewsPayload> {
  return {
    ok: true,
    data: {
      locationResourceName: 'accounts/123/locations/456',
      reviews: [],
      totalReviewCount: 129,
      averageRating: 4.8,
      pagesFetched: 1,
      complete: true,
      ...over,
    },
  }
}

/** Deps that make a full, emitting run possible without a token or a socket. */
function readableDeps(over: Partial<GbpStationDeps> = {}): GbpStationDeps {
  return {
    listLocations: lister([location()]),
    decideScope: decideGBPScope,
    fetchMedia: async () => mediaOk(),
    fetchReviews: async () => reviewsOk(),
    ...over,
  }
}

const input = (over: Partial<Parameters<typeof runGbpStation>[0]> = {}) => ({
  accountName: 'accounts/123',
  locationGroup: '*',
  auth: AUTH,
  ...over,
})

// ── the ledger ────────────────────────────────────────────────────────────────

describe('the field ledger', () => {
  it('records nothing as unobtainable: every field has a source', () => {
    // The correction. These three were `obtainable: false` on the strength of an
    // unverified claim that the APIs behind them were not enabled. They are.
    expect(GBP_UNOBTAINABLE_FIELDS).toEqual([])
    for (const f of ['photoCount', 'rating', 'reviewCount'] as const) {
      expect(GBP_FIELD_SOURCES[f].obtainable).toBe(true)
    }
  })

  it('marks the v4 fields as ASSUMED, not verified — the API has never been called', () => {
    // The distinction the old ledger lacked. Enabled and documented is not the same as
    // exercised: usage on mybusiness.googleapis.com was 0%, so the response shape is
    // documentation. Anything claiming `verified` must have returned a byte to this code.
    expect(GBP_ASSUMED_FIELDS).toEqual(['photoCount', 'rating', 'reviewCount'])
    for (const f of ['photoCount', 'rating', 'reviewCount'] as const) {
      expect(GBP_FIELD_SOURCES[f].confidence).toBe('assumed')
      expect(GBP_FIELD_SOURCES[f].note).toMatch(/VERIFIED/)
      expect(GBP_FIELD_SOURCES[f].note).toMatch(/ASSUMED/)
    }
    // The v1 profile reads are exercised in production behind the GBP dashboard.
    expect(GBP_FIELD_SOURCES.phone.confidence).toBe('verified')
    expect(GBP_FIELD_SOURCES.businessCity.confidence).toBe('verified')
  })

  it('every field a check reads is a real record field with a recorded source', () => {
    for (const field of GBP_FIELDS_READ_BY_CHECKS) {
      expect(GBP_FIELD_SOURCES[field]).toBeDefined()
      expect(GBP_FIELD_SOURCES[field].note.length).toBeGreaterThan(0)
    }
  })

  it('derives the gate from the ledger, so correcting the ledger opened it', () => {
    // blockingFields() is what refused to emit for every client. It was never
    // hand-maintained alongside the ledger, which is why fixing three notes was the
    // whole fix — no other line changed.
    expect(blockingFields()).toEqual([])
  })

  it("records primaryCategory's null-to-empty flattening rather than presenting a clean pass-through", () => {
    // lib/connectors/gbp.ts:297 returns null for "no primary category set" and
    // auditLocation treats that as a real issue. GbpProfileRecord types the field as
    // `string`, so '' is the only expressible form — the ledger has to say so.
    expect(GBP_FIELD_SOURCES.primaryCategory.note).toMatch(/NULL when the profile has no primary/)
    expect(GBP_FIELD_SOURCES.primaryCategory.note).toMatch(/string \| null/)
  })
})

// ── loading outside Next ──────────────────────────────────────────────────────

describe('the module graph', () => {
  it('reaches lib/connectors/gbp only through deferred imports', async () => {
    // THE REGRESSION THIS CATCHES. `import { decideGBPScope } from '@/lib/connectors/gbp'`
    // was a VALUE import, which put lib/api-cache -> lib/supabase/server -> next/headers in
    // this module's static graph and made `import('@/lib/stations/gbp')` die
    // ERR_MODULE_NOT_FOUND under plain node — defeating the lazy `listLocations` import in
    // the same file. scripts/audit-dry-run.ts is the only way to run an audit today and it
    // runs under plain node, so a static import here would break the pipeline at LOAD.
    //
    // Vitest resolves next/headers, so this cannot be caught by loading the module; the
    // source is read instead. The runtime proof is the command in the same commit:
    //   node --import ./scripts/ts-alias-hook.mjs -e "import('@/lib/stations/gbp')"
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', '..', 'lib/stations/gbp.ts'), 'utf8')
    const staticImports = src.match(/^import .*from '@\/lib\/connectors\/gbp'/gm) ?? []
    for (const line of staticImports) {
      expect(line).toMatch(/^import type /)
    }
    // And the deferred ones are still there.
    expect(src).toMatch(/await import\('@\/lib\/connectors\/gbp'\)|import\('@\/lib\/connectors\/gbp'\)/)
  })
})

// ── refusals ──────────────────────────────────────────────────────────────────

describe('the station refuses rather than inventing', () => {
  it('an unconfigured account is an error, not an empty ok', async () => {
    const r = await runGbpStation(input({ accountName: null }), readableDeps())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no gbp_account_id/)
  })

  it('a disconnected Business Profile identity is named as such', async () => {
    const r = await runGbpStation(input({ auth: null }), readableDeps())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not connected/)
  })

  it('fails closed on an unconfigured scope, never reading the account', async () => {
    let called = false
    let read = false
    const r = await runGbpStation(
      input({ locationGroup: null }),
      readableDeps({
        listLocations: async () => {
          called = true
          return [location()]
        },
        fetchMedia: async () => {
          read = true
          return mediaOk()
        },
      }),
    )
    expect(r.ok).toBe(false)
    // Slice 1's invariant: an unscoped read must not happen at all, because one brand's
    // findings must never be computed from another brand's profile. That now covers the
    // v4 reads too — they are the ones that carry review text.
    expect(called).toBe(false)
    expect(read).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/scope is not configured/)
  })

  it('refuses to pick one of several locations', async () => {
    const r = await runGbpStation(
      input(),
      readableDeps({ listLocations: lister([location(), location({ name: 'locations/789' })]) }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/resolves to 2 locations/)
  })

  it('reports an empty scope rather than an empty profile', async () => {
    const r = await runGbpStation(input(), readableDeps({ listLocations: lister([]) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no locations/)
  })

  it('addresses v4 with the SCOPED parent, not the raw account id', async () => {
    // v4 needs accounts/{a}/locations/{l}, and the account that owns this location is the
    // one it was just listed under. Using the client's raw gbp_account_id when the scope
    // narrowed to a location group addresses the location under a container it may not sit
    // in — a 404 that reads exactly like "this location has no reviews".
    const seen: string[] = []
    await runGbpStation(
      input({ locationGroup: 'accounts/999' }),
      readableDeps({
        fetchMedia: async (_a, _l, account) => {
          seen.push(account)
          return mediaOk()
        },
        fetchReviews: async (_a, _l, account) => {
          seen.push(account)
          return reviewsOk()
        },
      }),
    )
    expect(seen).toEqual(['accounts/999', 'accounts/999'])
  })
})

// ── a failed v4 read is not a measurement ─────────────────────────────────────

describe('a failed v4 read refuses, and says which read failed', () => {
  it('a 403 on media blocks the record rather than reporting zero photos', async () => {
    const r = await runGbpStation(
      input(),
      readableDeps({
        fetchMedia: async () => ({
          ok: false,
          reason: 'http_status',
          httpStatus: 403,
          error: 'could not read media for accounts/123/locations/456: HTTP 403',
        }),
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    // The RUN's failure, not the ledger's description of where photos come from. The
    // ledger says the source exists; the operator needs to know why it did not arrive.
    expect(r.error).toContain('HTTP 403')
    expect(r.error).toContain('photoCount')
    expect(r.error).toContain('12 of 13')
    expect(r.error).toMatch(/read by a registered check/)
    expect(r.sources).toEqual(['gbp'])
  })

  it('a page-cap truncation on reviews is a refusal, never a floor reported as a total', async () => {
    const r = await runGbpStation(
      input(),
      readableDeps({
        fetchReviews: async () => ({
          ok: false,
          reason: 'page_cap',
          error: 'stopped after 20 pages (1000 reviews) and Google offered more',
          partial: {
            locationResourceName: 'accounts/123/locations/456',
            reviews: [],
            totalReviewCount: 1000,
            averageRating: 4.9,
            pagesFetched: 20,
            complete: false,
          },
        }),
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('rating')
    expect(r.error).toContain('reviewCount')
    expect(r.error).toMatch(/Google offered more/)
    // rating and reviewCount are read by NO registered check today, so the refusal must
    // not claim otherwise — it refuses because the record type has nowhere to put "not
    // read", which is a different sentence.
    expect(r.error).toMatch(/no shape for a field that was not read/)
  })
})

// ── the assembly ──────────────────────────────────────────────────────────────

describe('what the station can and cannot assemble', () => {
  it('resolves the ten v1 fields and leaves the three v4 fields ABSENT, not defaulted', () => {
    const draft = draftFromLocation(location())
    expect(completeRecord(draft)).toEqual(['photoCount', 'rating', 'reviewCount'])
    // The distinction the whole module rests on: absent, not zero. `0` would be
    // indistinguishable from a real measurement of an empty profile.
    expect('photoCount' in draft).toBe(false)
    expect('reviewCount' in draft).toBe(false)
    expect(draft.businessCity).toBe('Sherman Oaks, CA')
  })

  it('reads a hidden address as correct SAB configuration, not as a missing field', () => {
    const draft = draftFromLocation(hiddenAddressSab())
    expect(draft.isServiceAreaBusiness).toBe(true)
    expect(draft.storefrontAddress).toBeNull()
    expect(completeRecord(draft)).toEqual(['photoCount', 'rating', 'reviewCount'])
  })

  it('keeps a measured absence measured: a null phone is not a missing field', () => {
    const draft = draftFromLocation(location({ primaryPhone: null, websiteUri: null }))
    expect(draft.phone).toBeNull()
    // If these counted as "could not assemble", the station would refuse and LOCAL-003
    // could never report the one thing it exists to report.
    expect(completeRecord(draft)).not.toContain('phone')
    expect(completeRecord(draft)).not.toContain('websiteUri')
  })

  it('leaves businessCity empty for a profile that exposes no address', () => {
    // Google's own field doc: storefrontAddress "should not be set for locations of type
    // CUSTOMER_LOCATION_ONLY". There is no anchor to invent one from.
    expect(draftFromLocation(hiddenAddressSab()).businessCity).toBe('')
  })

  it("flattens a null primaryCategory to '' and makes the flattening visible", async () => {
    // The record type has nowhere else to put it (`primaryCategory: string`), so '' is
    // the measurement. What must not happen is the measurement disappearing: the station
    // names it in its notes, and nothing else in the module ever writes '' here.
    const draft = draftFromLocation(location({ primaryCategory: null }))
    expect(draft.primaryCategory).toBe('')
    expect(hasNoPrimaryCategory(draft)).toBe(true)
    expect(hasNoPrimaryCategory(draftFromLocation(location()))).toBe(false)

    const r = await runGbpStation(
      input(),
      readableDeps({ listLocations: lister([location({ primaryCategory: null })]) }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.notes?.join(' ')).toMatch(/no primary category set/)
    // And the connector still treats it as a real issue, which is the distinction the
    // flattening must not erase.
    expect(auditLocation(location({ primaryCategory: null })).issues).toContain(
      'No primary category set',
    )
  })
})

// ── the emit path, which had never executed ───────────────────────────────────

describe('the station emits once the ledger is right', () => {
  it('assembles all thirteen fields from v1 + v4 and reports degraded', async () => {
    const r = await runGbpStation(input(), readableDeps())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(completeRecord(r.data)).toEqual([])
    expect(r.data.photoCount).toBe(22)
    expect(r.data.rating).toBe(4.8)
    expect(r.data.reviewCount).toBe(129)
    // A clean GBP result is never a clean bill of health: LOCAL-003's rubric row lists
    // services and attributes, which GbpProfileRecord does not model at all.
    expect(r.degraded).toBe(true)
    expect(r.sources).toEqual(['gbp'])
  })

  it('says in its notes what it did not measure and what it has never verified', async () => {
    const r = await runGbpStation(input(), readableDeps())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const notes = (r.notes ?? []).join(' | ')
    expect(notes).toMatch(/services or attributes/)
    // The honest half of the correction: these came from an API nobody has ever called.
    expect(notes).toMatch(/never been called from this project/)
    expect(notes).toMatch(/photoCount, rating, reviewCount/)
  })

  it('distinguishes a rating Google supplied from one we averaged ourselves', async () => {
    const derived = await runGbpStation(
      input(),
      readableDeps({
        fetchReviews: async () =>
          reviewsOk({
            averageRating: null,
            totalReviewCount: null,
            reviews: [
              {
                name: null,
                reviewId: 'a',
                starRating: 4,
                starRatingRaw: 'FOUR',
                createTime: '2026-08-01T00:00:00Z',
                updateTime: null,
                reviewer: { displayName: null, isAnonymous: true },
                comment: null,
                reply: null,
              },
            ],
          }),
      }),
    )
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    expect(derived.data.rating).toBe(4)
    expect(derived.data.reviewCount).toBe(1)
    const notes = (derived.notes ?? []).join(' | ')
    expect(notes).toMatch(/not Google's own aggregate/)
  })

  it('carries a rating-less profile as null, not as a zero', async () => {
    const r = await runGbpStation(
      input(),
      readableDeps({
        fetchReviews: async () => reviewsOk({ averageRating: null, totalReviewCount: 0 }),
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 0 is not expressible on a 1-5 scale, so a 0 here would be a fabricated fail for
    // LOCAL-010 the day it lands. null is the measurement: no reviews, no rating.
    expect(r.data.rating).toBeNull()
    expect(r.data.reviewCount).toBe(0)
  })

  it('emits a record LOCAL-003 can actually evaluate, capped at degraded', async () => {
    const r = await runGbpStation(input(), readableDeps())
    expect(r.ok).toBe(true)
    const f = runChecks([check('LOCAL-003')], { gbp: r as StationBundle['gbp'] })[0]
    // Not `pass`: the engine's degraded cap rewrites a clean result on partial data.
    expect(f.status).toBe('degraded')
    expect(f.reason).toMatch(/partial/)

    // A real defect still comes through as a defect — the cap only rewrites a pass.
    const noPhone = await runGbpStation(
      input(),
      readableDeps({ listLocations: lister([location({ primaryPhone: null })]) }),
    )
    const defective = runChecks([check('LOCAL-003')], { gbp: noPhone as StationBundle['gbp'] })[0]
    expect(defective.status).toBe('fail')
    expect(defective.evidence.detail).toContain('phone')
  })

  it('does not dock a service-area business for hiding its address', async () => {
    const r = await runGbpStation(input(), readableDeps({ listLocations: lister([hiddenAddressSab()]) }))
    const f = runChecks([check('LOCAL-003')], { gbp: r as StationBundle['gbp'] })[0]
    expect(f.evidence.detail ?? '').not.toContain('storefront address')
    expect(f.status).not.toBe('fail')
  })

  it('a photo-poor profile fails LOCAL-003 on a number that was actually read', async () => {
    const r = await runGbpStation(input(), readableDeps({ fetchMedia: async () => mediaOk(1) }))
    const f = runChecks([check('LOCAL-003')], { gbp: r as StationBundle['gbp'] })[0]
    expect(f.status).toBe('fail')
    expect(f.evidence.detail).toContain('photos')
  })
})

// ── the fabrication proofs ────────────────────────────────────────────────────

const site = (): CrawlStationData['site'] => ({
  robotsTxt: null,
  robotsTxtStatus: 'not-fetched',
  llmsTxt: null,
  llmsTxtStatus: 'not-fetched',
  sitemapUrls: [],
})

function page(url: string, targetGeo: string | null): CrawlPageRecord {
  return {
    url,
    status: 200,
    title: 't',
    metaDescription: 'd',
    h1s: ['h'],
    canonical: null,
    robotsMeta: '',
    hasViewportMeta: true,
    tapTargetsOk: true,
    analytics: { ga4: true, gtm: false },
    internalLinksOut: 3,
    internalLinksIn: 2,
    wordCount: 900,
    uniqueWordCount: 800,
    templateGroup: 'area',
    targetGeo,
  }
}

const crawlWith = (pages: CrawlPageRecord[]) =>
  toolOk<CrawlStationData>({ site: site(), pages }, { sources: ['crawl'] })

const findingFor = (findings: Finding[], id: string) => findings.find((f) => f.checkId === id)!

/** Every field present and plausible — nothing here is a placeholder. */
function fullRecord(over: Partial<GbpProfileRecord> = {}): GbpProfileRecord {
  return {
    name: 'Pasadena Plumbing',
    primaryCategory: 'Plumber',
    isServiceAreaBusiness: false,
    storefrontAddress: '1 Main St, Pasadena, CA, 91101',
    businessCity: 'Pasadena, CA',
    serviceAreas: [],
    hoursComplete: true,
    phone: '+1-626-555-0100',
    websiteUri: 'https://pasadenaplumbing.example',
    description: 'Drains, water heaters and repiping.',
    photoCount: 20,
    rating: 4.8,
    reviewCount: 120,
    ...over,
  }
}

/** The real registry, the real engine. No stub check, no hand-called evaluate(). */
function local016For(record: GbpProfileRecord, pages: CrawlPageRecord[]): Finding {
  return findingFor(
    runChecks(CHECKS, { crawl: crawlWith(pages), gbp: toolOk(record, { sources: ['gbp'] }) }),
    'LOCAL-016',
  )
}

describe('LOCAL-016 cannot produce a verdict the record does not support', () => {
  const orangeCountyPages = [
    page('https://t.example/areas/anaheim/', 'Anaheim, CA'),
    page('https://t.example/areas/irvine/', 'Irvine, CA'),
  ]

  it('THE STOREFRONT FABRICATION: an empty declared set makes it not_run, never fail', () => {
    // THE REPRODUCTION. Before this fix: status 'fail', evidence.affectedUrls 2,
    // "2 of 2 location pages target geography outside the profile's service area" — a
    // verticalCritical FAIL with a plausible magnitude, derived from a field the profile
    // never populates. lib/connectors/gbp.ts:307 fills serviceAreas from
    // Location.serviceArea, which the Business Information API returns ONLY for a
    // service-area business, so [] is what EVERY storefront client produces. Glendale and
    // Burbank are eight and twelve miles from Pasadena; both are plainly rankable.
    const f = local016For(fullRecord(), [
      page('https://x.example/glendale/', 'Glendale, CA'),
      page('https://x.example/burbank/', 'Burbank, CA'),
    ])
    expect(f.status).toBe('not_run')
    expect(f.status).not.toBe('fail')
    expect(f.reason).toMatch(/declares no service areas/)
    // No invented magnitude either — a not_run that carries a count reads as measured.
    expect(f.evidence.affectedUrls).toBeUndefined()
    expect(f.evidence.value).toBeUndefined()
  })

  it('an empty-anchor record makes it not_run, never fail', () => {
    // The record a station that defaulted its unavailable fields would hand over: a
    // non-null object, so the engine sees an `ok`, non-empty station and runs the check.
    const f = local016For(
      fullRecord({
        name: '',
        primaryCategory: '',
        storefrontAddress: null,
        businessCity: '',
        hoursComplete: false,
        phone: null,
        websiteUri: null,
        description: null,
        photoCount: 0,
        rating: null,
        reviewCount: 0,
      }),
      orangeCountyPages,
    )
    expect(f.status).toBe('not_run')
    expect(f.reason).toMatch(/no proximity anchor/)
    expect(f.evidence.affectedUrls).toBeUndefined()
  })

  it('an anchor with declared areas but no location pages is not_run, not pass', () => {
    // §17 failure mode 1: "we did not look" rendered as "it is fine". targetGeo is null on
    // every page until lib/ingest/sitebulb/geo.ts is wired.
    const f = local016For(
      fullRecord({ serviceAreas: ['Glendale, CA'] }),
      [page('https://x.example/', null)],
    )
    expect(f.status).toBe('not_run')
    expect(f.reason).toMatch(/no page carries a targetGeo/)
  })

  it('EXHAUSTIVE: no combination of anchor and declared set yields a verdict without both', () => {
    // The property, rather than three examples of it. Whatever else varies, a pass or a
    // fail requires the profile to have STATED a geography — a city it operates from and
    // at least one area it declares.
    const anchors = ['Pasadena, CA', '', '   ']
    const declaredSets: string[][] = [[], ['   '], ['', '  '], ['Glendale, CA']]
    for (const businessCity of anchors) {
      for (const serviceAreas of declaredSets) {
        const f = local016For(fullRecord({ businessCity, serviceAreas }), [
          page('https://x.example/glendale/', 'Glendale, CA'),
          page('https://x.example/anaheim/', 'Anaheim, CA'),
        ])
        const stated =
          businessCity.trim().length > 0 && serviceAreas.some((a) => a.trim().length > 0)
        if (stated) {
          expect(['pass', 'fail']).toContain(f.status)
        } else {
          expect(f.status).toBe('not_run')
          expect(f.evidence.affectedUrls).toBeUndefined()
          expect(f.reason ?? '').not.toBe('')
        }
      }
    }
  })

  it('still finds the Tornado defect, and names the declaration it measured against', () => {
    // The guards must not cost the check its real finding: a Sherman Oaks profile with ten
    // declared San Fernando Valley areas, serving Orange County pages.
    const f = local016For(
      fullRecord({
        businessCity: 'Sherman Oaks, CA',
        serviceAreas: ['Van Nuys, CA', 'Burbank, CA', 'Glendale, CA'],
      }),
      orangeCountyPages,
    )
    expect(f.status).toBe('fail')
    expect(f.evidence.affectedUrls).toBe(2)
    expect(f.evidence.examples).toEqual([
      'https://t.example/areas/anaheim/ → Anaheim, CA',
      'https://t.example/areas/irvine/ → Irvine, CA',
    ])
    // The wording is frozen by fixtures/eval/tornado/scoring.snapshot.json, which
    // tests/unit/eval-snapshot.test.ts asserts byte-for-byte. Pinned here so that anyone
    // who improves the sentence learns about the snapshot from this file rather than from
    // a confusing failure two lanes away. See the note at the fail branch in checks.ts.
    expect(f.evidence.detail).toBe(
      "2 of 2 location pages target geography outside the profile's service area.",
    )
  })

  it('a clean pass claims membership in a declaration, not rankability', () => {
    const f = local016For(
      fullRecord({ businessCity: 'Pasadena, CA', serviceAreas: ['Glendale, CA'] }),
      [page('https://x.example/glendale/', 'Glendale, CA')],
    )
    expect(f.status).toBe('pass')
    // The §3 trap is still open — a profile that DECLARED Orange County would pass on
    // Orange County pages — and closing it needs an interface change this check cannot
    // make (see the header). What the pass must not do is overstate itself.
    expect(f.evidence.detail).toMatch(/does not establish that the profile can rank/)
  })

  it("the station's own refusal reaches both checks as not_run with the real reason", async () => {
    const result = await runGbpStation(
      input(),
      readableDeps({
        listLocations: lister([hiddenAddressSab()]),
        fetchMedia: async () => ({
          ok: false,
          reason: 'http_status',
          httpStatus: 403,
          error: 'could not read media for accounts/123/locations/456: HTTP 403',
        }),
      }),
    )
    expect(result.ok).toBe(false)
    // Exactly what the orchestrator would put in the bundle, unedited.
    const findings = runChecks(CHECKS, {
      crawl: crawlWith(orangeCountyPages),
      gbp: result as StationBundle['gbp'],
    })
    for (const id of ['LOCAL-003', 'LOCAL-016']) {
      const f = findingFor(findings, id)
      expect(f.status).toBe('not_run')
      expect(f.reason).toMatch(/gbp station failed/)
      expect(f.reason).toMatch(/photoCount/)
      expect(f.evidence.affectedUrls).toBeUndefined()
      expect(f.evidence.value).toBeUndefined()
    }
  })
})

// ── the §9 false positive, in the tool that shipped it ────────────────────────

describe('auditLocation and the documented §9 false positive', () => {
  it('no longer docks a service-area business for hiding its address', () => {
    const audit = auditLocation(hiddenAddressSab())
    expect(audit.issues).not.toContain('No storefront address')
    expect(audit.score).toBe(100)
  })

  it('still docks a storefront business that has no address', () => {
    const audit = auditLocation(location({ address: null }))
    expect(audit.issues).toContain('No storefront address')
    expect(audit.score).toBe(85)
  })
})
