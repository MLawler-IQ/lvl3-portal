// The orchestrator.
//
// Everything here injects `deps`, so no test needs Supabase, a Google token, or the
// network. That is not only convenience: the sandbox this was built in has none of the
// three, and a run over a CSV directory genuinely does not need them, so "can this produce
// findings with no environment at all" is a property worth pinning rather than a
// workaround.
//
// The assertions that carry the most weight are the negative ones: a station failing must
// not abort the run, a skipped station must be ABSENT rather than an empty ok, an offline
// run must never reach for the GBP identity, and no station run may carry a real client_id.

import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { runAudit } from '@/lib/orchestrator/run'
import type { AuditRunDeps, AuditRunOptions, StationRecorder } from '@/lib/orchestrator/types'
import { NO_RECORDER } from '@/lib/orchestrator/recorder'
import { BufferSource, LocalDirSource } from '@/lib/ingest/sitebulb/source'
import { CHECKS } from '@/lib/findings/checks'
import type { CheckDefinition, Finding } from '@/lib/findings/types'
import { toolErr, toolOk, type ToolContext } from '@/lib/tools/contract'
import type { GSCRow } from '@/lib/tools-gsc'
import type { RobotsStationData } from '@/lib/stations/robots'
import type { GbpProfileRecord } from '@/lib/tools/crawl-record'

const MINI = join(__dirname, '..', '..', 'fixtures', 'ingest', 'sitebulb-mini')

/** A frozen clock: two runs must be comparable byte for byte. */
const FIXED_NOW = () => 1_754_400_000_000

/**
 * A GSC property, for the tests that want the station to actually run.
 *
 * Needed explicitly because there is no client row here: with no property from either the
 * options or the client, the station is `unconfigured` and the injected `runGsc` is never
 * called — which is correct, and is its own test below.
 */
const GSC_PROPERTY = 'sc-domain:example-plumbing.com'

const noRobots = () =>
  Promise.resolve(
    toolOk<RobotsStationData>(
      {
        robotsTxt: null,
        robotsTxtStatus: 'not-fetched',
        llmsTxt: null,
        llmsTxtStatus: 'not-fetched',
        httpStatus: null,
      },
      { sources: ['crawl'] },
    ),
  )

/** The base invocation: real crawl station over the committed fixture, nothing else live. */
function options(over: Partial<AuditRunOptions> = {}, deps: AuditRunDeps = {}): AuditRunOptions {
  return {
    crawl: LocalDirSource(MINI),
    record: false,
    robots: false,
    skip: ['gsc'],
    ...over,
    deps: { now: FIXED_NOW, recorder: null, ...deps, ...(over.deps ?? {}) },
  }
}

const statusOf = (findings: Finding[]) =>
  Object.fromEntries(findings.map((f) => [f.checkId, f.status]))

const findingFor = (findings: Finding[], id: string): Finding =>
  findings.find((f) => f.checkId === id)!

describe('the golden run over the committed fixture', () => {
  it('produces the pinned status for all eight checks', async () => {
    const result = await runAudit(options())
    // Pinned as an explicit id→status map rather than a snapshot file: a change should
    // show up as a diff on a NAMED check, not as a blob nobody reads.
    expect(statusOf(result.findings)).toEqual({
      'TECH-001': 'not_run',
      'ONPAGE-003': 'fail',
      'TECH-011': 'fail',
      'MEAS-001': 'not_run',
      'ONPAGE-006': 'not_run',
      'LOCAL-016': 'not_run',
      'LOCAL-003': 'not_run',
      'ONPAGE-012': 'not_run',
    })
  })

  it('scores only the failures and says why each of the rest was not scored', async () => {
    const result = await runAudit(options())
    expect(result.scoring.items).toHaveLength(2)
    expect(result.scoring.unscored).toHaveLength(6)
    // A literal, not SCORING_CONFIG.version — reading the value back from the module it
    // came from asserts nothing. Bumped by hand on 2026-08-07 with the rubric re-cut, which
    // changed ONPAGE-003's severity and therefore its score, and the version string now
    // covers rubric-sourced severity for exactly that reason.
    expect(result.configVersion).toBe('scoring-2026-08-07.1')
    for (const item of result.scoring.items) {
      expect(item.inputs.formula.length).toBeGreaterThan(0)
    }
  })

  it('carries the crawl coverage through structurally, not only as notes', async () => {
    // Slice 4 persists this to audit_runs.coverage and the dry-run prints it; a
    // string[] of notes cannot carry it.
    const result = await runAudit(options())
    expect(result.coverage?.urls).toBe(6)
    expect(result.coverage?.filesMissing).toEqual([])
    expect(result.coverage?.unmeasured.internalLinksOut).toBe(6)
  })
})

