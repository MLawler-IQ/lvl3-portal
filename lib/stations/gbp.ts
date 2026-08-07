// The GBP station: one Business Profile location, as the GbpProfileRecord the checks
// consume.
//
// WHAT MAKES THIS STATION DIFFERENT FROM gsc.ts AND robots.ts. Those two can always
// produce their whole payload or nothing. This one assembles thirteen fields from TWO
// Google APIs — Business Information v1 for the profile, My Business v4 for photos,
// rating and review count — so a run can succeed at one and fail at the other. The
// interesting code here is therefore not the fetch: it is the ledger below that records
// where each field comes from and how well established that source is, and the gate that
// refuses to emit a record when a field a registered check READS could not be read.
//
// WHY THE GATE, AND NOT A PLACEHOLDER. A record of `{ …, photoCount: 0 }` is a perfectly
// ordinary non-null object, so lib/findings/engine.ts sees an `ok`, non-empty station and
// runs LOCAL-003, which reports "GBP profile incomplete: missing photos" for a client
// whose photos we simply failed to read. That is a FABRICATED FAIL — the same class of
// defect as the fabricated pass commit c36a9a3 removed from the robots station, and no
// better for pointing the other way. There is no value for `photoCount` that is honest
// when the read failed: 0 fabricates a fail, a large number fabricates a pass, NaN
// fabricates whichever the comparison operator happens to yield. The only honest move is
// to not build the record, which is what `completeRecord` does — a ToolErr carries no
// data, so no invented number can reach a finding.
//
// THE LEDGER WAS WRONG, AND THAT IS THE REASON THIS FILE CHANGED. Until 2026-08-07 it
// recorded photoCount, rating and reviewCount as `obtainable: false`, with notes asserting
// AS ESTABLISHED FACT that the Media API is "not authorised" and that legacy My Business
// v4 is "not enabled for this project". Both claims were false, and neither had ever been
// checked against the Cloud console:
//
//   VERIFIED in the Google Cloud console for project lvl3-portal on 2026-08-07 —
//     · Google My Business API (mybusiness.googleapis.com) is ENABLED, type "Private API"
//       (allowlisted), status Enabled.
//     · Granted quota 250,000 requests/day, 600/min, 3,000/min "V4 General Requests",
//       600/min Insights. Usage 0% — nothing had ever called it.
//     · The Business Profile OAuth token already carries
//       https://www.googleapis.com/auth/business.manage
//       (components/admin/GBPConnectionPanel.tsx:37), which is the scope v4 needs.
//
// A ledger entry asserting a negative it never measured is the same move the `not_run`
// rule forbids for a check: "we did not look" rendered as "there is nothing there". Every
// entry below therefore carries an explicit `confidence`, and a field marked `assumed` is
// one whose source is documented and enabled but has never returned a byte to this code.
// That distinction rides out to the operator in stationNotes(); it is not a comment.
//
// The reader for the three v4 fields is lib/connectors/gbp-reviews.ts, which is pure
// (no imports at all) and whose ok/!ok split already carries the property this module
// needs: `ok: true` means "this is the COMPLETE set for this location", and a truncated
// or 403'd read is `ok: false`. So `if (!res.ok) refuse` is the correct thing to write,
// and a page-cap floor can never be assembled into a record as a total.
//
// LOADING OUTSIDE NEXT. Every static import here is type-only or pure. `decideGBPScope`
// and `listGBPLocations` both live in lib/connectors/gbp.ts, which reaches lib/api-cache →
// lib/supabase/server → `next/headers`, a specifier that does not resolve under plain
// node. A VALUE import of either would put that whole chain in this module's static graph
// and make `import('@/lib/stations/gbp')` die at LOAD time — which it did, defeating the
// deferred import a few lines further down that was written to prevent exactly that. Both
// are now deferred, and tests/unit/gbp-station.test.ts pins the property. lib/stations/gsc.ts
// has the same shape. This is not packaging tidiness: scripts/audit-dry-run.ts is the only
// way to run an audit today (docs/CONTEXT-LIBRARY.md §1) and it runs under plain node, so
// a station that cannot be loaded there cannot be wired into lib/orchestrator/run.ts at all.

