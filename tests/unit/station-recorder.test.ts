// What a station run is allowed to write to `tool_runs`.
//
// The load-bearing assertion is `client_id === null`, and the reason it is load-bearing
// is the other assertion in here: `output.data` deep-equals the station's payload. Put
// those two facts together with the tool_runs SELECT policy — which grants a row to any
// user holding `user_client_access` for its `client_id`, with no review predicate — and a
// real client id on a station run would publish the whole crawl to the client.
//
// So these tests drive the REAL startRun/finishRun through a fake ServiceClient rather
// than mocking them. `client_id: clientId ?? null` lives inside run-recorder; mocking it
// away would assert only that the recorder passes an argument it was told to pass.

import { describe, expect, it } from 'vitest'
import { createStationRecorder, NO_RECORDER } from '@/lib/orchestrator/recorder'
import { toolErr, toolOk, type ServiceClient, type ToolResult } from '@/lib/tools/contract'

interface Captured {
  inserts: Record<string, unknown>[]
  updates: Record<string, unknown>[]
  eqs: [string, unknown][]
  tables: string[]
}

/**
 * The narrowest fake that satisfies the two chains run-recorder actually builds:
 *   .from('tool_runs').insert(row).select('id').single()
 *   .from('tool_runs').update(row).eq('id', runId)
 * One cast at the boundary; everything above it is the production code path.
 */
function fakeService(opts: { insertError?: string } = {}): { service: ServiceClient } & Captured {
  const cap: Captured = { inserts: [], updates: [], eqs: [], tables: [] }
  const client = {
    from(table: string) {
      cap.tables.push(table)
      return {
        insert(row: Record<string, unknown>) {
          cap.inserts.push(row)
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: { message: opts.insertError } }
                  : { data: { id: 'run-1' }, error: null },
            }),
          }
        },
        update(row: Record<string, unknown>) {
          cap.updates.push(row)
          return {
            eq: async (col: string, val: unknown) => {
              cap.eqs.push([col, val])
              return { error: null }
            },
          }
        },
      }
    },
  }
  return { service: client as unknown as ServiceClient, ...cap }
}

const ORCHESTRATOR = { kind: 'orchestrator' as const, parentRunId: 'parent-9' }
const USER = { kind: 'user' as const, userId: 'user-7' }

/** Stands in for CrawlStationData: nested, so a shallow compare would miss a change. */
const STATION_DATA = {
  site: { origin: 'https://tornadohvacca.com', robotsTxt: 'User-agent: *' },
  pages: [{ url: 'https://tornadohvacca.com/', h1Count: 0 }],
  coverage: { urls: 206, unmeasured: { internalLinksOut: 206 } },
}

function ok(): ToolResult<typeof STATION_DATA> {
  return toolOk(STATION_DATA, { sources: ['crawl'], durationMs: 12 })
}

describe('a station run is unattributed in tool_runs', () => {
  it('writes client_id null even though the caller knows the client', async () => {
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record(
      'audit-crawl-station',
      { auditClientId: 'client-42' },
      async () => ok(),
    )
    expect(f.inserts[0].client_id).toBeNull()
  })

  it('writes client_id null for a user invoker too', async () => {
    // The one remaining shape someone might expect to be attributed. There is no
    // parameter for a client id at all, so there is no path by which one arrives —
    // this pins that the invoker kind is not a back door into it.
    const f = fakeService()
    await createStationRecorder(f.service, USER).record('audit-gsc-station', {}, async () => ok())
    expect(f.inserts[0].client_id).toBeNull()
  })

  it('writes user_id null for an orchestrator invoker, so no strategist pays for the run', async () => {
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record('audit-crawl-station', {}, async () =>
      ok(),
    )
    expect(f.inserts[0].user_id).toBeNull()
    expect(f.inserts[0].status).toBe('running')
  })

  it('stamps the orchestrator attribution into input._invocation', async () => {
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record('audit-crawl-station', {}, async () =>
      ok(),
    )
    const invocation = (f.inserts[0].input as { _invocation: Record<string, unknown> })._invocation
    expect(invocation.by).toBe('orchestrator')
    expect(invocation.parentRunId).toBe('parent-9')
  })

  it('carries the caller’s client attribution in the input payload instead', async () => {
    // `_invocation` has no client slot and startRun overwrites the key, so attribution
    // has to be a sibling field — and it must survive the merge.
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record(
      'audit-crawl-station',
      { auditClientId: 'client-42', files: 3 },
      async () => ok(),
    )
    const input = f.inserts[0].input as Record<string, unknown>
    expect(input.auditClientId).toBe('client-42')
    expect(input.files).toBe(3)
  })

  it('records to tool_runs and nowhere else', async () => {
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record('audit-crawl-station', {}, async () =>
      ok(),
    )
    expect(new Set(f.tables)).toEqual(new Set(['tool_runs']))
    expect(f.eqs).toEqual([['id', 'run-1']])
  })
})