describe('a station failing never aborts the run', () => {
  it('keeps the crawl findings when GSC returns a ToolErr', async () => {
    const result = await runAudit(
      options({ skip: [], gscSiteUrl: GSC_PROPERTY }, {
        runGsc: () => Promise.resolve(toolErr<GSCRow[]>('quota exceeded')),
      }),
    )
    expect(result.findings).toHaveLength(8)
    expect(result.stationStatus.gsc.state).toBe('failed')
    expect(findingFor(result.findings, 'ONPAGE-006').status).toBe('not_run')
    expect(findingFor(result.findings, 'ONPAGE-006').reason).toMatch(/gsc station failed/)
    // The crawl-backed findings are untouched.
    expect(findingFor(result.findings, 'ONPAGE-003').status).toBe('fail')
    expect(result.status).toBe('partial')
  })

  it('resolves rather than rejecting when a station throws outright', async () => {
    const result = await runAudit(
      options({}, {
        runCrawl: () => {
          throw new Error('disk went away')
        },
      }),
    )
    expect(result.stationStatus.crawl.state).toBe('failed')
    expect(result.stationStatus.crawl.reason).toMatch(/disk went away/)
    // No crawl means no knowledge at all, so every registered check is not_run.
    expect(new Set(result.findings.map((f) => f.status))).toEqual(new Set(['not_run']))
    expect(result.status).toBe('failed')
    expect(result.notes.join(' ')).toMatch(/threw rather than returning an error envelope/)
  })

  it('records a degraded crawl as degraded rather than as failed', async () => {
    // A degraded station still produced usable data; conflating it with failure would
    // throw away six checks' worth of real findings.
    const files = new Map<string, Uint8Array>()
    const dir = LocalDirSource(MINI)
    for (const name of await dir.list()) files.set(name, await dir.read(name))
    files.delete('mini_mobile_friendly.csv')

    const result = await runAudit(options({ crawl: BufferSource(files, 'mini minus mobile') }))
    expect(result.stationStatus.crawl.state).toBe('degraded')
    expect(result.stationStatus.crawl.notes.join(' ')).toMatch(/mobile-friendly/)
    expect(result.coverage?.filesMissing).toEqual(['mobile_friendly'])
    expect(findingFor(result.findings, 'TECH-011').status).not.toBe('pass')
    expect(result.status).toBe('partial')
  })
})

describe('a skipped station is absent, not empty', () => {
  it('omits the slot entirely so the engine says "not provided"', async () => {
    const result = await runAudit(options({ skip: ['gsc'] }))
    expect(result.stations.gsc).toBeUndefined()
    expect(result.stationStatus.gsc.state).toBe('skipped')
    // "not provided" and "returned no data" are different sentences. An empty ToolOk
    // would produce the second, which claims we looked.
    expect(findingFor(result.findings, 'ONPAGE-006').reason).toMatch(/not provided/)
    expect(findingFor(result.findings, 'ONPAGE-006').reason).not.toMatch(/returned no data/)
  })

  it('distinguishes unconfigured from skipped', async () => {
    const result = await runAudit(options({ skip: [], gscSiteUrl: null }))
    expect(result.stationStatus.gsc.state).toBe('unconfigured')
    expect(result.stationStatus.gsc.reason).toMatch(/no GSC property is configured/)
  })

  it('leaves robots not-fetched when skipped, so TECH-001 reads not_run', async () => {
    const result = await runAudit(options({ robots: false }))
    expect(result.stationStatus.robots.state).toBe('skipped')
    expect(findingFor(result.findings, 'TECH-001').status).toBe('not_run')
  })
})