import type { GBPLocation, GBPScopeDecision } from '@/lib/connectors/gbp'
import {
  fetchLocationMedia,
  fetchLocationReviews,
  summariseReviews,
  type GbpMediaPayload,
  type GbpReadResult,
  type GbpReviewsPayload,
} from '@/lib/connectors/gbp-reviews'
import { runGuarded, toolErr, toolOk, type ToolResult } from '@/lib/tools/contract'
import type { GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { OAuth2Client } from 'google-auth-library'

// ── the field ledger ──────────────────────────────────────────────────────────

/**
 * How well established a field's source is.
 *
 * `verified` — this exact read runs today and returns this field. The v1 profile reads are
 *   verified because listGBPLocations is in production use behind the GBP dashboard and
 *   the GBP Audit tool, against the same read mask.
 * `assumed` — the API is enabled with granted quota and the field is documented, but no
 *   call has ever been made from this project, so the response SHAPE is documentation
 *   rather than observation. An `assumed` field is still obtainable; what is unproven is
 *   what comes back, and the first live run is what settles it. Never silently upgrade an
 *   entry to `verified` — only a live response should.
 */
export type GbpSourceConfidence = 'verified' | 'assumed'

/** Whether a GbpProfileRecord field has a source at all, what it is, and how sure we are. */
export interface GbpFieldSource {
  /** True when SOME authorised API can supply it — not whether this profile has a value. */
  obtainable: boolean
  /** Whether that source has actually been exercised. See GbpSourceConfidence. */
  confidence: GbpSourceConfidence
  /** Where it comes from, or what would have to change for it to exist. */
  note: string
}

/**
 * Every GbpProfileRecord field against what can actually supply it.
 *
 * Typed as an exhaustive Record so that adding a field to GbpProfileRecord without
 * deciding where it comes from is a compile error rather than a silent placeholder.
 *
 * "obtainable" is a claim about the API surface, not about any one profile. `phone` is
 * obtainable and frequently null — that null is a MEASUREMENT, and LOCAL-003 exists to
 * report it. A field whose READ FAILED on a given run is a third thing again, and it is
 * not represented here at all: it is carried per-run by GbpFieldReadFailure, because it is
 * a property of the run and not of the API.
 */
export const GBP_FIELD_SOURCES: Record<keyof GbpProfileRecord, GbpFieldSource> = {
  name: { obtainable: true, confidence: 'verified', note: 'Location.title (Business Information v1)' },
  primaryCategory: {
    obtainable: true,
    confidence: 'verified',
    note:
      "Location.categories.primaryCategory.displayName. NULL when the profile has no primary " +
      "category set — which auditLocation treats as a real issue (lib/connectors/gbp.ts:451) — " +
      "but GbpProfileRecord types this field as `string`, so the only value available to express " +
      "that state is ''. It is recorded as '' AND named in the station notes, so the erasure is " +
      "visible rather than silent. Any check that reads this field must treat '' as \"no category " +
      "set\", never as a category name; a check that needs to tell \"not set\" from \"not read\" " +
      'requires GbpProfileRecord.primaryCategory to become `string | null` first.',
  },
  isServiceAreaBusiness: {
    obtainable: true,
    confidence: 'verified',
    note: 'Location.serviceArea is present only for a service-area business',
  },
  storefrontAddress: {
    obtainable: true,
    confidence: 'verified',
    note: 'Location.storefrontAddress; legitimately absent for a CUSTOMER_LOCATION_ONLY business, which is a measurement rather than a gap',
  },
  businessCity: {
    obtainable: true,
    confidence: 'verified',
    note: "Location.storefrontAddress.locality + administrativeArea; empty for a business whose address the API does not expose, which LOCAL-016 must read as 'no anchor'",
  },
  serviceAreas: {
    obtainable: true,
    confidence: 'verified',
    note:
      'Location.serviceArea.places.placeInfos[].placeName — a DECLARATION of coverage, never ' +
      'evidence of proximity. The API returns serviceArea ONLY for a service-area business, so ' +
      'this is [] for every storefront client, and an empty list is "nothing declared" rather ' +
      'than "serves nowhere". LOCAL-016 must not read it as a coverage boundary.',
  },
  hoursComplete: {
    obtainable: true,
    confidence: 'verified',
    note: 'Location.regularHours.periods is non-empty. Narrower than the field name: this is "hours are set at all", not "hours are correct or cover every day"',
  },
  phone: { obtainable: true, confidence: 'verified', note: 'Location.phoneNumbers.primaryPhone' },
  websiteUri: { obtainable: true, confidence: 'verified', note: 'Location.websiteUri' },
  description: { obtainable: true, confidence: 'verified', note: 'Location.profile.description' },
  photoCount: {
    obtainable: true,
    confidence: 'assumed',
    note:
      'My Business v4 media.list, counted by mediaFormat === "PHOTO" (fetchLocationMedia). ' +
      'NOT totalMediaItemCount, which is Google\'s aggregate over all media and includes videos. ' +
      'VERIFIED: mybusiness.googleapis.com is enabled on project lvl3-portal (Private API, ' +
      '250,000 req/day granted) and the OAuth token carries business.manage. ASSUMED: that ' +
      "media.list returns every photo on the profile — usage has been 0%, so no response has " +
      'ever been seen. Confirm against a live account before describing this to a client as ' +
      '"every photo on the profile".',
  },
  rating: {
    obtainable: true,
    confidence: 'assumed',
    note:
      "My Business v4 reviews.list `averageRating` (fetchLocationReviews → summariseReviews). " +
      'Null means no rating exists, which is the honest state for a location with no reviews; ' +
      'the summariser refuses to carry a 0 through, because 0 is not expressible on a 1-5 scale. ' +
      'VERIFIED: same enablement, quota and scope as photoCount. ASSUMED: the response shape, ' +
      'unexercised.',
  },
  reviewCount: {
    obtainable: true,
    confidence: 'assumed',
    note:
      "My Business v4 reviews.list `totalReviewCount` — Google's own aggregate, which covers " +
      'reviews beyond the pages read, so it is preferred over the row count. VERIFIED: same ' +
      'enablement, quota and scope as photoCount. ASSUMED: the response shape, unexercised.',
  },
}

const RECORD_FIELDS = Object.keys(GBP_FIELD_SOURCES) as Array<keyof GbpProfileRecord>

/** The fields nothing can supply, in record order. Empty since the v4 reader landed. */
export const GBP_UNOBTAINABLE_FIELDS = RECORD_FIELDS.filter(
  (f) => !GBP_FIELD_SOURCES[f].obtainable,
)

/** Fields whose source is enabled and documented but has never returned a response. */
export const GBP_ASSUMED_FIELDS = RECORD_FIELDS.filter(
  (f) => GBP_FIELD_SOURCES[f].obtainable && GBP_FIELD_SOURCES[f].confidence === 'assumed',
)

/**
 * The GbpProfileRecord fields a registered gbp-backed check reads today.
 *
 * Hand-maintained against lib/findings/checks.ts (LOCAL-003 and LOCAL-016) and
 * DELIBERATELY not imported from there: checks.ts is pure and must stay importable
 * outside the Next runtime, while this module reaches googleapis and Supabase. A wrong
 * entry here is caught by tests/unit/gbp-station.test.ts, which drives the real check
 * bodies against the real station output rather than trusting this list.
 */
export const GBP_FIELDS_READ_BY_CHECKS: ReadonlyArray<keyof GbpProfileRecord> = [
  // LOCAL-003
  'hoursComplete',
  'phone',
  'websiteUri',
  'description',
  'photoCount',
  'isServiceAreaBusiness',
  'storefrontAddress',
  // LOCAL-016
  'serviceAreas',
  'businessCity',
]

/**
 * Fields a check reads that NO authorised API can supply — a permanent, structural gap.
 *
 * Empty as of 2026-08-07, and that is the whole point of correcting the ledger: this
 * function is derived from it, never hand-maintained alongside it, so fixing the ledger
 * opened the gate with no other line changed.
 *
 * NOT the same thing as "the read failed this run". A failed read is per-run and is
 * handled by the refusal path below; this is about what the API surface can ever supply.
 * A function rather than a constant so the answer is recomputed from the ledger every
 * call, which means a test can read the same answer the station acts on.
 */
export function blockingFields(): Array<keyof GbpProfileRecord> {
  return GBP_FIELDS_READ_BY_CHECKS.filter((f) => !GBP_FIELD_SOURCES[f].obtainable)
}

// ── the station ───────────────────────────────────────────────────────────────

export interface GbpStationInput {
  /** clients.gbp_account_id, e.g. "accounts/123". */
  accountName: string | null
  /** clients.gbp_location_group. See decideGBPScope — null means "refuse". */
  locationGroup: string | null
  /** ToolContext.gbpAuth. Null when the Business Profile identity is not connected. */
  auth: OAuth2Client | null
}

/** One v4 read that did not produce the fields it owns. Per-run, never in the ledger. */
export interface GbpFieldReadFailure {
  /** The record fields this read was the source for. */
  fields: Array<keyof GbpProfileRecord>
  /** The reader's own sentence — already names the resource and the likely cause. */
  error: string
}

export interface GbpStationDeps {
  /**
   * Injected in tests. Defaults to a LAZY import of lib/connectors/gbp — that module
   * reaches lib/api-cache, which constructs the Supabase server client, which imports
   * `next/headers`, and that specifier does not resolve outside the Next runtime. A
   * static VALUE import would make a plain `node` run of the pipeline fail at LOAD time.
   * Same reasoning, same shape, as the deferred import in lib/stations/gsc.ts.
   */
  listLocations?: (accountName: string, auth: OAuth2Client) => Promise<GBPLocation[]>
  /**
   * Also deferred, and for the same reason — this was the leak. `decideGBPScope` is five
   * pure lines, but it lives in the Next-tainted module above, so value-importing it put
   * `next/headers` in this file's static graph and made the deferred `listLocations`
   * import buy nothing. Deferring rather than duplicating: two copies of a scope rule is
   * how the two robots parsers came to disagree (docs/robots-parser-findings.md).
   */
  decideScope?: (
    accountName: string,
    locationGroup: string | null,
  ) => GBPScopeDecision | Promise<GBPScopeDecision>
  /** v4 reviews.list. Supplies `rating` and `reviewCount`. */
  fetchReviews?: (
    auth: OAuth2Client,
    locationResourceName: string,
    accountName: string,
  ) => Promise<GbpReadResult<GbpReviewsPayload>>
  /** v4 media.list. Supplies `photoCount`. */
  fetchMedia?: (
    auth: OAuth2Client,
    locationResourceName: string,
    accountName: string,
  ) => Promise<GbpReadResult<GbpMediaPayload>>
}

/**
 * Fetch the one Business Profile location this client's scope resolves to.
 *
 * UNCONFIGURED IS AN ERROR, NOT AN EMPTY OK, exactly as in the GSC station: `toolOk`
 * with a hollow record would hit the engine's non-empty branch and run both checks
 * against nothing. Same `not_run` either way; only the sentence differs, and the sentence
 * is the entire deliverable of a not_run.
 */
export async function runGbpStation(
  input: GbpStationInput,
  deps: GbpStationDeps = {},
): Promise<ToolResult<GbpProfileRecord>> {
  return runGuarded<GbpProfileRecord>(['gbp'], async () => {
    const accountName = input.accountName?.trim() ?? ''
    if (accountName.length === 0) {
      return toolErr<GbpProfileRecord>('client has no gbp_account_id configured', {
        sources: ['gbp'],
      })
    }
    const auth = input.auth
    if (auth === null) {
      return toolErr<GbpProfileRecord>(
        'the Business Profile identity is not connected, so no profile could be read',
        { sources: ['gbp'] },
      )
    }

    // Scope first, and fail closed. Slice 1's whole point: a read that cannot prove the
    // account belongs to this client must not run at all, because one brand's findings
    // must never be computed from another brand's profile.
    const decideScope =
      deps.decideScope ??
      ((account: string, group: string | null) =>
        import('@/lib/connectors/gbp').then(({ decideGBPScope }) =>
          decideGBPScope(account, group),
        ))
    const scope = await decideScope(accountName, input.locationGroup)
    if (!scope.ok) {
      return toolErr<GbpProfileRecord>(
        `GBP location scope is not configured for this client (gbp_location_group = ${JSON.stringify(
          scope.configured,
        )}). Set it to an "accounts/..." location group, or to "*" to assert the whole account is this client's.`,
        { sources: ['gbp'] },
      )
    }

    const listLocations =
      deps.listLocations ??
      (async (parent: string, oauth: OAuth2Client) => {
        const { listGBPLocations } = await import('@/lib/connectors/gbp')
        return listGBPLocations(parent, oauth)
      })

    const locations = await listLocations(scope.parent, auth)

    // ZERO AND MANY ARE BOTH REFUSALS, for different reasons.
    //
    // GbpProfileRecord describes ONE profile. Picking the first of several would attribute
    // one location's completeness to the whole client and report it as measured — a
    // fabricated verdict with a real number attached, which is the most convincing kind.
    // Multi-location scoring is a real feature (the rubric's `multiLocation` column) and
    // it is not this station.
    if (locations.length === 0) {
      return toolErr<GbpProfileRecord>(
        `the ${scope.scope === 'group' ? 'location group' : 'account'} ${scope.parent} contains no locations`,
        { sources: ['gbp'] },
      )
    }
    if (locations.length > 1) {
      return toolErr<GbpProfileRecord>(
        `${scope.parent} resolves to ${locations.length} locations and GbpProfileRecord describes one profile; choosing one would report that location's completeness as the client's`,
        { sources: ['gbp'] },
      )
    }

    const location = locations[0]
    const draft = draftFromLocation(location)

    // ── the two v4 reads ──────────────────────────────────────────────────────
    //
    // The account is `scope.parent`, not `input.accountName`: v4 addresses a location as
    // accounts/{accountId}/locations/{locationId}, and the account that owns this location
    // is the one it was just listed under. Using the client's raw gbp_account_id when the
    // scope narrowed to a location group would address the location under a container it
    // may not sit in — a well-formed request for a resource that does not exist, which
    // 404s in a way that reads exactly like "this location has no reviews".
    //
    // Concurrent, and both are read even when the first fails. They cost two requests
    // either way on the success path, and when they fail they usually fail together for
    // one systemic reason (scope, enablement, token) — so reporting both diagnoses is what
    // lets an operator fix it once instead of twice.
    const fetchMedia = deps.fetchMedia ?? defaultFetchMedia
    const fetchReviews = deps.fetchReviews ?? defaultFetchReviews
    const [media, reviews] = await Promise.all([
      fetchMedia(auth, location.name, scope.parent),
      fetchReviews(auth, location.name, scope.parent),
    ])

    const readFailures: GbpFieldReadFailure[] = []

    if (media.ok) {
      draft.photoCount = media.data.photoCount
    } else {
      readFailures.push({ fields: ['photoCount'], error: media.error })
    }

    // Summarised ONCE. The summary is what the record and the notes are both built from,
    // so recomputing it per consumer would let the two drift apart on a future edit.
    const summary = reviews.ok ? summariseReviews(reviews.data) : null

    if (!reviews.ok) {
      readFailures.push({ fields: ['rating', 'reviewCount'], error: reviews.error })
    } else if (summary!.complete) {
      draft.rating = summary!.averageRating
      draft.reviewCount = summary!.totalReviewCount
    } else {
      // Belt and braces: fetchLocationReviews only returns ok on a run to Google's own
      // end, so this is unreachable today. It stays because `complete` is the flag that
      // separates a floor from a total, and a future caller that summarises `partial`
      // must not be able to launder it into a record through this line.
      readFailures.push({
        fields: ['rating', 'reviewCount'],
        error: `the review read for ${reviews.data.locationResourceName} was marked incomplete, so ${summary!.reviewsRead} reviews are a floor rather than this location's review history`,
      })
    }

    const missing = completeRecord(draft)
    if (missing.length > 0) {
      return toolErr<GbpProfileRecord>(describeRefusal(location, missing, readFailures), {
        sources: ['gbp'],
      })
    }

    const record = draft as GbpProfileRecord

    return toolOk(record, {
      sources: ['gbp'],
      // ALWAYS DEGRADED, and not because anything failed: LOCAL-003's rubric row lists
      // services and attributes, which GbpProfileRecord does not model at all, and three
      // of the thirteen fields it does model come from an API this project has never
      // called. So a clean GBP result is never a clean bill of health, and the engine's
      // degraded cap is exactly the machinery for saying so — it rewrites a `pass` to
      // `degraded` and leaves a real `fail` alone, which is the correct asymmetry: an
      // observed missing phone is a measurement, an unmodelled attribute set is not.
      degraded: true,
      notes: stationNotes(draft, {
        ratingSource: summary?.averageRatingSource ?? 'none',
        reviewCountSource: summary?.totalReviewCountSource ?? 'rows',
      }),
    })
  })
}

/**
 * The default v4 media read.
 *
 * Split out so the station body reads as one flow and so the OAuth2Client →
 * GbpAccessTokenSource adaptation happens in exactly one place. OAuth2Client satisfies
 * that interface structurally; it is not re-wrapped, because the client already handles
 * refresh and persists the new access token.
 */
function defaultFetchMedia(
  auth: OAuth2Client,
  locationResourceName: string,
  accountName: string,
): Promise<GbpReadResult<GbpMediaPayload>> {
  return fetchLocationMedia(auth, locationResourceName, { accountName })
}

function defaultFetchReviews(
  auth: OAuth2Client,
  locationResourceName: string,
  accountName: string,
): Promise<GbpReadResult<GbpReviewsPayload>> {
  return fetchLocationReviews(auth, locationResourceName, { accountName })
}

// ── record assembly ───────────────────────────────────────────────────────────

/**
 * Exported for tests: the assembly, and the evidence about what it could not assemble,
 * are the whole point of this module and are worth asserting directly rather than only
 * through the ToolErr string.
 *
 * Covers the ten Business Information v1 fields only. `photoCount`, `rating` and
 * `reviewCount` come from v4 and are filled in by the station, so a draft straight out of
 * here is deliberately incomplete.
 */
export function draftFromLocation(loc: GBPLocation): Partial<GbpProfileRecord> {
  const addr = loc.address
  // 'Sherman Oaks, CA'. Empty when the API exposes no address — normal for a
  // CUSTOMER_LOCATION_ONLY business, and the state LOCAL-016 must read as "no anchor"
  // rather than as a city called "".
  const businessCity = addr
    ? [addr.locality, addr.administrativeArea].map((p) => p.trim()).filter(Boolean).join(', ')
    : ''

  return {
    name: loc.title,
    // A MEASURED NULL FLATTENED TO '', BECAUSE THE RECORD TYPE HAS NOWHERE ELSE TO PUT IT.
    //
    // lib/connectors/gbp.ts:297 returns null deliberately for "no primary category set",
    // and auditLocation treats that as a real issue. GbpProfileRecord.primaryCategory is
    // `string`, so '' is the only expressible form of that measurement. It is NOT a
    // placeholder for an unread field: nothing else in this module ever writes '' here,
    // and stationNotes() names the location when it happens, so the state is visible in
    // the station strip rather than inferred from a falsy string. No registered check
    // reads this field today; the first one that does must treat '' as "not set", and if
    // it ever needs to tell that apart from "not read", the record type has to change
    // first. See the ledger entry.
    primaryCategory: loc.primaryCategory ?? '',
    isServiceAreaBusiness: loc.isServiceAreaBusiness,
    storefrontAddress: formatAddress(loc),
    businessCity,
    serviceAreas: loc.serviceAreas,
    // See the ledger: this is "hours are set at all", which is narrower than the field
    // name promises. LOCAL-004 (hours accurate, including 24/7) is a different check and
    // has no detector.
    hoursComplete: loc.hasRegularHours,
    phone: loc.primaryPhone,
    websiteUri: loc.websiteUri,
    description: loc.description,
    // photoCount, rating and reviewCount are ABSENT ON PURPOSE — they are not in this
    // API's response at all. The station fills them from v4 or refuses. Assigning any of
    // them here is the fabrication this whole module exists to prevent.
  }
}

/** True when the profile reports no primary category — a measurement, flattened to ''. */
export function hasNoPrimaryCategory(draft: Partial<GbpProfileRecord>): boolean {
  return (draft.primaryCategory ?? '').trim().length === 0
}

function formatAddress(loc: GBPLocation): string | null {
  const addr = loc.address
  if (!addr) return null
  const line = [
    addr.addressLines.join(', '),
    addr.locality,
    addr.administrativeArea,
    addr.postalCode,
  ]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ')
  return line.length > 0 ? line : null
}

/**
 * Which record fields the draft does not carry.
 *
 * A runtime key check over the ledger's own field list rather than a type assertion, so
 * the single cast at the call site is guarded by evidence instead of by optimism. `null`
 * counts as present — a null phone is a measured absence and LOCAL-003 must see it, and a
 * null rating is "no reviews", which is equally a measurement. Only `undefined`, which
 * nothing writes deliberately, counts as missing.
 */
export function completeRecord(draft: Partial<GbpProfileRecord>): Array<keyof GbpProfileRecord> {
  return RECORD_FIELDS.filter((f) => draft[f] === undefined)
}

function describeRefusal(
  loc: GBPLocation,
  missing: Array<keyof GbpProfileRecord>,
  readFailures: GbpFieldReadFailure[],
): string {
  const resolved = RECORD_FIELDS.length - missing.length
  // Prefer the RUN's own failure over the ledger's description of the source. The ledger
  // says where photoCount comes from; the operator needs to know why it did not arrive
  // this time, and those are different sentences. The ledger note is the fallback for a
  // field with no recorded failure, which would itself be a bug worth seeing.
  const failureFor = new Map<keyof GbpProfileRecord, string>()
  for (const f of readFailures) for (const field of f.fields) failureFor.set(field, f.error)
  const detail = missing
    .map((f) => `${f} (${failureFor.get(f) ?? GBP_FIELD_SOURCES[f].note})`)
    .join('; ')
  const read = missing.filter((f) => GBP_FIELDS_READ_BY_CHECKS.includes(f))
  return (
    `${loc.name || 'the location'}${loc.title ? ` (${loc.title})` : ''}: ` +
    `${resolved} of ${RECORD_FIELDS.length} GbpProfileRecord fields resolved, but ${missing.length} could not be: ${detail}. ` +
    (read.length > 0
      ? `${read.join(', ')} ${read.length === 1 ? 'is' : 'are'} read by a registered check, and supplying a placeholder would make that check report a verdict about data nobody measured, so no profile record was emitted.`
      : 'No record was emitted: GbpProfileRecord has no shape for a field that was not read, and the only values available would be inventions.')
  )
}

export interface GbpNoteContext {
  /** summariseReviews().averageRatingSource — 'api' | 'derived' | 'none'. */
  ratingSource: 'api' | 'derived' | 'none'
  /** summariseReviews().totalReviewCountSource — 'api' | 'rows'. */
  reviewCountSource: 'api' | 'rows'
}

/**
 * What the station strip should say about a record it DID emit.
 *
 * Exported because until the ledger was corrected this function was unreachable — the
 * station refused on every input, so nothing here had ever executed and no test could
 * have caught a wrong sentence in it.
 */
export function stationNotes(
  draft: Partial<GbpProfileRecord>,
  ctx: GbpNoteContext,
): string[] {
  const notes: string[] = []

  if (GBP_UNOBTAINABLE_FIELDS.length > 0) {
    notes.push(
      `No authorised API supplies ${GBP_UNOBTAINABLE_FIELDS.join(', ')}, so nothing was evaluated against them.`,
    )
  }

  // The rubric row for LOCAL-003 lists services and attributes; the record models neither.
  // Saying so is the difference between "complete profile" and "complete on the seven
  // things we can see".
  notes.push(
    "GbpProfileRecord does not model the services or attributes LOCAL-003's rubric row also lists, so a clean GBP result is not a complete profile audit.",
  )

  if (GBP_ASSUMED_FIELDS.length > 0) {
    notes.push(
      `${GBP_ASSUMED_FIELDS.join(', ')} came from the My Business v4 API, which is enabled with granted quota but had never been called from this project before this run — treat the first live values as unconfirmed until one is checked against the profile by hand.`,
    )
  }

  if (ctx.reviewCountSource === 'rows') {
    notes.push(
      "The review count is the number of reviews read, not Google's own aggregate, which the response did not carry.",
    )
  }
  if (ctx.ratingSource === 'derived') {
    notes.push(
      "The rating is the mean of the star ratings read, not Google's own aggregate, which the response did not carry.",
    )
  }
  if (ctx.ratingSource === 'none') {
    notes.push('The profile carries no star rating, which is the expected state for a location with no reviews.')
  }

  if (hasNoPrimaryCategory(draft)) {
    notes.push(
      "The profile has no primary category set. GbpProfileRecord types primaryCategory as `string`, so that measurement is carried as '' — it is an observed absence, not an unread field.",
    )
  }

  if (!draft.businessCity) {
    notes.push(
      'The profile exposes no business address, so there is no anchor to test location-page geography against; LOCAL-016 reads not_run.',
    )
  } else if ((draft.serviceAreas ?? []).length === 0) {
    notes.push(
      'The profile declares no service areas — the Business Information API returns them only for a service-area business — so LOCAL-016 has nothing to test page geography against and reads not_run.',
    )
  }

  if (draft.isServiceAreaBusiness && draft.storefrontAddress === null) {
    notes.push(
      'This is a service-area business with a hidden storefront address, which is correct configuration and is not counted as incomplete.',
    )
  }

  return notes
}
