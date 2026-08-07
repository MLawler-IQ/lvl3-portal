'use server'

// Mint signed upload URLs for one Sitebulb export, so the browser can put the bytes into
// storage directly and the run request can carry only ids.
//
// THIS ACTION IS SAFE TO BE AN ACTION, and the reason is worth stating next to the file
// that says the opposite about the run. app/api/audit/run/route.ts is a Route Handler
// because a `Uint8Array` does not survive Next 14's Flight reply encoder — it has
// `Symbol.iterator`, so the encoder emits `Array.from(value)` and the server receives
// `number[]` while the type still says otherwise — and because the action body cap is 1 MB.
// Neither applies here: strings in, strings out, and the largest payload is a list of
// filenames. The bytes never touch an action boundary at all, which is the whole point.
//
// THE PATH IS SERVER-CHOSEN. The caller sends export-relative NAMES; it does not send, and
// cannot influence, where they land. The prefix is `${clientId}/${runToken}` with both
// halves validated uuids and the run token minted here, and each signature is scoped to one
// exact key. A caller-supplied object key would be a write-anywhere primitive against a
// bucket that holds every client's crawl data — "overwrite another client's export" and
// "overwrite an object some other feature depends on" are the same bug.
//
// ALL OR NOTHING. One unusable name refuses the whole batch. A partial batch would upload
// cleanly, run cleanly, and produce an audit missing reports nobody was told about — every
// check backed by a dropped report reporting `not_run`, which is indistinguishable from an
// export that genuinely lacked them.

import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logging'
import {
  AUDIT_EXPORT_BUCKET,
  describeUnsafeExportName,
  exportPrefix,
  isUuid,
} from '@/lib/audit/storage-source'

/**
 * The most files one export may upload.
 *
 * A Sitebulb export is dozens of files; 500 is far past that and exists so a mis-picked
 * home directory refuses immediately rather than minting thousands of signatures. It is
 * below `MAX_ENTRIES` in storage-source, so a batch that passes here can always be listed.
 */
const MAX_FILES = 500

export interface AuditUploadTarget {
  /** The export-relative name, echoed verbatim so the caller can pair it with its File. */
  path: string
  /** The full object key this signature is scoped to. Returned for the receipt, not to be edited. */
  objectKey: string
  /** PUT the file's bytes here. Carries its own token; no session header is needed. */
  signedUrl: string
}

export interface AuditUploadUrlsResult {
  error?: string
  /**
   * The run's id in the bucket. Sent back to /api/audit/run, which rebuilds the same prefix
   * from it — the browser never names the prefix, it only carries this token between two
   * server calls that both derive the path themselves.
   */
  runToken?: string
  uploads?: AuditUploadTarget[]
}

/**
 * Signed upload URLs for one export, under a fresh per-run prefix.
 *
 * Every returned signature expires on Supabase's own schedule (two hours, fixed by the
 * storage API rather than settable here), which is longer than any upload this screen can
 * start and shorter than a session left open overnight.
 */
export async function createAuditUploadUrls(input: {
  clientId: string
  /** Export-relative, forward-slashed, `hints/` prefix intact — the ingester's convention. */
  paths: string[]
}): Promise<AuditUploadUrlsResult> {
  try {
    await requireAdmin()

    const clientId = input.clientId?.trim() ?? ''
    if (!clientId) return { error: 'Pick a client first.' }
    if (!isUuid(clientId)) {
      // Shape-checked before it is concatenated into an object key. The row check below
      // makes it a real client; this makes it a safe path segment either way.
      return { error: 'That client id is not a uuid, so no upload path can be built from it. Reload the page.' }
    }

    const paths = input.paths ?? []
    if (paths.length === 0) {
      return { error: 'Nothing was selected to upload.' }
    }
    if (paths.length > MAX_FILES) {
      return {
        error:
          `This selection is ${paths.length} files and the limit is ${MAX_FILES}. A Sitebulb export is ` +
          `dozens of files, so a selection this large is almost certainly a folder a level or two too ` +
          `high. Nothing was uploaded.`,
      }
    }

    // Refused BEFORE anything is minted, so a bad name costs a round trip rather than a
    // half-populated prefix in the bucket.
    const seen = new Set<string>()
    for (const raw of paths) {
      const unsafe = describeUnsafeExportName(raw)
      if (unsafe !== null) return { error: `${unsafe} Nothing was uploaded.` }
      if (seen.has(raw)) {
        // Two entries with one name would race for one key, and with upsert off the loser
        // fails mid-upload with a storage 409 that says nothing about which file it was.
        return {
          error:
            `The selection has more than one entry named ${JSON.stringify(raw)}, so they would be ` +
            `stored under one name and the audit would read whichever landed last. Nothing was ` +
            `uploaded — pick a single export folder.`,
        }
      }
      seen.add(raw)
    }

    const service = await createServiceClient()

    // A real client row, not just a well-shaped uuid. Minting a prefix under an id no
    // client owns writes orphaned objects into a bucket with no deletion path.
    const { data: client, error: clientErr } = await service
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()

    if (clientErr) return { error: `Could not read the client: ${clientErr.message}` }
    if (!client) return { error: 'Client not found.' }

    const runToken = crypto.randomUUID()
    const prefix = exportPrefix(clientId, runToken)
    const bucket = service.storage.from(AUDIT_EXPORT_BUCKET)

    const uploads: AuditUploadTarget[] = []
    for (const path of paths) {
      const objectKey = `${prefix}/${path}`
      // upsert is left OFF. The token itself encodes that, so the browser cannot turn it
      // on with a header. Each run gets a fresh prefix, so a collision here is not a retry
      // — it is two writes racing for one key, and failing loudly beats an export whose
      // contents changed after the run read them.
      const { data, error } = await bucket.createSignedUploadUrl(objectKey)

      if (error || !data) {
        logError('audit.upload', 'Could not create a signed upload URL', {
          clientId,
          objectKey,
          error: error?.message,
        })
        return {
          error:
            `Could not prepare the upload for ${JSON.stringify(path)}: ${error?.message ?? 'no URL returned'}. ` +
            `Nothing was uploaded.`,
        }
      }

      uploads.push({ path, objectKey, signedUrl: data.signedUrl })
    }

    return { runToken, uploads }
  } catch (err) {
    logError('audit.upload', 'Could not prepare an export upload', {
      clientId: input.clientId,
      fileCount: input.paths?.length ?? 0,
      error: err instanceof Error ? err.message : String(err),
    })
    return { error: err instanceof Error ? err.message : 'The upload could not be prepared.' }
  }
}