describe('the GBP station', () => {
  it('runs the injected station and puts its record in the bundle', async () => {
    // The lockout this replaces pinned the slot to `unavailable` and passed
    // `needsGbp: false`, so LOCAL-003 and LOCAL-016 could only ever read not_run.
    const runGbp = vi.fn<NonNullable<AuditRunDeps['runGbp']>>(async () =>
      toolOk(gbpRecord(), { sources: ['gbp'], degraded: true }),
    )
    const result = await runAudit(
      options({ clientId: 'client-1', record: false }, { buildContext: async () => gbpContext(), runGbp }),
    )

    expect(runGbp).toHaveBeenCalledTimes(1)
    // The account and the location group both come off the client row, and the group is
    // the whole reason the lockout existed: decideGBPScope refuses a null one by design,
    // so a run that could not carry it could only ever produce a new flavour of not_run.
    expect(runGbp.mock.calls[0][0]).toEqual({
      accountName: 'accounts/123',
      locationGroup: '*',
      auth: GBP_AUTH,
    })
    expect(result.stations.gbp?.ok).toBe(true)
    // Never `ok`: lib/stations/gbp.ts caps a successful run at degraded because
    // GbpProfileRecord does not model the services and attributes LOCAL-003 also covers.
    expect(result.stationStatus.gbp.state).toBe('degraded')
    // The point of the whole exercise — a check that ran instead of reporting not_run.
    expect(findingFor(result.findings, 'LOCAL-003').status).toBe('degraded')
  })

  it('asks for the GBP identity only when the station is going to run', async () => {
    // Business Profile is a separate Google account from GA4/GSC, so `needsGbp` is an
    // extra admin-token read. Asserted as a PRESENT LITERAL in both directions: left off,
    // the flag would read as false and a skipped run would look correct by accident.
    const buildContext = vi.fn<NonNullable<AuditRunDeps['buildContext']>>(async () => fakeContext())
    await runAudit(options({ clientId: 'client-1', record: false }, { buildContext }))
    const wanted = buildContext.mock.calls[0][0]
    expect(Object.prototype.hasOwnProperty.call(wanted, 'needsGbp')).toBe(true)
    expect(wanted.needsGbp).toBe(true)

    const skipped = vi.fn<NonNullable<AuditRunDeps['buildContext']>>(async () => fakeContext())
    await runAudit(
      options({ clientId: 'client-1', record: false, skip: ['gsc', 'gbp'] }, {
        buildContext: skipped,
      }),
    )
    expect(skipped.mock.calls[0][0].needsGbp).toBe(false)
  })

  it('is unconfigured, not failed, for a client with no gbp_account_id', async () => {
    // Exactly what the GSC station gets for a missing gsc_site_url. A `failed` here would
    // render "nobody filled this in" as "we read Google and it broke", and a pass would be
    // the fabrication the station exists to prevent.
    const runGbp = vi.fn<NonNullable<AuditRunDeps['runGbp']>>(async () =>
      toolOk(gbpRecord(), { sources: ['gbp'], degraded: true }),
    )
    const result = await runAudit(
      options({ clientId: 'client-1', record: false }, {
        buildContext: async () => gbpContext({ gbp_account_id: null }),
        runGbp,
      }),
    )
    expect(result.stationStatus.gbp.state).toBe('unconfigured')
    expect(result.stationStatus.gbp.reason).toMatch(/no Business Profile account is configured/)
    expect(runGbp).not.toHaveBeenCalled()
    expect(result.stations.gbp).toBeUndefined()
    expect(findingFor(result.findings, 'LOCAL-003').status).toBe('not_run')
    expect(findingFor(result.findings, 'LOCAL-016').status).toBe('not_run')
  })

  it('is unconfigured, not failed, when the Business Profile identity is not connected', async () => {
    const runGbp = vi.fn<NonNullable<AuditRunDeps['runGbp']>>(async () =>
      toolOk(gbpRecord(), { sources: ['gbp'], degraded: true }),
    )
    const result = await runAudit(
      options({ clientId: 'client-1', record: false }, {
        buildContext: async () => ({ ...gbpContext(), gbpAuth: null }),
        runGbp,
      }),
    )
    expect(result.stationStatus.gbp.state).toBe('unconfigured')
    expect(result.stationStatus.gbp.reason).toMatch(/identity is not connected/)
    expect(runGbp).not.toHaveBeenCalled()
  })

  it('keeps every other station intact when the GBP station returns a ToolErr', async () => {
    const result = await runAudit(
      options({ clientId: 'client-1', record: false, skip: [], gscSiteUrl: GSC_PROPERTY }, {
        buildContext: async () => gbpContext(),
        runGsc: () => Promise.resolve(toolOk<GSCRow[]>([gscRow()], { sources: ['gsc'] })),
        runGbp: async () =>
          toolErr<GbpProfileRecord>(
            'could not read media for accounts/123/locations/456: HTTP 403',
            { sources: ['gbp'] },
          ),
      }),
    )
    expect(result.stationStatus.gbp.state).toBe('failed')
    // A GBP failure is one station's failure and nothing else's.
    expect(result.status).not.toBe('failed')
    expect(result.stationStatus.crawl.state).toBe('ok')
    expect(result.stationStatus.gsc.state).toBe('ok')
    expect(findingFor(result.findings, 'ONPAGE-003').status).toBe('fail')
    expect(findingFor(result.findings, 'ONPAGE-006').status).not.toBe('not_run')
    // The failure reaches both GBP checks as not_run carrying the reader's own sentence —
    // never as a record with an invented photo count.
    for (const id of ['LOCAL-003', 'LOCAL-016']) {
      expect(findingFor(result.findings, id).status).toBe('not_run')
      expect(findingFor(result.findings, id).reason).toMatch(/gbp station failed/)
      expect(findingFor(result.findings, id).reason).toMatch(/HTTP 403/)
      expect(findingFor(result.findings, id).evidence.affectedUrls).toBeUndefined()
    }
  })

  it('resolves rather than rejecting when the GBP station throws outright', async () => {
    const result = await runAudit(
      options({ clientId: 'client-1', record: false }, {
        buildContext: async () => gbpContext(),
        runGbp: () => {
          throw new Error('the Business Profile token expired mid-run')
        },
      }),
    )
    expect(result.stationStatus.gbp.state).toBe('failed')
    expect(result.stationStatus.gbp.reason).toMatch(/token expired mid-run/)
    expect(result.findings).toHaveLength(8)
    expect(findingFor(result.findings, 'ONPAGE-003').status).toBe('fail')
  })

  it('never lets gbp cost the run its `complete` status', async () => {
    // The station caps itself at `degraded` on every successful run, so counting it would
    // make `complete` unreachable for every client that has GBP configured — and a status
    // nothing can attain reports nothing. What gbp did is on the station strip instead.
    const result = await runAudit(
      options({ skip: [], gscSiteUrl: GSC_PROPERTY, robots: true }, {
        runGsc: () => Promise.resolve(toolOk<GSCRow[]>([gscRow()], { sources: ['gsc'] })),
        runRobots: () =>
          Promise.resolve(
            toolOk<RobotsStationData>(
              {
                robotsTxt: 'User-agent: *\nDisallow: /wp-admin/\n',
                robotsTxtStatus: 'ok',
                llmsTxt: null,
                llmsTxtStatus: 'not-found',
                httpStatus: 200,
              },
              { sources: ['crawl'] },
            ),
          ),
      }),
    )
    expect(result.stationStatus.gbp.state).toBe('unconfigured')
    expect(result.status).toBe('complete')
  })

  it('the offline path never constructs a GBP dependency', async () => {
    // scripts/audit-dry-run.ts --offline is the only way a human runs an audit today, and
    // it has no Supabase, no Google token and no network. Nothing on that path may reach
    // for the Business Profile identity — not the context build, not the station.
    const buildContext = vi.fn<NonNullable<AuditRunDeps['buildContext']>>(async () => fakeContext())
    const runGbp = vi.fn<NonNullable<AuditRunDeps['runGbp']>>(async () =>
      toolOk(gbpRecord(), { sources: ['gbp'], degraded: true }),
    )
    const result = await runAudit(
      options({ record: false, clientId: null, robots: false }, { buildContext, runGbp }),
    )
    expect(buildContext).not.toHaveBeenCalled()
    expect(runGbp).not.toHaveBeenCalled()
    expect(result.stationStatus.gbp.state).toBe('unconfigured')
    expect(result.stations.gbp).toBeUndefined()
  })

  it('reports a skipped gbp station as skipped, not as unconfigured', async () => {
    const runGbp = vi.fn<NonNullable<AuditRunDeps['runGbp']>>(async () =>
      toolOk(gbpRecord(), { sources: ['gbp'], degraded: true }),
    )
    const result = await runAudit(
      options({ clientId: 'client-1', record: false, skip: ['gsc', 'gbp'] }, {
        buildContext: async () => gbpContext(),
        runGbp,
      }),
    )
    expect(result.stationStatus.gbp.state).toBe('skipped')
    expect(result.stationStatus.gbp.reason).toMatch(/the caller skipped the GBP station/)
    expect(runGbp).not.toHaveBeenCalled()
  })
})

