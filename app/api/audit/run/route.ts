// Upload a Sitebulb export and run an audit over it. The only path in the app that can
// carry the export's bytes.
//
// WHY THIS IS NOT A SERVER ACTION. It was one, and the export never arrived intact. Two
// independent reasons, and neither of them raised anything:
//
// 1. A TYPED ARRAY DOES NOT SURVIVE THE ACTION BOUNDARY. Next 14.2's Flight reply encoder
//    asks a value for its iterator BEFORE it asks whether the value is a plain object, and
//    `Uint8Array` has `Symbol.iterator`, so the encoder quietly emits `Array.from(value)`.
//    The server then receives `number[]` while the type still says `Uint8Array`, and
//    `readText` (lib/ingest/sitebulb/source.ts) does
//    `new TextDecoder('utf-8').decode(bytes)`, which throws ERR_INVALID_ARG_TYPE on a
//    plain array. `runGuarded` converts that into a crawl-station failure, so every run
//    reported a failed crawl and every crawl-backed check reported `not_run`. That is a
//    fabricated ABSENCE — the same defect as a fabricated pass, pointed the other way.
//    Reproduce the decode with:
//      node -e "new TextDecoder('utf-8').decode(Array.from(new Uint8Array([104,105])))"
// 2. THE 1 MB ACTION BODY CAP. next.config.js sets no
//    `experimental.serverActions.bodySizeLimit`, so the 1 MB default applies, and the
//    numeric-array encoding above inflates the payload roughly fourfold — a real ceiling
//    around 250 KB for an artifact measured in megabytes.
//
// `multipart/form-data` has neither problem. The body is not Flight-encoded at all, and a
// `File` part's `arrayBuffer()` hands back the uploaded bytes in this same process, so the
// `Uint8Array` built from it is a genuine typed array all the way into the ingester.
//
// WHAT THIS ROUTE IS NOT. It is not a second implementation of the run. app/actions/audit.ts
// still owns the backbone check, the client read, the attribution verdict, the row insert
// and the context-library write, and every one of those rules has a test aimed at it. This
// file is TRANSPORT: multipart body in, `{ name, bytes }[]` out, `runClientAudit` called.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logging'
import { runClientAudit } from '@/app/actions/audit'

/**
 * Five minutes, the Vercel maximum on this plan — the same budget the page declares.
 *
 * One run parses every CSV in the export and then fetches 90 days of GSC. The default 10s
 * budget kills that mid-crawl, and a killed run is indistinguishable at the browser from a
 * run that found nothing.
 */
export const maxDuration = 300

