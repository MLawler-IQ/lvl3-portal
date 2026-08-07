// Run an audit over a Sitebulb export the browser already uploaded to storage.
//
// ── HOW THE BYTES GOT OUT OF THE REQUEST ────────────────────────────────────────────────
//
// This endpoint has now refused the export's bytes twice, for two different reasons, and
// both are worth keeping because both will be re-proposed by anyone who looks only at the
// current shape.
//
// 1. IT WAS A SERVER ACTION, AND A TYPED ARRAY DID NOT SURVIVE THE BOUNDARY. Next 14.2's
//    Flight reply encoder asks a value for its iterator BEFORE it asks whether the value is
//    a plain object, and `Uint8Array` has `Symbol.iterator`, so the encoder quietly emits
//    `Array.from(value)`. The server then received `number[]` while the type still said
//    `Uint8Array`, and `readText` (lib/ingest/sitebulb/source.ts) does
//    `new TextDecoder('utf-8').decode(bytes)`, which throws ERR_INVALID_ARG_TYPE on a plain
//    array. `runGuarded` turned that into a crawl-station failure, so every run reported a
//    failed crawl and every crawl-backed check reported `not_run` — a FABRICATED ABSENCE,
//    the same defect as a fabricated pass, pointed the other way. Reproduce the decode with:
//      node -e "new TextDecoder('utf-8').decode(Array.from(new Uint8Array([104,105])))"
//    The action body cap (1 MB, and the numeric-array encoding inflated payloads roughly
//    fourfold) was the second half of that failure.
//
// 2. IT WAS A MULTIPART POST TO THIS ROUTE, AND VERCEL REFUSED THE BODY. That fixed the
//    encoding — a `File` part's `arrayBuffer()` hands back real bytes in this same process —
//    and inherited a ceiling no config can raise: a Serverless Function rejects any request
//    body over 4.5 MB with FUNCTION_PAYLOAD_TOO_LARGE BEFORE the handler is invoked. A real
//    Sitebulb export is tens of megabytes. The screen worked on a toy export and refused a
//    real one, and the refusal arrived as an HTML 413 from the edge that reads, to an
//    operator, as "the audit failed".
//
// SO THE BYTES ARE NOT IN THE REQUEST AT ALL. components/audit/AuditRunner.tsx asks
// app/actions/audit-upload.ts for signed upload URLs, PUTs each file straight to the
// `audit-exports` bucket, and then POSTs `{ clientId, runToken }` here — two uuids. This
// handler rebuilds the storage prefix from them (it does not accept a prefix; see below)
// and reads the export back out through lib/audit/storage-source.ts.
//
// ── WHAT THIS ROUTE IS NOT ──────────────────────────────────────────────────────────────
//
// Not a second implementation of the run. app/actions/audit.ts still owns the backbone
// check, the client read, the attribution verdict, the row insert and the context-library
// write, and every one of those rules has a test aimed at it. This file is TRANSPORT:
// two ids in, `{ name, bytes }[]` out of storage, `runClientAudit` called.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logging'
import { runClientAudit } from '@/app/actions/audit'
import { describeMissingBackbone } from '@/lib/audit/store'
import {
  AUDIT_EXPORT_BUCKET,
  StoragePrefixSource,
  exportPrefix,
  isUuid,
} from '@/lib/audit/storage-source'

/**
 * Five minutes, the Vercel maximum on this plan — the same budget the page declares.
 *
 * One run downloads every file in the export, parses every CSV, and then fetches 90 days of
 * GSC. The default 10s budget kills that mid-crawl, and a killed run is indistinguishable at
 * the browser from a run that found nothing.
 */
export const maxDuration = 300