describe('running with no environment at all', () => {
  it('still produces findings when buildToolContext throws', async () => {
    // The sandbox reality, and the common failure in production too: buildToolContext
    // resolves getAdminOAuthClient unguarded, so an expired admin token throws out of it.
    const result = await runAudit(
      options({ clientId: 'client-1', record: true }, {
        buildContext: () => {
          throw new Error('admin_google_token row is missing')
        },
        recorder: undefined,
      }),
    )
    expect(result.findings).toHaveLength(8)
    expect(result.recording.attempted).toBe(false)
    expect(result.recording.skippedReason).toMatch(/no client context/)
    expect(result.notes.join(' ')).toMatch(/admin_google_token/)
    expect(result.status).toBe('partial')
  })

  it('does not even try to build a context when there is nothing to build it for', async () => {
    const buildContext = vi.fn<NonNullable<AuditRunDeps['buildContext']>>(async () => fakeContext())
    await runAudit(options({ record: false, clientId: null }, { buildContext }))
    expect(buildContext).not.toHaveBeenCalled()
  })
})

describe('recording', () => {
  it('passes clientId null and the client attribution in the input payload', async () => {
    const calls: { slug: string; input: Record<string, unknown> }[] = []
    const spy: StationRecorder = {
      async record(slug, input, body) {
        calls.push({ slug, input })
        // Keyed on the slug, not on arrival order: the stations are concurrent, so a
        // counter would hand a different id to the same station run to run.
        return { result: await body(), runId: `run-for-${slug}` }
      },
    }
    const result = await runAudit(
      options({ clientId: 'client-1', skip: [], gscSiteUrl: GSC_PROPERTY, robots: false }, {
        recorder: spy,
        runGsc: () => Promise.resolve(toolOk<GSCRow[]>([gscRow()], { sources: ['gsc'] })),
      }),
    )
    // As a set, not a sequence: crawl and GSC run concurrently, so the order they reach
    // the recorder is not part of the contract and asserting it would make this flaky.
    expect(calls.map((c) => c.slug).sort()).toEqual(['audit.crawl', 'audit.gsc'])
    for (const call of calls) {
      // The client id is attribution, never the row's RLS key — the recorder hardcodes
      // client_id: null and this is where the id actually travels.
      expect(call.input.auditClientId).toBe('client-1')
    }
    expect(result.recording.recorded.slice().sort()).toEqual(['audit.crawl', 'audit.gsc'])
    expect(result.stationStatus.crawl.runId).toBe('run-for-audit.crawl')
    expect(result.stationStatus.gsc.runId).toBe('run-for-audit.gsc')
  })

  it('returns the station envelope unchanged through the recorder', async () => {
    const result = await runAudit(options({}, { recorder: NO_RECORDER }))
    expect(result.stationStatus.crawl.state).toBe('ok')
    expect(result.stationStatus.crawl.runId).toBeNull()
    expect(result.findings).toHaveLength(8)
  })

  it('says why it skipped recording rather than leaving it ambiguous', async () => {
    const result = await runAudit(options({ record: false }, { recorder: null }))
    expect(result.recording.attempted).toBe(false)
    expect(result.recording.skippedReason).toMatch(/disabled by the caller/)
  })
})

