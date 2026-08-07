// A CrawlExportSource backed by a prefix in the `audit-exports` storage bucket.
//
// WHY STORAGE AT ALL. The export used to ride in the request body — first through a Server
// Action (where a Uint8Array was silently re-encoded as number[]), then as multipart to a
// Route Handler (which fixed the encoding and inherited Vercel's 4.5 MB body cap, refused
// at the edge before any handler runs). The bytes now go browser → storage directly, and
// the run request carries only ids. app/api/audit/run/route.ts has the full history.
//
// NO 'use server'. This is lib/, so it is importable from a Route Handler, a Server Action
// and a unit test alike, and none of its exports cross a client boundary.
//
// THE TWO RULES OF CrawlExportSource STILL HOLD HERE, and they are the reason this file is
// not three lines:
//
// 1. `list()` IS THE SOLE AUTHORITY ON ABSENCE, so a listing that could not be completed
//    must THROW rather than return what it managed to read. Supabase's `list` pages at 100
//    entries by default; a silently truncated page would drop real reports out of the
//    export, and every check backed by a dropped report reports `not_run`. That is a
//    FABRICATED ABSENCE — the same defect as a fabricated pass, pointed the other way — and
//    it is indistinguishable, downstream, from an operator who genuinely did not export
//    those reports.
// 2. `read()` NEVER REPORTS ABSENCE — it throws. A station turns that into a ToolErr, which
//    is "broken source", as against the "missing signal" a name absent from `list()`
//    produces. Collapsing them lets a half-uploaded export masquerade as an incomplete one.
//
// ONE LEVEL DEEP, MATCHING LocalDirSource. A Sitebulb export is flat plus a `hints/`
// folder. `LocalDirSource` recurses exactly one level for that reason and this does too —
// which is also why `describeUnsafeExportName` below REFUSES an upload nested deeper than
// that. An object written three levels down would be stored, never listed, and therefore
// never read: bytes the operator watched upload that the audit cannot see.

import type { CrawlExportSource } from '@/lib/ingest/sitebulb/source'

/**
 * The bucket, named once.
 *
 * Exported from here rather than from app/actions/audit-upload.ts because a `'use server'`
 * module may only export async functions — a constant there is a build error. The migration
 * that creates it is supabase/migrations/20260807060000_audit_exports_bucket.sql.
 */
export const AUDIT_EXPORT_BUCKET = 'audit-exports'

/**
 * The narrowest slice of `supabase.storage.from(bucket)` this file uses.
 *
 * A structural interface rather than the concrete `StorageFileApi` for one reason that
 * matters: it lets a unit test drive the real listing and traversal logic against a stub
 * with no network, which is the only way the pagination and absence rules above are
 * testable at all. The real client satisfies it structurally — no cast at the call site.
 */
export interface ExportStorageBucket {
  list(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ data: ExportStorageEntry[] | null; error: { message: string } | null }>
  download(
    path: string,
  ): Promise<{ data: Blob | null; error: { message: string } | null }>
}

/**
 * One row of a storage listing.
 *
 * `id` is the folder discriminator: Supabase's v1 list returns a placeholder row per
 * subdirectory with a null id and null metadata, alongside real objects. Typed
 * `string | null | undefined` because the SDK's own `FileObject` types it `string` and is
 * wrong about the folder rows.
 */
export interface ExportStorageEntry {
  name: string
  id?: string | null
}

/** Page size for `list`. The SDK default is 100, which a large export exceeds. */
const LIST_PAGE = 100

/**
 * The most entries this will enumerate under one prefix before giving up.
 *
 * A Sitebulb export is dozens of files. 2000 is far past any real export and exists only so
 * a pathological prefix cannot spin a 5-minute function budget away in `list` calls. Hitting
 * it THROWS — see rule 1 above; returning the first 2000 would be a fabricated absence.
 */
const MAX_ENTRIES = 2000

/**
 * The object-key prefix for one upload of one export.
 *
 * SERVER-CHOSEN, ALWAYS. Both halves are validated uuids at every site that builds a
 * prefix, so no caller-supplied string reaches the key. That is not decoration: an object
 * key is concatenated, and a `..` segment in a client-supplied prefix would be a
 * write-anywhere primitive against a bucket holding every client's crawl data.
 *
 * `clientId` first so the bucket is browsable per client, and so a future retention job can
 * express "everything for this client" as a prefix rather than a query.
 */
export function exportPrefix(clientId: string, runToken: string): string {
  return `${clientId}/${runToken}`
}

/** Both halves of a prefix are uuids, and this is the only definition of that. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * The export-relative names this will carry, matched per segment.
 *
 * Deliberately narrow. Sitebulb names every report `<host>_<report>.csv` with the host's
 * dots replaced by underscores, plus the `.xlsx` summary workbook, so the real character
 * set is `[a-z0-9_.-]` and a space at most. Anything outside this is REFUSED rather than
 * rewritten: rewriting would store the file under a name the operator never picked, and the
 * receipt of what was uploaded would then be a record of something else. app/api/audit/run
 * makes the same argument about not trusting a multipart `filename`.
 */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._][A-Za-z0-9._ -]*$/

/** Two: the export root and `hints/`. See the one-level-deep rule in the header. */
const MAX_DEPTH = 2

/** Longest object key suffix accepted, well past any Sitebulb name. */
const MAX_NAME_LENGTH = 255

/**
 * Why this export-relative name cannot be stored, or null when it can be.
 *
 * Returns PROSE rather than a boolean because the caller shows it to an operator, and
 * "invalid filename" sends someone back to Sitebulb with nothing to change.
 *
 * This is the traversal guard for the storage side. `lib/ingest/sitebulb/source.ts` holds
 * the equivalent for the filesystem side as a module-private `assertSafeName`, and the
 * duplication is deliberate and bounded rather than an import: that one guards a
 * `path.join`, this one guards a key concatenation AND the depth limit that keeps every
 * uploaded object reachable from `list()`, which is a storage-only rule. If the two ever
 * need to agree on more than they do today, the shared half belongs in source.ts as an
 * export — that is an integration change, not a copy.
 */