/**
 * THE CEILING, NOW THAT IT IS NOT THE REQUEST BODY.
 *
 * There is no 4.5 MB limit on this path any more, because no export byte is in this
 * request. What bounds it now, in the order it will actually bite:
 *
 *  1. THIS FUNCTION'S MEMORY. `runClientAudit` takes `{ name, bytes }[]` and builds a
 *     `BufferSource`, so the whole export is resident while it is parsed — as it was
 *     before. That is hundreds of megabytes of headroom rather than four, which is the
 *     improvement, but it is not unbounded.
 *  2. THE 300s BUDGET, which now also has to cover downloading the export from storage.
 *  3. 100 MB PER FILE, the `audit-exports` bucket limit
 *     (supabase/migrations/20260807060000_audit_exports_bucket.sql). Only the backbone
 *     `*_internal.csv` of a very large crawl approaches it. NOTE that a Supabase project
 *     also has its own global upload limit which a bucket limit cannot exceed — if an
 *     upload fails at a smaller size than the bucket allows, that is the project setting:
 *     Supabase dashboard → Storage → Settings → "Upload file size limit".
 *
 * The honest statement for the screen is therefore no longer a number of megabytes; it is
 * "the run is the limit, not the upload". AuditRunner says exactly that.
 *
 * A STREAMING SOURCE WOULD REMOVE (1) ENTIRELY, and lib/audit/storage-source.ts is already
 * the right shape for it — `read(name)` fetches one object at a time. What stands in the
 * way is that `runClientAudit` takes bytes rather than a `CrawlExportSource`. That is a one
 * field change in app/actions/audit.ts, owned elsewhere; until then this handler
 * materialises what the action's signature asks for.
 */

/**
 * THE EXPORT IS NOT DELETED AFTER THE RUN. Deliberately, and the reasoning is written out
 * in full in the bucket migration; the short version is that a stored audit run is a
 * DERIVED fact (docs/CONTEXT-LIBRARY.md §5) and a derived fact whose source was deleted is
 * a claim about an artifact nobody can look at again. The rubric behind these findings is
 * known-incomplete and changes slice by slice, so the value of a kept export is that a
 * better rubric can be re-run over the same crawl. `tool_runs` is not a substitute — it
 * holds what the CURRENT ingester chose to parse, and it is on a 365-day purge set for a
 * different purpose. Deleting here would also be inverted: the run whose bytes anyone wants
 * to re-read is the one that failed, and a delete-after-success rule keeps exactly the
 * exports nobody needs.
 *
 * The accepted cost is a bucket that only grows, and orphaned objects from uploads that
 * failed halfway. Expiry, when it is justified, is its own migration made with the deletion
 * in view — and it has to decide what happens to the `audit_runs` rows whose source it
 * removes.
 */

interface RunRequestBody {
  clientId?: unknown
  runToken?: unknown
}