describe('scoring failures are contained', () => {
  it('keeps the findings when a check has no rubric row', async () => {
    // rubricEntry throws for an unregistered id. That is a real defect, but losing all
    // the findings to it would hide the defect behind an empty screen.
    const bogus: CheckDefinition = {
      id: 'FAKE-999',
      requires: ['crawl'],
      evaluate: () => ({
        checkId: 'FAKE-999',
        status: 'fail',
        evidence: { detail: 'invented', affectedUrls: 1 },
        source: 'crawl',
      }),
    }
    const result = await runAudit(options({}, { checks: [...CHECKS, bogus] }))
    expect(result.findings).toHaveLength(9)
    expect(findingFor(result.findings, 'FAKE-999').status).toBe('fail')
    expect(result.scoring.items).toEqual([])
    expect(result.configVersion).toBe('unavailable')
    expect(result.notes.join(' ')).toMatch(/Scoring failed/)
    expect(result.notes.join(' ')).toMatch(/FAKE-999/)
    expect(result.status).toBe('partial')
  })
})

describe('determinism', () => {
  it('produces an identical result for the same source and a fixed clock', async () => {
    // Prefigures slice 4's gate that two runs of one fixture bundle persist identical
    // score_inputs.terms.
    const files = new Map<string, Uint8Array>()
    const dir = LocalDirSource(MINI)
    for (const name of await dir.list()) files.set(name, await dir.read(name))

    const run = () => runAudit(options({ crawl: BufferSource(files, 'fixed') }))
    const a = await run()
    const b = await run()
    expect(strip(a)).toEqual(strip(b))
  })
})