export function describeUnsafeExportName(name: string): string | null {
  if (name.length === 0) return 'An entry arrived with an empty path, so it cannot be stored under any name.'
  if (name.length > MAX_NAME_LENGTH) {
    return `The path ${JSON.stringify(name.slice(0, 60))}… is ${name.length} characters, and the limit is ${MAX_NAME_LENGTH}.`
  }
  if (name.startsWith('/')) {
    return `The path ${JSON.stringify(name)} is absolute. Export entries are relative to the export folder.`
  }
  if (name.includes('\\')) {
    return `The path ${JSON.stringify(name)} contains a backslash. Export entry names are forward-slashed on every platform.`
  }

  const segments = name.split('/')
  if (segments.length > MAX_DEPTH) {
    return (
      `The path ${JSON.stringify(name)} is ${segments.length} levels deep, and an export is read ` +
      `one level deep — the flat reports plus hints/. A file nested deeper would upload and then ` +
      `never be listed, so the audit would silently run without it.`
    )
  }
  for (const segment of segments) {
    if (segment.length === 0) {
      return `The path ${JSON.stringify(name)} has an empty path segment, so the name it would be stored under is ambiguous.`
    }
    if (segment === '.' || segment === '..') {
      return `The path ${JSON.stringify(name)} contains a ${JSON.stringify(segment)} segment. Relative traversal is refused.`
    }
    if (!SAFE_SEGMENT_RE.test(segment)) {
      return (
        `The path ${JSON.stringify(name)} contains characters this upload will not store. ` +
        `Sitebulb names reports with letters, digits, dots, underscores and hyphens; a name ` +
        `outside that is more likely a file that does not belong to the export.`
      )
    }
  }
  return null
}

/**
 * An export held under one prefix of one storage bucket.
 *
 * `label` follows the convention the interface documents: a stable human string an error
 * message can name, so an operator told "this export has no *_internal.csv" knows which
 * export. It defaults to the prefix, which is the client id and the run id — the two things
 * that identify the upload in the bucket.
 */
export function StoragePrefixSource(
  bucket: ExportStorageBucket,
  prefix: string,
  label = `audit-exports/${prefix}`,
): CrawlExportSource {
  // Memoized for the same reason LocalDirSource memoizes: both ingesters call list(), and
  // two sweeps of the same prefix can legitimately disagree — an upload still settling, a
  // paginated read interleaved with a write — which would put the manifest ingest and the
  // crawl ingest at odds about which files exist. Here it also saves N round trips.
  let cached: Promise<string[]> | null = null

  async function page(path: string): Promise<ExportStorageEntry[]> {
    const out: ExportStorageEntry[] = []
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await bucket.list(path, { limit: LIST_PAGE, offset })
      if (error) {
        throw new Error(`Could not list ${label} (${path}): ${error.message}`)
      }
      // A null data with a null error is not "empty" — it is a response this code does not
      // understand, and treating it as an empty export is the fabricated absence again.
      if (data === null) {
        throw new Error(`Listing ${label} (${path}) returned neither entries nor an error.`)
      }
      out.push(...data)
      if (data.length < LIST_PAGE) return out
      if (out.length >= MAX_ENTRIES) {
        throw new Error(
          `${label} holds more than ${MAX_ENTRIES} entries under ${path}, which is far past any ` +
            `Sitebulb export. Refusing to read a partial listing — a truncated file list would ` +
            `make real reports look absent.`,
        )
      }
    }
  }

  return {
    label,
    list() {
      cached ??= (async () => {
        const out: string[] = []
        for (const entry of await page(prefix)) {
          // Supabase reports a subdirectory as a placeholder row with a null id. Real
          // objects always carry one, so this is the discriminator — not a name heuristic.
          if (entry.id === null || entry.id === undefined) {
            for (const nested of await page(`${prefix}/${entry.name}`)) {
              // A folder inside a folder is skipped rather than descended: the upload path
              // refuses anything deeper than one level, so a third level here means
              // something wrote to this prefix that this pipeline did not.
              if (nested.id === null || nested.id === undefined) continue
              out.push(`${entry.name}/${nested.name}`)
            }
          } else {
            out.push(entry.name)
          }
        }
        return out
      })()
      return cached
    },
    async read(name) {
      const unsafe = describeUnsafeExportName(name)
      if (unsafe !== null) {
        throw new Error(`Refusing to read unsafe export entry name ${JSON.stringify(name)} from ${label}: ${unsafe}`)
      }

      const { data, error } = await bucket.download(`${prefix}/${name}`)
      if (error) {
        // NOT an absence. list() is the authority on that, so a name that got here came out
        // of a listing and failing to fetch it means the source is broken.
        throw new Error(`Could not read ${JSON.stringify(name)} from ${label}: ${error.message}`)
      }
      if (data === null) {
        throw new Error(`Reading ${JSON.stringify(name)} from ${label} returned neither bytes nor an error.`)
      }

      // A zero-byte object comes back here as an empty Uint8Array and is NOT an error — the
      // two are distinguishable, which matters because they mean opposite things: an empty
      // CSV parses as a report that found nothing, while a failed read means we do not know
      // what the report said. The picker drops zero-byte files before upload for exactly
      // that reason, so reaching this with an empty object means the object was written
      // empty, which is worth letting the ingester see rather than hiding as a throw.
      return new Uint8Array(await data.arrayBuffer())
    },
  }
}
