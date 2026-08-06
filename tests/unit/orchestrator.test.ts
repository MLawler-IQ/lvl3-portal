// The orchestrator.
//
// Everything here injects `deps`, so no test needs Supabase, a Google token, or the
// network. That is not only convenience: the sandbox this was built in has none of the
// three, and a run over a CSV directory genuinely does not need them, so "can this produce
// findings with no environment at all" is a property worth pinning rather than a
// workaround.
//
// The assertions that carry the most weight are the negative ones: a station failing must
// not abort the run, a skipped station must be ABSENT rather than an empty ok, `needsGbp`
// must be false at the call site, and no station run may carry a real client_id.

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
    expect(result.configVersion).toBe('scoring-2026-08-06.1')
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

describe('the GBP lockout', () => {
  it('calls buildToolContext with needsGbp false, literally', async () => {
    const buildContext = vi.fn<NonNullable<AuditRunDeps['buildContext']>>(async () => fakeContext())
    await runAudit(options({ clientId: 'client-1', record: false }, { buildContext }))
    expect(buildContext).toHaveBeenCalledTimes(1)
    // Asserted as a PRESENT LITERAL, not as a falsy default: `needsGbp` left off would
    // also read as false here, and deleting the line is exactly the regression this
    // guards — it would silently re-enable the GBP identity.
    const arg = buildContext.mock.calls[0][0]
    expect(Object.prototype.hasOwnProperty.call(arg, 'needsGbp')).toBe(true)
    expect(arg.needsGbp).toBe(false)
  })

  it('never puts a gbp slot in the bundle, and reports it as unavailable', async () => {
    const result = await runAudit(options())
    expect(result.stations.gbp).toBeUndefined()
    expect(result.stationStatus.gbp.state).toBe('unavailable')
    expect(result.stationStatus.gbp.reason).toMatch(/no GBP station exists/)
    // Both GBP-backed checks read not_run with a named reason, which is the correct
    // answer and needs no code beyond the engine.
    expect(findingFor(result.findings, 'LOCAL-003').status).toBe('not_run')
    expect(findingFor(result.findings, 'LOCAL-016').status).toBe('not_run')
  })

  it('leaves the run reportable as complete despite gbp being permanently unavailable', async () => {
    // If `unavailable` counted against the run, `complete` would be unreachable forever.
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
    expect(result.stationStatus.gbp.state).toBe('unavailable')
    expect(result.status).toBe('complete')
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

/** Everything about a result that is allowed to differ between two identical runs. */
function strip(result: Awaited<ReturnType<typeof runAudit>>) {
  return JSON.parse(
    JSON.stringify(result, (key, value) => (key === 'durationMs' ? 0 : value)),
  )
}