describe('the requires guard', () => {
  it('does not read a tool’s requires, or the callable registry, anywhere', async () => {
    // A source-text guard, because this is a rule about what the module must NOT consult
    // and there is no runtime observation that proves absence. `requires` disagreeing
    // with `dataSources` on ai-visibility is the live precedent.
    const src = await readFile(join(__dirname, '..', '..', 'lib', 'orchestrator', 'run.ts'), 'utf8')
    const code = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/\brequires\b/)
    expect(code).not.toMatch(/CALLABLE_TOOLS/)
    expect(code).not.toMatch(/missingRequirement/)
  })
})

// ── helpers ─────────────────────────────────────────────────────────────────────

function gscRow(over: Partial<GSCRow> = {}): GSCRow {
  return {
    query: 'ac repair glendale',
    page: 'https://example.com/',
    clicks: 10,
    impressions: 400,
    ctr: 2.5,
    position: 8.2,
    ...over,
  }
}

/** Enough of a ToolContext to satisfy the orchestrator without a database. */
function fakeContext(): ToolContext {
  return {
    client: null,
    auth: {} as ToolContext['auth'],
    gbpAuth: null,
    service: {} as ToolContext['service'],
    invoker: { kind: 'orchestrator' },
  }
}

/** A stand-in identity: the orchestrator only ever passes it through to the station. */
const GBP_AUTH = {} as NonNullable<ToolContext['gbpAuth']>

/**
 * A context whose client row carries what the GBP station needs.
 *
 * `gbp_location_group` is cast in because ToolContext['client'] does not declare it —
 * lib/tools/context.ts now SELECTS the column, so the value is there at runtime and only
 * the interface is behind. lib/orchestrator/run.ts reads it through the same narrow cast,
 * which is the seam this pins: drop the column from CLIENT_COLUMNS and the station starts
 * refusing every client for an unconfigured scope.
 */
function gbpContext(over: Record<string, unknown> = {}): ToolContext {
  return {
    ...fakeContext(),
    client: {
      id: 'client-1',
      name: 'Tornado HVAC',
      slug: 'tornado',
      gsc_site_url: null,
      ga4_property_id: null,
      gbp_account_id: 'accounts/123',
      gbp_location_group: '*',
      website_url: null,
      brand_terms: null,
      brand_match_mode: null,
      competitors: null,
      ...over,
    } as unknown as ToolContext['client'],
    gbpAuth: GBP_AUTH,
  }
}

/** Every field present and plausible — nothing here is a placeholder. */
function gbpRecord(over: Partial<GbpProfileRecord> = {}): GbpProfileRecord {
  return {
    name: 'Tornado HVAC',
    primaryCategory: 'HVAC contractor',
    isServiceAreaBusiness: false,
    storefrontAddress: '15115 Califa St, Sherman Oaks, CA, 91411',
    businessCity: 'Sherman Oaks, CA',
    serviceAreas: [],
    hoursComplete: true,
    phone: '+1-818-555-0100',
    websiteUri: 'https://tornadohvacca.com',
    description: 'Heating, cooling and duct cleaning across the San Fernando Valley.',
    photoCount: 22,
    rating: 4.8,
    reviewCount: 129,
    ...over,
  }
}

/** Everything about a result that is allowed to differ between two identical runs. */
function strip(result: Awaited<ReturnType<typeof runAudit>>) {
  return JSON.parse(
    JSON.stringify(result, (key, value) => (key === 'durationMs' ? 0 : value)),
  )
}
