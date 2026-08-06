// Station-run recording, with `client_id: null` made structural.
//
// Why this module exists at all, rather than the orchestrator calling
// startRun/finishRun directly:
//
// `finishRun` writes the WHOLE result into `tool_runs.output` — `output.data` is
// `result.data` verbatim, so a crawl station records the entire 206-page
// `CrawlStationData` and the GSC station records every raw row it fetched.
//
// Now read the SELECT policy that governs that column
// (20260610000001_fix_tool_runs_rls.sql). A non-admin may read a `tool_runs` row when:
//
//   1. `tool_runs.client_id is null and tool_runs.user_id = auth.uid()`, or
//   2. they are a `client`-role user whose `users.client_id = tool_runs.client_id`, or
//   3. a `user_client_access` row pairs their uid with `tool_runs.client_id`.
//
// Branch 3 is the leak: ANY user with access to the client — which is what client
// assignment means — reads the row. There is no published, approved or reviewed
// predicate anywhere in that policy, because `tool_runs` was never meant to hold
// anything that needed one. So recording a station run against a real `client_id`
// publishes the raw audit substrate to client-readable storage the instant it is
// written, months before slice 7's review gate exists. Slice 4's RLS isolation on
// `audit_runs` / `audit_findings` would then be cosmetic: the same numbers are
// readable one table over.
//
// With `client_id` null AND `user_id` null every branch is false, for reasons worth
// spelling out because two of them are SQL null semantics rather than logic:
//   - Branch 1's first half is TRUE, but `user_id = auth.uid()` is `null = <uuid>`,
//     which is NULL, not true — and `null AND true` is NULL, which RLS treats as a
//     non-match. This is the branch someone will assume saves them; it does not.
//   - Branches 2 and 3 compare `u.client_id`/`uca.client_id` to NULL, which is NULL
//     for every candidate row, so both EXISTS subqueries are empty.
// Only the separate "Admins can view all tool runs" policy still matches. That is
// the intended reader.
//
// Hence the signature: `createStationRecorder` takes NO clientId parameter. The
// safety property is then a fact about the type, not a rule a future caller has to
// remember — there is no argument through which a real client id could arrive, so
// the leak cannot be reintroduced by a well-meaning `clientId: opts.clientId` at a
// call site far from this comment.
//
// Client attribution instead rides in the `input` payload the caller passes (e.g.
// `input.auditClientId`), which lands in `tool_runs.input` alongside `_invocation`.
// NOTE: AUTOMATION-PLAN.md line ~144 says to keep attribution "in
// `input._invocation`". That is not what `run-recorder.ts` writes — `_invocation`
// for an orchestrator invoker is exactly `{ by, parentRunId }` and has no client
// slot, and startRun overwrites the key. A caller-supplied `_invocation` would be
// silently discarded, so the id must be a sibling field.

import { finishRun, startRun } from '@/lib/tools/run-recorder'
import type { ServiceClient, ToolContext, ToolResult } from '@/lib/tools/contract'
import type { StationRecorder } from '@/lib/orchestrator/types'

export function createStationRecorder(
  service: ServiceClient,
  invoker: ToolContext['invoker'],
): StationRecorder {
  return {
    async record<T>(
      slug: string,
      input: Record<string, unknown>,
      body: () => Promise<ToolResult<T>>,
    ): Promise<{ result: ToolResult<T>; runId: string | null }> {
      const handle = await startRun({
        service,
        toolSlug: slug,
        clientId: null,
        input,
        invoker,
      })

      const result = await body()

      // Both halves degrade internally: a null runId makes finishRun a no-op, and
      // both swallow their own errors. So this returns the body's envelope
      // UNCHANGED and unconditionally — recording is observation, and observation
      // that can fail a run or rewrite its result is worse than no recording.
      await finishRun(handle, result)

      return { result, runId: handle.runId }
    },
  }
}

/**
 * The identity recorder: runs the body, records nothing, reports no run id.
 *
 * Lets the orchestrator treat "not recording" as a recorder rather than as a null
 * check at every call site — which is what keeps the dry-run script and every unit
 * test free of Supabase entirely, instead of reaching for a mock.
 */
export const NO_RECORDER: StationRecorder = {
  async record<T>(
    _slug: string,
    _input: Record<string, unknown>,
    body: () => Promise<ToolResult<T>>,
  ): Promise<{ result: ToolResult<T>; runId: string | null }> {
    return { result: await body(), runId: null }
  },
}