/**
 * The practical ceiling on an upload, and it is the PLATFORM's number, not a policy of
 * ours.
 *
 * A Vercel Serverless Function refuses a request body over 4.5 MB with
 * FUNCTION_PAYLOAD_TOO_LARGE before the handler is ever invoked, and no config raises it.
 * So the honest ceiling for this screen is a ~4 MB export — well above the ~250 KB the
 * Server Action could carry, and well below the tens of megabytes a large Sitebulb crawl
 * produces. 4 MB rather than 4.5 leaves room for multipart framing (a boundary, a
 * Content-Disposition header and the `paths` fields ride along in the same body).
 *
 * An export over this limit is not currently runnable from the portal at all; it has to go
 * through `scripts/audit-dry-run.ts` until the bytes get a transport that is not the
 * request body — a signed direct upload to storage with this route fetching from there.
 * Saying so is the point: refusing with that sentence beats a 413 from the edge that the
 * operator reads as "the audit failed".
 *
 * Local dev enforces no such cap, so an export that runs on a laptop can be refused in
 * production. That asymmetry is exactly why the limit is enforced here as well as in the
 * picker — the number has to be the same in both places or dev stops predicting prod.
 * components/audit/AuditRunner.tsx mirrors it, and this file is the authority.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

function tooLarge(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1)
  const capMb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)
  return (
    `This export is ${mb} MB and the upload ceiling is ${capMb} MB. That limit is Vercel's ` +
    `request-body cap, not a setting — a larger body is rejected at the edge before the ` +
    `audit is reached. Nothing was run. Either re-export with fewer reports enabled, or ` +
    `run it locally with scripts/audit-dry-run.ts, which reads the folder off disk and has ` +
    `no size limit.`
  )
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

  // Checked from the header BEFORE `formData()`, which buffers the whole body: an
  // oversized upload should be refused with the message above rather than after several
  // megabytes have been read into a function's memory. `content-length` is advisory, so
  // the real byte count is re-totalled below as the enforcing check.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: tooLarge(declared) }, { status: 413 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch (err) {
    return NextResponse.json(
      {
        error: `The upload could not be read as multipart/form-data: ${
          err instanceof Error ? err.message : String(err)
        }. Nothing was run.`,
      },
      { status: 400 },
    )
  }

  const rawClientId = form.get('clientId')
  const clientId = typeof rawClientId === 'string' ? rawClientId.trim() : ''
  if (!clientId) {
    return NextResponse.json({ error: 'Pick a client first.' }, { status: 400 })
  }

  // ── paths travel in their own field, paired by position ──────────────────────
  // The name the ingester matches on is a source-relative path — `hints/foo_x.csv` — and
  // the obvious place for it is the part's `filename` parameter. It does not go there:
  // what survives quoting and re-encoding of a filename containing `/` is up to the
  // browser and the multipart parser, and a name silently rewritten in transit does NOT
  // fail here. crawl.ts matches by suffix, so a mangled directory prefix still ingests and
  // only the stored record of what was uploaded is wrong — a quiet corruption of the audit
  // trail. A parallel `paths` field is a plain string field we control end to end.
  //
  // `FormData` preserves append order per key on both sides, so index i of `paths` names
  // index i of `files`. A length mismatch is REFUSED rather than zipped to the shorter of
  // the two: a single missing entry would misname every file after it, and the run that
  // came out of that would look entirely plausible.
  const paths = form.getAll('paths')
  const parts = form.getAll('files')

  if (paths.length !== parts.length) {
    return NextResponse.json(
      {
        error:
          `The upload carried ${parts.length} file(s) but ${paths.length} path(s), so no file ` +
          `can be named with confidence. Nothing was run — reload the page and pick the export again.`,
      },
      { status: 400 },
    )
  }

  const files: { name: string; bytes: Uint8Array }[] = []
  let total = 0

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (typeof part === 'string') {
      return NextResponse.json(
        { error: `Upload entry ${i + 1} arrived as a text field rather than a file. Nothing was run.` },
        { status: 400 },
      )
    }

    const name = typeof paths[i] === 'string' ? (paths[i] as string).trim() : ''
    if (!name) {
      return NextResponse.json(
        { error: `Upload entry ${i + 1} arrived with no path, so it cannot be matched to a report. Nothing was run.` },
        { status: 400 },
      )
    }

    total += part.size
    if (total > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: tooLarge(total) }, { status: 413 })
    }

    // THE LINE THE SERVER ACTION COULD NOT HAVE. `part` is a File in this process, so its
    // ArrayBuffer holds the uploaded bytes and this is a real typed array — the thing
    // `readText`'s TextDecoder accepts. Nothing serialises in between.
    //
    // The name goes through VERBATIM. `buildExportFiles` in lib/audit/store.ts already
    // forward-slashes it and strips a leading `./`, and normalising here as well would be
    // a second place for that rule to live and drift from the ingester's.
    files.push({ name, bytes: new Uint8Array(await part.arrayBuffer()) })
  }

  try {
    // `requireAdmin()` inside the action re-checks the same session and passes, having
    // been satisfied above; it can only redirect for a session this handler already
    // refused. The action's return value is the response body unchanged, so the client
    // reads exactly the shape it read when this was a direct action call.
    const result = await runClientAudit({ clientId, files })

    // The BODY is the contract — the client keys off `result.error`. The status code is a
    // coarse hint on top of it: the action returns prose for both "your upload is wrong"
    // and "the run happened but could not be stored", and telling those apart here would
    // mean string-matching its messages.
    return NextResponse.json(result, { status: result.error ? 400 : 200 })
  } catch (err) {
    logError('audit.route', 'Audit upload route failed', {
      clientId,
      fileCount: files.length,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'The audit could not be run.' },
      { status: 500 },
    )
  }
}