export async function POST(req: NextRequest) {
  // ── auth, by hand ────────────────────────────────────────────────────────────
  // NOT `requireAdmin()`. That helper answers a failure with `redirect()` from
  // next/navigation; inside a Route Handler that becomes a 307 to /login, so the caller's
  // `fetch` follows it and receives an HTML login page where it expected JSON. The
  // operator sees a JSON parse error instead of "you are not signed in". Same manual shape
  // as app/api/ask-lvl3/route.ts.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Your session has expired. Reload the page and sign in again — nothing was run.' },
      { status: 401 },
    )
  }

  const service = await createServiceClient()
  const { data: profile } = await service.from('users').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Running an audit is admin-only.' }, { status: 403 })
  }

  let body: RunRequestBody
  try {
    body = (await req.json()) as RunRequestBody
  } catch (err) {
    return NextResponse.json(
      {
        error: `The run request could not be read as JSON: ${
          err instanceof Error ? err.message : String(err)
        }. Nothing was run.`,
      },
      { status: 400 },
    )
  }

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
  const runToken = typeof body.runToken === 'string' ? body.runToken.trim() : ''

  if (!clientId) {
    return NextResponse.json({ error: 'Pick a client first.' }, { status: 400 })
  }
  if (!runToken) {
    return NextResponse.json(
      { error: 'This run request carries no upload id, so there is nothing to read. Reload the page and pick the export again.' },
      { status: 400 },
    )
  }

  // THE PREFIX IS BUILT HERE, NOT SENT. The request carries two uuids and this handler
  // derives the object-key prefix from them exactly as app/actions/audit-upload.ts did when
  // it minted the signatures. Accepting a prefix string instead would let a caller read any
  // object in the bucket — every client's crawl data — by naming its path, and a `..`
  // segment would reach further than that. The uuid shape check is what makes the
  // concatenation safe; it is not cosmetic validation.
  if (!isUuid(clientId) || !isUuid(runToken)) {
    return NextResponse.json(
      { error: 'That run request is malformed. Reload the page and pick the export again — nothing was run.' },
      { status: 400 },
    )
  }

  const prefix = exportPrefix(clientId, runToken)
  const source = StoragePrefixSource(service.storage.from(AUDIT_EXPORT_BUCKET), prefix)

  let names: string[]
  try {
    names = await source.list()
  } catch (err) {
    // A listing that could not be completed is a BROKEN SOURCE, never an empty export —
    // storage-source throws rather than returning a partial page for exactly this reason.
    logError('audit.route', 'Could not list the uploaded export', {
      clientId,
      prefix,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      {
        error:
          `The uploaded export could not be listed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Nothing was run — this is a storage failure, not a problem with the export.`,
      },
      { status: 502 },
    )
  }

  if (names.length === 0) {
    return NextResponse.json(
      {
        error:
          'Nothing arrived in storage for this upload, so there is no export to audit. Nothing was run — ' +
          'reload the page and pick the export folder again.',
      },
      { status: 400 },
    )
  }

  // Checked BEFORE anything is downloaded. `runClientAudit` applies the same rule and is
  // the authority on it, but it can only apply it after the bytes are in hand, and pulling
  // tens of megabytes out of storage to then refuse the upload wastes most of the 300s
  // budget on an answer the file list already gave.
  const missing = describeMissingBackbone(names)
  if (missing !== null) {
    return NextResponse.json({ error: missing }, { status: 400 })
  }

  const files: { name: string; bytes: Uint8Array }[] = []
  try {
    for (const name of names) {
      // `read` returns a genuine Uint8Array in this process — the thing `readText`'s
      // TextDecoder accepts. Nothing serialises in between, which is the property the
      // Server Action could not offer.
      //
      // The name goes through VERBATIM. `buildExportFiles` in lib/audit/store.ts already
      // forward-slashes it and strips a leading `./`, and normalising here as well would be
      // a second place for that rule to live and drift from the ingester's.
      files.push({ name, bytes: await source.read(name) })
    }
  } catch (err) {
    logError('audit.route', 'Could not read the uploaded export', {
      clientId,
      prefix,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      {
        error:
          `An uploaded file could not be read back: ${err instanceof Error ? err.message : String(err)}. ` +
          `Nothing was run. A run over the rest of the export would be missing reports without saying so.`,
      },
      { status: 502 },
    )
  }

  try {
    // `requireAdmin()` inside the action re-checks the same session and passes, having
    // been satisfied above; it can only redirect for a session this handler already
    // refused. The action's return value is the response body unchanged, so the client
    // reads exactly the shape it read when this was a direct action call.
    // The prefix is recorded, not just used: the retention decision keeps the
    // export precisely so a stored run can point at what it read, and a run with
    // nowhere to point makes that a claim rather than a link.
    const result = await runClientAudit({ clientId, files, sourcePrefix: prefix })

    // The BODY is the contract — the client keys off `result.error`. The status code is a
    // coarse hint on top of it: the action returns prose for both "your upload is wrong"
    // and "the run happened but could not be stored", and telling those apart here would
    // mean string-matching its messages.
    return NextResponse.json(result, { status: result.error ? 400 : 200 })
  } catch (err) {
    logError('audit.route', 'Audit run route failed', {
      clientId,
      prefix,
      fileCount: files.length,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'The audit could not be run.' },
      { status: 500 },
    )
  }
}
