// The callable-tool contract. Phase 2 of the automation roadmap.
//
// The problem this solves: all 16 tools already have their logic on the server,
// but none of them is composable. Every one begins with `requireAdmin()` — which
// a headless orchestrator cannot satisfy — and each returns a differently-shaped
// envelope (a survey found SIX distinct shapes across app/actions and
// app/api/tools, with eight different names for the payload key).
//
// So a tool becomes: a pure-ish function taking an explicit context and
// returning one envelope. Auth moves OUT of the tool and INTO the caller.
//
// The envelope is modelled on the two best precedents already in the codebase
// rather than invented:
//   - lib/connectors/types.ts ConnectorResult — the only type-SAFE envelope
//     here, because it's a discriminated union. The dominant `{data?, error?}`
//     shape lets you read `.data` without narrowing, which is how a failed call
//     gets treated as an empty one.
//   - app/actions/recommendations.ts RecsResult — the only envelope carrying
//     PROVENANCE, and the only one that returns a usable degraded result
//     alongside an error.
//
// Combining them matters for phase 4: a station needs to distinguish "ran and
// found nothing" from "could not run", and it needs to say where a number came
// from. That is the same not_run-vs-pass distinction the audit rubric depends on.

import type { OAuth2Client } from 'google-auth-library'
import type { createServiceClient } from '@/lib/supabase/server'
import type { getAdminOAuthClient } from '@/lib/google-auth'

export type GoogleAuth = Awaited<ReturnType<typeof getAdminOAuthClient>>
export type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>

/**
 * Everything a tool needs, injected.
 *
 * Deliberately the ask-lvl3 model (lib/ask-lvl3/tools/types.ts), where the
 * caller pre-resolves auth and the client row, rather than the server-action
 * model where each tool calls requireAdmin() and re-reads the client itself.
 * The injection model is the one an orchestrator can actually use.
 */
export interface ToolContext {
  /**
   * Resolved client row fields. Null for URL- and keyword-scoped tools.
   *
   * One shape for every tool, so a tool never re-reads the client itself. The
   * server actions each did their own `select`, with a different column list per
   * action — which is how `brand_match_mode` ended up read by one tool and not
   * the dashboard module it was meant to mirror.
   */
  client: {
    id: string
    name: string
    slug: string
    gsc_site_url: string | null
    ga4_property_id: string | null
    gbp_account_id: string | null
    website_url: string | null
    brand_terms: string[] | null
    /** 'exact' compares the whole query; anything else is a substring match. */
    brand_match_mode: string | null
    competitors: string[] | null
  } | null
  /** GA4 + GSC identity (analytics@). */
  auth: GoogleAuth
  /** GBP is a different identity (matt@); null when not connected. */
  gbpAuth: OAuth2Client | null
  service: ServiceClient
  /**
   * Who this run is attributed to. `orchestrator` runs are excluded from the
   * per-user rate limit, which counts tool_runs rows — see run-recorder.
   */
  invoker: { kind: 'user'; userId: string } | { kind: 'orchestrator'; parentRunId?: string }
  /** Progress callback. Ignored by callers that don't stream. */
  onProgress?: (message: string, pct?: number) => void
}

/**
 * Where a value came from. Carried through so a client-facing number can always
 * be explained, and so a degraded source is visible rather than silent.
 */
export type ToolSource =
  | 'gsc'
  | 'ga4'
  | 'gbp'
  | 'semrush'
  | 'psi'
  | 'crawl'
  | 'keywords-everywhere'
  | 'llm'
  | 'derived'
  | 'cache'

export interface ToolOk<T> {
  ok: true
  data: T
  /** Which sources actually contributed. */
  sources: ToolSource[]
  /**
   * True when the result is usable but incomplete — a source failed, a quota
   * was hit, a page wouldn't render. The caller MUST surface this; a degraded
   * result presented as complete is the failure the whole design guards against.
   *
   * REQUIRED, not optional, as of the eval-harness work: an optional flag lets a
   * connector that simply never sets it convert absence-of-data into apparent
   * completeness (`{ok:true, data:[]}` reading as a healthy empty result). Every
   * ToolOk now states its degradation status explicitly; `toolOk()` defaults it
   * to false so no call site changes.
   */
  degraded: boolean
  /** Why it's degraded, in words a client could read. */
  notes?: string[]
  durationMs: number
}

export interface ToolErr<T> {
  ok: false
  error: string
  /** Partial output where one exists — better than throwing it away. */
  partial?: T
  sources: ToolSource[]
  durationMs: number
}

export type ToolResult<T> = ToolOk<T> | ToolErr<T>

export function toolOk<T>(
  data: T,
  opts: { sources: ToolSource[]; degraded?: boolean; notes?: string[]; durationMs?: number },
): ToolOk<T> {
  return {
    ok: true,
    data,
    sources: opts.sources,
    degraded: opts.degraded ?? false,
    ...(opts.notes && opts.notes.length > 0 ? { notes: opts.notes } : {}),
    durationMs: opts.durationMs ?? 0,
  }
}

export function toolErr<T>(
  error: unknown,
  opts: { sources?: ToolSource[]; partial?: T; durationMs?: number } = {},
): ToolErr<T> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...(opts.partial !== undefined ? { partial: opts.partial } : {}),
    sources: opts.sources ?? [],
    durationMs: opts.durationMs ?? 0,
  }
}

/**
 * A callable tool.
 *
 * `run` never throws — a thrown error becomes a ToolErr, so an orchestrator
 * composing twelve of these cannot be taken down by one. Same invariant as
 * executeTool in lib/ask-lvl3/tools/index.ts, which the agentic loop relies on.
 */
export interface CallableTool<I, O> {
  slug: string
  /** What this tool needs resolved before it can run. */
  requires: {
    client?: boolean
    gsc?: boolean
    ga4?: boolean
    gbp?: boolean
  }
  run: (input: I, ctx: ToolContext) => Promise<ToolResult<O>>
}

/** Wrap a body so it always returns an envelope and always reports duration. */
export async function runGuarded<T>(
  sources: ToolSource[],
  body: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  const started = Date.now()
  try {
    const r = await body()
    return { ...r, durationMs: Date.now() - started }
  } catch (err) {
    return toolErr<T>(err, { sources, durationMs: Date.now() - started })
  }
}

/**
 * Bridge the connector envelope into the tool envelope.
 *
 * lib/connectors/* return `ConnectorResult<T>` = `{ok:true,data} | {ok:false,error}`.
 * Note lib/connectors/gbp.ts is the exception — it throws instead — which
 * runGuarded absorbs.
 */
export function fromConnector<T>(
  result: { ok: true; data: T } | { ok: false; error: string },
  sources: ToolSource[],
): ToolResult<T> {
  return result.ok ? toolOk(result.data, { sources }) : toolErr<T>(result.error, { sources })
}