describe('the recorded output is the whole payload', () => {
  it('deep-equals the station data, which is why client_id must be null', async () => {
    // If this ever stopped being true, the null client id would be over-caution. It is
    // true, so it is not: the entire crawl is in a column governed by a policy with no
    // review predicate.
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record('audit-crawl-station', {}, async () =>
      ok(),
    )
    const output = f.updates[0].output as { data: unknown; sources: unknown }
    expect(output.data).toEqual(STATION_DATA)
    expect(output.sources).toEqual(['crawl'])
  })
})

describe('the envelope decides the status', () => {
  it('records complete for a clean result', async () => {
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record('audit-crawl-station', {}, async () =>
      ok(),
    )
    expect(f.updates[0].status).toBe('complete')
    expect(f.updates[0].error).toBeNull()
  })

  it('records partial for a degraded result, never complete', async () => {
    const f = fakeService()
    await createStationRecorder(f.service, ORCHESTRATOR).record(
      'audit-crawl-station',
      {},
      async () =>
        toolOk(STATION_DATA, {
          sources: ['crawl'],
          degraded: true,
          notes: ['The mobile-friendly export is missing'],
        }),
    )
    expect(f.updates[0].status).toBe('partial')
    const output = f.updates[0].output as { degraded?: boolean; notes?: string[] }
    expect(output.degraded).toBe(true)
    expect(output.notes).toEqual(['The mobile-friendly export is missing'])
  })

  it('records failed for a ToolErr and keeps the error text', async () => {
    const f = fakeService()
    const { result } = await createStationRecorder(f.service, ORCHESTRATOR).record(
      'audit-crawl-station',
      {},
      async () => toolErr<typeof STATION_DATA>('tornado_internal.csv not found', { sources: ['crawl'] }),
    )
    expect(f.updates[0].status).toBe('failed')
    expect(f.updates[0].error).toBe('tornado_internal.csv not found')
    expect(result.ok).toBe(false)
    // Still client_id null on the failure path — the error text names the export file.
    expect(f.inserts[0].client_id).toBeNull()
  })
})

describe('recording never changes the run', () => {
  it('returns the body’s envelope unchanged', async () => {
    const f = fakeService()
    const envelope = ok()
    const { result, runId } = await createStationRecorder(f.service, ORCHESTRATOR).record(
      'audit-crawl-station',
      {},
      async () => envelope,
    )
    expect(result).toBe(envelope)
    expect(runId).toBe('run-1')
  })

  it('survives a failed insert: runId null, finish a no-op, envelope intact', async () => {
    // The whole reason startRun returns a nullable id. A Postgres hiccup must cost the
    // audit trail, not the audit.
    const f = fakeService({ insertError: 'permission denied for table tool_runs' })
    const envelope = ok()
    const { result, runId } = await createStationRecorder(f.service, ORCHESTRATOR).record(
      'audit-crawl-station',
      {},
      async () => envelope,
    )
    expect(runId).toBeNull()
    expect(f.updates).toHaveLength(0)
    expect(result).toBe(envelope)
    expect(result.ok && result.data).toEqual(STATION_DATA)
  })

  it('runs the body exactly once', async () => {
    const f = fakeService()
    let calls = 0
    await createStationRecorder(f.service, ORCHESTRATOR).record('audit-crawl-station', {}, async () => {
      calls += 1
      return ok()
    })
    expect(calls).toBe(1)
  })
})

describe('NO_RECORDER', () => {
  it('runs the body and touches no client', async () => {
    const envelope = ok()
    const { result, runId } = await NO_RECORDER.record('audit-crawl-station', {}, async () => envelope)
    expect(result).toBe(envelope)
    expect(runId).toBeNull()
  })

  it('passes a ToolErr through as-is', async () => {
    const err = toolErr<typeof STATION_DATA>('no export', { sources: ['crawl'] })
    const { result } = await NO_RECORDER.record('audit-crawl-station', {}, async () => err)
    expect(result).toBe(err)
  })
})
