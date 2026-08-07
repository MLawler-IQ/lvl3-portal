'use client'

// Pick a Sitebulb export and run an audit against it.
//
// WHY A DIRECTORY AND NOT A ZIP. A Sitebulb export is a folder of CSVs with a `hints/`
// subfolder inside it. There is no zip step in the operator's workflow, and adding one
// would mean a zip library. So the picker is `webkitdirectory` (with a flat multi-file
// input as the fallback for browsers that ignore it) and the bytes go up as-is.
//
// THE INGESTER MATCHES BY SUFFIX, NOT BY PATH. This comment and two strings on the screen
// used to claim the opposite — that hint files are found through their `hints/` prefix and
// that a flat selection therefore cannot carry them. That is false.
// lib/ingest/sitebulb/crawl.ts:90 and :262 both locate a report with
// `files.find((f) => f.endsWith(`_${suffix}.csv`))`, and crawl.ts:82 says outright that
// `endsWith` tolerates the `hints/` prefix. A flat pick of the same files ingests
// identically. Telling an operator that MEAS-001's tag detection "will be unmeasured" when
// it was in fact measured is a FABRICATED ABSENCE — the same defect as a fabricated pass,
// pointed the other way — so the hint warning below counts the two files the ingester
// actually looks for, by the suffix it actually uses.
//
// The directory picker is still the one to reach for, for the reason it genuinely earns:
// one action takes the whole export, `hints/` included, where a flat dialog usually cannot
// multi-select across directories and the operator has to remember the hints folder is a
// second trip. Relative paths also make the uploaded set legible after the fact. Neither
// of those is "the ingester needs the prefix".
//
// THE BYTES DO NOT GO THROUGH THE APP AT ALL ANY MORE. Two ceilings, hit in order: a
// Server Action re-encoded a `Uint8Array` as a plain number array with nothing raised (and
// capped the body at 1 MB), and the multipart POST that replaced it inherited Vercel's
// 4.5 MB request-body limit, refused at the edge before any handler runs. So each file is
// now PUT straight to Supabase Storage with a signed upload URL, and `/api/audit/run`
// receives two uuids. app/api/audit/run/route.ts documents both failures in full.
//
// WHAT IT REFUSES TO DECIDE. The server is the authority on whether an export is usable —
// `describeMissingBackbone` in lib/audit/store.ts rejects an upload with no
// `*_internal.csv` before a run is attempted, and `CrawlExportSource.list()` is documented
// as the sole authority on absence. This screen WARNS about the same conditions so an
// operator sees them before spending five minutes, and still lets them press Run. A
// client-side veto keyed off a filename convention would block a valid export the
// ingester can read, and the server's message names what arrived, which this one cannot.
//
// A PARTIAL UPLOAD MUST NOT START A RUN. If any file fails to PUT, the remaining uploads
// are abandoned, the run is never requested, and the message names the file. A run over
// most of an export produces `not_run` for every check whose report did not make it, which
// is indistinguishable from an export that never had them.
//
// INTEGRATION POINT — the page still passes every READ down as a prop (`onLoadRun`, i.e.
// app/actions/audit.ts `getAuditRun`), typed here against lib/audit/store's shapes, so a
// drift in that signature is a type error at the page, which is where that seam is. The
// RUN is not a prop and never was: it is transport, not a read the page performs. Its two
// halves — `createAuditUploadUrls` (an action, imported directly) and a fetch to the Route
// Handler — are imported here rather than threaded through the page, because the page has
// no business knowing how bytes reach storage. What made the old `onRun` prop dangerous
// was its TYPE (a `Uint8Array` crossing an action boundary), and nothing crossing either of
// these boundaries is bytes: ids and filenames out, ids back.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, Files, Loader2, Play, AlertTriangle, History } from 'lucide-react'
import type { AuditRunSummary, StoredAuditRun } from '@/lib/audit/store'
import { createAuditUploadUrls, type AuditUploadTarget } from '@/app/actions/audit-upload'
import AuditResultView from './AuditResultView'

/** app/api/audit/run/route.ts, whose body is app/actions/audit.ts `RunClientAuditResult`. */
const RUN_ENDPOINT = '/api/audit/run'

/**
 * How many files are in flight at once.
 *
 * A Sitebulb export is dozens of small CSVs and one large one, so the wall-clock cost is
 * mostly round trips rather than bandwidth and a serial loop is needlessly slow. Four
 * rather than "all of them" because every upload holds a connection and a browser caps
 * those anyway — queueing beyond the cap just makes the progress figure lurch.
 */
const UPLOAD_CONCURRENCY = 4

/**
 * The backbone, matched exactly as lib/ingest/sitebulb/crawl.ts and
 * lib/audit/store.ts `BACKBONE_SUFFIX` match it.
 */
const BACKBONE_SUFFIX = '_internal.csv'

/**
 * The two hint reports the crawl ingester actually reads.
 *
 * lib/ingest/sitebulb/crawl.ts:75-76 holds these as module-private constants and finds
 * each one with `endsWith(`_${suffix}.csv`)` at :262. They are duplicated rather than
 * imported because that module reaches node:fs through ./source and cannot be bundled into
 * a client component — the same bounded duplication, for the same reason, as
 * `BACKBONE_SUFFIX` in lib/audit/store.ts.
 *
 * They back MEAS-001 and nothing else: when a hint file is absent, `crawl.ts` records
 * `null` for that page's tag rather than `true`, so the finding reports `not_run`.
 */
const HINT_SUFFIXES = [
  '_url_contains_no_google_analytics_code.csv',
  '_url_contains_no_google_tag_manager_code.csv',
] as const

/** app/actions/audit.ts `getAuditRun`. */
export type GetAuditRun = (
  runId: string,
) => Promise<{ error?: string; run?: StoredAuditRun; report?: string }>

export interface AuditRunnerProps {
  clientId: string
  clientName: string | null
  /** Echoed before the run so the operator knows which stations can even be attempted. */
  gscSiteUrl?: string | null
  websiteUrl?: string | null
  runs?: readonly AuditRunSummary[]
  onLoadRun?: GetAuditRun
}

interface Selection {
  files: File[]
  /** Source-relative, forward-slashed, `hints/` prefix intact. Parallel to `files`. */
  paths: string[]
  /** True when the paths came from a directory pick, i.e. carry real relative paths. */
  fromDirectory: boolean
  /**
   * Paths of entries that were dropped for being zero bytes.
   *
   * Kept rather than discarded because "we left this out" is an absence, and this file's
   * own standard is that absences are stated. A cloud-sync placeholder (iCloud, Drive,
   * OneDrive) reads as 0 bytes on disk, so the commonest cause of a missing backbone here
   * is a folder that has not finished downloading — which "no *_internal.csv was found,
   * re-pick the folder" sends the operator entirely the wrong way.
   */
  emptyPaths: string[]
  totalBytes: number
}

/**
 * Normalise a picked file list into source-relative paths.
 *
 * Two jobs, both load-bearing:
 *
 * 1. FORWARD SLASHES. `webkitRelativePath` already uses them on every platform, but the
 *    invariant is written down in CrawlExportSource and is cheap to hold here too.
 * 2. STRIP THE PICKED ROOT. A directory pick yields `tornado-export/hints/x.csv`; a
 *    LocalDirSource rooted at the export directory yields `hints/x.csv`. Dropping the one
 *    shared leading segment makes the two byte-identical, which is what lets slice 2's
 *    local run and this screen be compared number for number. Only stripped when EVERY
 *    path shares that segment — otherwise there is no single root to remove and guessing
 *    one would silently relocate the hints folder.
 *
 * WHAT A SHARED FIRST SEGMENT DOES NOT PROVE. It is evidence of a common parent, not proof
 * that the parent is one export. Picking a folder that HOLDS two exports also yields a
 * single shared segment, and stripping it leaves `siteA-export/x_internal.csv` and
 * `siteB-export/y_internal.csv` sitting side by side in one upload. Nothing downstream
 * notices: suffix matching ignores directories entirely, so the two crawls are read as one
 * site and `findBackboneFile` takes whichever backbone happens to come first. From the
 * paths alone this function cannot tell that case from a legitimate nested export, so it
 * does not try — `describeSelection` below counts backbones and non-`hints/`
 * subdirectories, which is what actually distinguishes them, and the screen says so.
 */
function normalisePaths(files: File[]): { paths: string[]; fromDirectory: boolean } {
  const raw = files.map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath
    return (rel && rel.length > 0 ? rel : f.name).replace(/\\/g, '/')
  })
  const fromDirectory = raw.some((p) => p.includes('/'))

  const firstSegments = new Set(raw.map((p) => (p.includes('/') ? p.split('/')[0] : '')))
  if (firstSegments.size === 1 && !firstSegments.has('')) {
    const root = Array.from(firstSegments)[0]
    return { paths: raw.map((p) => p.slice(root.length + 1)), fromDirectory }
  }
  return { paths: raw, fromDirectory }
}

/** What a selection actually contains, judged the way the ingester judges it. */
interface SelectionFacts {
  /** Every `*_internal.csv`. Exactly one is a single export; two or more is a blend. */
  backbones: string[]
  /** The MEAS-001 hint files present, matched by suffix rather than by `hints/` prefix. */
  hintFiles: string[]
  /** Hint suffixes with no matching file — named so the warning can say WHICH is absent. */
  hintsMissing: string[]
  /**
   * Distinct directories other than `hints/` that survive root-stripping.
   *
   * A single Sitebulb export is flat plus one `hints/` folder, so anything else here means
   * the pick was a level too high — most often a parent holding several exports, which is
   * the case that silently blends two crawls into one audit.
   */
  extraDirs: string[]
}

function describeSelection(paths: readonly string[]): SelectionFacts {
  const backbones = paths.filter((p) => p.endsWith(BACKBONE_SUFFIX))
  const hintFiles = paths.filter((p) => HINT_SUFFIXES.some((s) => p.endsWith(s)))
  const hintsMissing = HINT_SUFFIXES.filter((s) => !paths.some((p) => p.endsWith(s)))

  const dirs = new Set<string>()
  for (const p of paths) {
    const cut = p.lastIndexOf('/')
    if (cut === -1) continue
    const dir = p.slice(0, cut)
    if (dir !== 'hints') dirs.add(dir)
  }

  return { backbones, hintFiles, hintsMissing, extraDirs: Array.from(dirs).sort() }
}

function describeBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function timestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

// ── upload ────────────────────────────────────────────────────────────────────────────

/**
 * What the operator is shown while the bytes move.
 *
 * `sentBytes` counts bytes the browser has HANDED TO THE NETWORK, which can run slightly
 * ahead of bytes durably stored; `doneFiles` counts files storage has acknowledged with a
 * 2xx. Both are reported because they answer different questions — "is it moving" and "how
 * much is actually safe" — and neither is an invented percentage.
 */
interface UploadProgress {
  totalFiles: number
  doneFiles: number
  totalBytes: number
  sentBytes: number
}

/** The file that broke the upload, and why, in words an operator can act on. */
interface UploadFailure {
  path: string
  reason: string
}

/**
 * PUT one file to its signed upload URL.
 *
 * XMLHttpRequest RATHER THAN fetch, for one reason: `fetch` reports no upload progress at
 * all, and this is now the slow part of the screen. The alternative was a spinner with no
 * number next to it, which for a 60 MB export over a domestic uplink is indistinguishable
 * from a hang.
 *
 * A raw PUT with the File as the body is exactly what supabase-js's `uploadToSignedUrl`
 * does for a non-Blob body — the signed URL already carries its token, so no session header
 * is involved and no Supabase client is needed in the browser for this.
 */
function putToSignedUrl(
  target: AuditUploadTarget,
  file: File,
  onProgress: (loaded: number) => void,
  onOpen: (xhr: XMLHttpRequest) => void,
  onSettle: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', target.signedUrl)
    // Stored as the object's content type and read by nothing: the ingester identifies a
    // report by its filename suffix and its bytes. A directory pick reports an empty type
    // on several browsers, so octet-stream is the honest default rather than a guess.
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    // Makes explicit what the token already enforces — the signature was minted without
    // upsert. An overwrite would change what a stored run's source is after the run read it.
    xhr.setRequestHeader('x-upsert', 'false')

    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      onSettle(xhr)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      reject(new Error(describeUploadStatus(xhr)))
    }
    xhr.onerror = () => {
      onSettle(xhr)
      reject(new Error('the connection dropped mid-upload'))
    }
    xhr.onabort = () => {
      onSettle(xhr)
      reject(new Error('the upload was abandoned because an earlier file failed'))
    }

    onOpen(xhr)
    xhr.send(file)
  })
}

/** A storage failure in words, with the one status code that has a specific remedy named. */
function describeUploadStatus(xhr: XMLHttpRequest): string {
  const detail = (xhr.responseText || '').slice(0, 200).trim()
  if (xhr.status === 413) {
    return (
      `storage refused it as too large (413). The per-file limit on the audit-exports bucket ` +
      `is 100 MB, and a Supabase project also has its own global upload limit that a bucket ` +
      `cannot exceed${detail ? ` — ${detail}` : ''}`
    )
  }
  if (xhr.status === 0) {
    return 'the request never completed — most likely the network, or a signed URL that has expired'
  }
  return `storage answered ${xhr.status}${detail ? `: ${detail}` : ''}`
}

/**
 * Upload every file, stopping at the first failure.
 *
 * STOPPING IS THE POINT. In-flight requests are aborted and the queue is abandoned, so no
 * run is requested over a partial export. The first failure wins the message — later ones
 * are almost always the aborts this function itself caused, and reporting those instead
 * would name the wrong file.
 */
async function uploadAll(
  uploads: readonly AuditUploadTarget[],
  filesByPath: Map<string, File>,
  onProgress: (progress: { sentBytes: number; doneFiles: number }) => void,
): Promise<UploadFailure | null> {
  const sent = new Array<number>(uploads.length).fill(0)
  const inflight = new Set<XMLHttpRequest>()
  let doneFiles = 0
  let failure: UploadFailure | null = null
  let next = 0

  const report = () =>
    onProgress({ sentBytes: sent.reduce((total, n) => total + n, 0), doneFiles })

  async function worker(): Promise<void> {
    for (;;) {
      if (failure !== null) return
      const index = next
      next += 1
      if (index >= uploads.length) return

      const target = uploads[index]
      const file = filesByPath.get(target.path)
      if (!file) {
        // Cannot happen from the picker — the map is built from the same selection the
        // paths came from — but a silent skip here would upload an export missing a file
        // and run over it, which is the failure this whole function is shaped to prevent.
        failure = { path: target.path, reason: 'the picked file was no longer available in this tab' }
        return
      }

      try {
        await putToSignedUrl(
          target,
          file,
          (loaded) => {
            sent[index] = loaded
            report()
          },
          (xhr) => inflight.add(xhr),
          (xhr) => inflight.delete(xhr),
        )
        sent[index] = file.size
        doneFiles += 1
        report()
      } catch (err) {
        if (failure === null) {
          failure = { path: target.path, reason: err instanceof Error ? err.message : String(err) }
        }
        for (const xhr of Array.from(inflight)) xhr.abort()
        return
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, uploads.length) }, () => worker()),
  )
  return failure
}

export default function AuditRunner({
  clientId,
  clientName,
  gscSiteUrl,
  websiteUrl,
  runs = [],
  onLoadRun,
}: AuditRunnerProps) {
  const router = useRouter()
  const dirInputRef = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  // Four phases, because they fail differently and an operator needs to know which one they
  // are in: `preparing` mints signatures (fast, all-or-nothing), `uploading` moves the
  // bytes (slow, and the one with a real number attached), `running` is the audit itself
  // against a 5 minute budget, `loading` is the read-back of the stored run. Nothing is
  // read into JS memory at any point — each File is handed to XHR as-is.
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'uploading' | 'running' | 'loading'>(
    'idle',
  )
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<AuditRunSummary | null>(null)
  const [stored, setStored] = useState<StoredAuditRun | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [openRunId, setOpenRunId] = useState<string | null>(null)

  // `webkitdirectory` is not in React's InputHTMLAttributes, and it is a DOM attribute
  // rather than a property, so it is set on the node instead of cast onto the JSX props.
  useEffect(() => {
    const el = dirInputRef.current
    if (!el) return
    el.setAttribute('webkitdirectory', '')
    el.setAttribute('directory', '')
  }, [])

  function reset() {
    setError(null)
    // Cleared here rather than only in handleRun, so opening a run from history does not
    // redisplay the byte counts of a previous upload next to it.
    setProgress(null)
    setReceipt(null)
    setStored(null)
    setReport(null)
  }

  function handlePick(fileList: FileList | null) {
    setError(null)
    if (!fileList || fileList.length === 0) {
      setSelection(null)
      return
    }
    // Zero-byte entries are LEFT OUT, and recorded. Sending an empty CSV is worse than
    // dropping it — `parseCsv` yields a table with no rows, so an empty backbone would
    // ingest as a crawl of a site with no pages, which is a fabricated-empty result. But
    // dropping them silently was how a stalled cloud-sync folder produced "no
    // *_internal.csv in this selection", sending the operator to re-pick a folder that was
    // never the problem. So: drop, then say which.
    const picked = Array.from(fileList)
    const all = normalisePaths(picked)
    const files: File[] = []
    const paths: string[] = []
    const emptyPaths: string[] = []

    picked.forEach((file, i) => {
      if (file.size > 0) {
        files.push(file)
        paths.push(all.paths[i])
      } else {
        emptyPaths.push(all.paths[i])
      }
    })

    setSelection({
      files,
      paths,
      fromDirectory: all.fromDirectory,
      emptyPaths,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    })
  }

  /** Load a stored run into the view. Shared by "just ran" and "clicked in history". */
  async function load(id: string): Promise<void> {
    if (!onLoadRun) return
    const res = await onLoadRun(id)
    if (res.error) {
      setError(res.error)
      return
    }
    setStored(res.run ?? null)
    setReport(res.report ?? null)
    setOpenRunId(id)
  }

  async function handleRun() {
    if (!selection || phase !== 'idle') return
    reset()
    setOpenRunId(null)

    const picked = selection
    const filesByPath = new Map<string, File>()
    for (let i = 0; i < picked.files.length; i += 1) filesByPath.set(picked.paths[i], picked.files[i])

    try {
      // ── 1. ask the server where these files may go ──────────────────────────────
      // The names go up; the PATHS come back. Nothing here chooses an object key — the
      // action derives every one of them from a client id it validated and a run token it
      // minted, and each signature is scoped to a single key. A browser-chosen path would
      // be a write-anywhere primitive against a bucket holding every client's crawl data.
      setPhase('preparing')
      const prepared = await createAuditUploadUrls({ clientId, paths: picked.paths })
      if (prepared.error || !prepared.uploads || !prepared.runToken) {
        setPhase('idle')
        setError(prepared.error ?? 'The upload could not be prepared, and no reason was given.')
        return
      }

      // ── 2. the bytes, straight to storage ───────────────────────────────────────
      setPhase('uploading')
      setProgress({
        totalFiles: prepared.uploads.length,
        doneFiles: 0,
        totalBytes: picked.totalBytes,
        sentBytes: 0,
      })

      const failure = await uploadAll(prepared.uploads, filesByPath, ({ sentBytes, doneFiles }) =>
        setProgress((p) => (p === null ? p : { ...p, sentBytes, doneFiles })),
      )

      if (failure !== null) {
        setPhase('idle')
        // NO RUN IS REQUESTED. An audit over a partial export reports `not_run` for every
        // check whose report did not arrive, which reads exactly like an export that never
        // had them. The files that did land stay in storage under a run id nothing will
        // read; pressing Run again uploads the whole export afresh under a new one.
        setError(
          `Uploading ${failure.path} failed: ${failure.reason}. Nothing was run — an audit over ` +
            `part of an export reports "not run" for the missing reports, which is indistinguishable ` +
            `from an export that never had them. Press Run audit again to re-upload the whole export.`,
        )
        return
      }

      // ── 3. the run request, which carries no bytes ──────────────────────────────
      setPhase('running')
      const response = await fetch(RUN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, runToken: prepared.runToken }),
      })

      // A body that is not JSON is not an audit failure. The real case is middleware
      // answering an expired session with a redirect to the HTML login page; parsing that
      // as JSON gives the operator an "unexpected token <" and no idea what happened.
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        setPhase('idle')
        setError(
          `The server answered ${response.status} with no JSON. The likeliest cause is an ` +
            `expired session — reload the page and sign in again. The export is uploaded; the ` +
            `audit did not run.`,
        )
        return
      }

      const res = (await response.json()) as {
        error?: string
        runId?: string
        summary?: AuditRunSummary
      }
      if (res.error) {
        setPhase('idle')
        setError(res.error)
        return
      }
      setReceipt(res.summary ?? null)
      // The action's summary is the LIST shape — status, timings, counts. The findings and
      // the station strip live in the stored envelope, so the full view is a second read.
      if (res.runId) {
        setPhase('loading')
        await load(res.runId)
      }
      setPhase('idle')
      // The action revalidates the client page, not this one, so the history list would
      // otherwise not show the run that was just stored until a manual reload.
      router.refresh()
    } catch (err) {
      setPhase('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleHistoryClick(id: string) {
    if (phase !== 'idle') return
    reset()
    setPhase('loading')
    try {
      await load(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setPhase('idle')
  }

  const facts = describeSelection(selection?.paths ?? [])
  const hasInternal = facts.backbones.length > 0
  // A dropped zero-byte backbone is a DIFFERENT failure from a missing one, and the two
  // have opposite remedies, so they get different messages below.
  const emptyBackbone = (selection?.emptyPaths ?? []).filter((p) => p.endsWith(BACKBONE_SUFFIX))
  const busy = phase !== 'idle'

  return (
    <div className="space-y-4">
      {/* ── picker ───────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-surface-700 bg-surface-900 px-5 py-4">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500 mb-3">
          Sitebulb export
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-700 px-3 py-2 text-sm font-medium text-surface-100 transition-colors hover:border-surface-600 hover:bg-surface-850 focus-within:ring-2 focus-within:ring-brand-400">
            <FolderOpen size={14} />
            Choose export folder
            <input
              ref={dirInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => handlePick(e.target.files)}
              disabled={busy}
            />
          </label>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-700 px-3 py-2 text-sm font-medium text-surface-300 transition-colors hover:border-surface-600 hover:bg-surface-850 focus-within:ring-2 focus-within:ring-brand-400">
            <Files size={14} />
            Choose files instead
            <input
              type="file"
              multiple
              accept=".csv,.xlsx,.json"
              className="sr-only"
              onChange={(e) => handlePick(e.target.files)}
              disabled={busy}
            />
          </label>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-surface-400">
          Pick the export <span className="text-surface-300">directory</span>, not a zip. The
          folder picker takes the whole export in one go —{' '}
          <span className="font-mono">hints/</span> included — which a flat dialog usually
          cannot, since it selects within one directory at a time. A flat selection is still
          read correctly: the ingester matches every report by filename{' '}
          <span className="text-surface-300">suffix</span>, not by folder, so a hint file
          picked on its own counts exactly the same.
        </p>

        {/* The old copy here quoted a 4 MB ceiling. That was the hosting request-body cap,
            and it is gone: files now go straight to storage and the run request carries
            two ids. Saying what the limits ARE beats leaving the sentence out — an
            operator who was refused last week needs to know what changed. */}
        <p className="mt-2 text-[11px] leading-relaxed text-surface-400">
          There is no upload size cap on this screen any more — the files go directly to
          storage rather than through the app, so a full multi-megabyte export is fine. What
          still bounds it is the <span className="text-surface-300">run</span>: 100 MB per
          individual file, and a 5 minute budget covering the download, the crawl ingest
          parsing every CSV, and 90 days of GSC. An export large enough to exhaust that has
          to go through <span className="font-mono">scripts/audit-dry-run.ts</span>, which
          reads the folder off disk with no budget at all.
        </p>

        {/* what was selected, before anything runs */}
        {selection && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
              <span className="text-surface-100">
                <span className="tabular-nums font-medium">{selection.files.length}</span> files
              </span>
              <span className="text-surface-400">{describeBytes(selection.totalBytes)}</span>
              <span className="text-surface-400">
                <span className="tabular-nums">{facts.hintFiles.length}</span> of{' '}
                <span className="tabular-nums">{HINT_SUFFIXES.length}</span> MEAS-001 hint files
              </span>
              <span className="text-surface-400">
                backbone <span className="font-mono">*_internal.csv</span>{' '}
                {hasInternal ? 'found' : 'not found'}
              </span>
            </div>

            {!hasInternal && emptyBackbone.length > 0 && (
              <Warning>
                The backbone is <span className="text-surface-100">present but empty</span>, not
                missing: <span className="font-mono">{emptyBackbone.join(', ')}</span>{' '}
                {emptyBackbone.length === 1 ? 'is' : 'are'} zero bytes, so{' '}
                {emptyBackbone.length === 1 ? 'it was' : 'they were'} left out of the upload
                rather than sent as an empty crawl — an empty backbone ingests as a site with no
                pages, which reads like a clean audit. A zero-byte file on disk is what an
                iCloud, Drive or OneDrive placeholder looks like, and what an interrupted export
                leaves behind. Make the folder fully local and pick it again — re-picking a
                different folder will not help.
              </Warning>
            )}

            {!hasInternal && emptyBackbone.length === 0 && (
              <Warning>
                No <span className="font-mono">*_internal.csv</span> in this selection. That
                file is the crawl backbone — without it there is no page list, and the server
                will refuse the upload rather than run a crawl over hint-derived pages. Check
                you picked the export folder itself and not a subdirectory of it.
              </Warning>
            )}

            {facts.backbones.length > 1 && (
              <Warning>
                This selection holds{' '}
                <span className="tabular-nums">{facts.backbones.length}</span> backbone files —{' '}
                <span className="font-mono">{facts.backbones.join(', ')}</span>. A Sitebulb
                export has exactly one, so this is more than one export in a single upload,
                usually from picking the folder that <em>contains</em> them. Nothing downstream
                separates them: reports are matched by filename suffix regardless of folder, so
                the crawls are read as one site and the first backbone wins. Every finding would
                be about a blend of both. Pick a single export folder.
              </Warning>
            )}

            {facts.backbones.length <= 1 && facts.extraDirs.length > 0 && (
              <Warning>
                This selection has subdirectories other than{' '}
                <span className="font-mono">hints/</span>:{' '}
                <span className="font-mono">{facts.extraDirs.join(', ')}</span>. A Sitebulb
                export is flat plus one <span className="font-mono">hints/</span> folder, so the
                pick is probably a level too high. The run will still go ahead — matching is by
                filename suffix, so extra folders are harmless in themselves — but check that
                everything here came from the same crawl.
              </Warning>
            )}

            {facts.hintsMissing.length > 0 && (
              <Warning>
                {facts.hintsMissing.length === HINT_SUFFIXES.length
                  ? 'Neither MEAS-001 hint file is in this selection'
                  : 'A MEAS-001 hint file is missing from this selection'}
                : <span className="font-mono">{facts.hintsMissing.join(', ')}</span>. These are
                matched by suffix, so a flat pick carries them fine — they are genuinely absent,
                not merely un-prefixed. Sitebulb writes a hint file only when the hint{' '}
                <em>triggered</em>, so their absence is ambiguous: either every page carries its
                GA4/GTM tag, or hints were never exported. The ingester will not guess — it
                records the tag as unmeasured and MEAS-001 reports{' '}
                <span className="font-mono">not_run</span> rather than a pass. Everything else
                still runs.
              </Warning>
            )}

            {selection.emptyPaths.length > 0 && (
              <Warning>
                <span className="tabular-nums">{selection.emptyPaths.length}</span> zero-byte
                file{selection.emptyPaths.length === 1 ? ' was' : 's were'} left out of the
                upload:{' '}
                <span className="font-mono">
                  {selection.emptyPaths.slice(0, 6).join(', ')}
                  {selection.emptyPaths.length > 6
                    ? `, and ${selection.emptyPaths.length - 6} more`
                    : ''}
                </span>
                . An empty CSV parses as a report with no rows, which is indistinguishable from
                a report that found nothing, so it is dropped rather than sent. If you expected
                data in {selection.emptyPaths.length === 1 ? 'it' : 'them'}, the folder is
                likely still syncing.
              </Warning>
            )}

            <details className="text-[12px]">
              <summary className="cursor-pointer text-surface-400 transition-colors hover:text-surface-100">
                {/* Whether relative paths came through is worth stating and is NOT a
                    correctness claim: matching is by suffix either way. It tells the
                    operator how to read the list below, and it is the receipt for what
                    was uploaded under each name. */}
                Show the {selection.files.length} paths being uploaded —{' '}
                {selection.fromDirectory
                  ? 'relative paths preserved'
                  : 'flat selection, filenames only'}
              </summary>
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 font-mono text-[11px] text-surface-300">
                {selection.paths.map((p) => (
                  <li key={p} className="truncate">
                    {p}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {/* which stations can even be attempted, stated before the run */}
        <div className="mt-4 border-t border-surface-800 pt-3 text-[11px] leading-relaxed text-surface-400">
          <p>
            Client <span className="text-surface-300">{clientName ?? clientId}</span> · GSC
            property{' '}
            <span className="font-mono text-surface-300">{gscSiteUrl || 'not set'}</span> · site
            origin <span className="font-mono text-surface-300">{websiteUrl || 'not set'}</span>.
          </p>
          <p className="mt-1">
            An unset GSC property is not a failure — the GSC station reports{' '}
            <span className="font-mono">unconfigured</span> and every check that reads it
            reports <span className="font-mono">not_run</span>, which is the honest answer.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={!selection || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {/* One label per phase, because they fail differently: a stall while preparing
                is a server problem, a stall while uploading is the network, and a stall
                while running is the audit against its 5 minute budget. */}
            {phase === 'preparing'
              ? 'Preparing upload…'
              : phase === 'uploading'
                ? 'Uploading export…'
                : phase === 'running'
                  ? 'Running audit…'
                  : phase === 'loading'
                    ? 'Loading run…'
                    : 'Run audit'}
          </button>
          <p className="text-[11px] leading-relaxed text-surface-400">
            A full export takes minutes, not seconds: the upload, then the crawl ingest
            parsing every CSV, then 90 days of GSC. Leave this tab open — the run is stored
            either way, but this is where the result comes back.
          </p>
        </div>

        {/* ── upload progress ──────────────────────────────────────────────────
            Real numbers only. `sent` counts bytes handed to the network and `stored`
            counts files storage has acknowledged, which is why both are shown rather
            than one blended percentage: the second is the one that is actually safe,
            and it is the one the run depends on. */}
        {progress && phase !== 'idle' && (
          <div className="mt-3 rounded-sm border border-surface-800 bg-surface-950 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
              <span className="text-surface-100">
                <span className="tabular-nums">{progress.doneFiles}</span> of{' '}
                <span className="tabular-nums">{progress.totalFiles}</span> files stored
              </span>
              <span className="tabular-nums text-surface-400">
                {describeBytes(progress.sentBytes)} of {describeBytes(progress.totalBytes)} sent
              </span>
              {phase !== 'uploading' && (
                <span className="text-surface-400">upload complete — the audit is running</span>
              )}
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-800">
              <div
                className="h-full bg-brand-500 transition-[width] duration-200"
                style={{
                  width: `${
                    progress.totalBytes > 0
                      ? Math.min(100, Math.round((progress.sentBytes / progress.totalBytes) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-sm px-3 py-2 text-xs"
            style={{
              color: 'var(--color-error)',
              backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)',
            }}
          >
            {error}
          </p>
        )}
      </section>

      {/* ── the run receipt ──────────────────────────────────────────────────── */}
      {receipt && <RunReceipt summary={receipt} />}

      {/* ── run history ──────────────────────────────────────────────────────── */}
      {runs.length > 0 && (
        <section className="rounded-xl border border-surface-700 bg-surface-900 px-5 py-4">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500 mb-3">
            <History size={12} />
            Previous runs
          </h3>
          <ul className="space-y-1">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => handleHistoryClick(run.id)}
                  disabled={busy || !onLoadRun}
                  className={`flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50 ${
                    openRunId === run.id ? 'bg-surface-850' : 'hover:bg-surface-850'
                  }`}
                >
                  <span className="text-surface-100">{timestamp(run.startedAt)}</span>
                  <span className="text-surface-400">{run.status}</span>
                  <span className="tabular-nums text-surface-400">
                    {typeof run.durationMs === 'number' ? `${run.durationMs}ms` : '—'}
                  </span>
                  <span className="font-mono text-[11px] text-surface-400">
                    {run.configVersion || 'no config version'}
                  </span>
                  <span className="tabular-nums text-[11px] text-surface-400">
                    {/* Null counts are "we could not read the stored run", never "0 fail". */}
                    {run.findingCounts
                      ? `${run.findingCounts.fail} fail · ${run.findingCounts.not_run} not run`
                      : 'counts unreadable'}
                  </span>
                  {run.notes.length > 0 && (
                    <span className="text-[11px]" style={{ color: 'var(--color-warning)' }}>
                      {run.notes.length} note{run.notes.length === 1 ? '' : 's'}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── result ───────────────────────────────────────────────────────────── */}
      {stored && stored.run === null && (
        <section className="rounded-xl border border-surface-700 bg-surface-900 px-5 py-4">
          <Warning>
            This run exists, but the stored result could not be read
            {stored.unreadableReason ? `: ${stored.unreadableReason}` : '.'} Nothing is
            rendered below on purpose — an empty report is indistinguishable from a clean
            one, and this run is neither. Its status, timings and notes above are still true.
          </Warning>
        </section>
      )}

      {stored?.run && (
        <AuditResultView
          summary={stored.run}
          clientName={clientName}
          attribution={stored.exportAttribution}
          reportText={report}
        />
      )}
    </div>
  )
}

/**
 * What the action returned, before the full run is loaded.
 *
 * Its own block rather than folded into the result view: this is the LIST summary — the
 * row that was written — and it stays on screen even when the stored envelope turns out
 * to be unreadable, which is exactly the case where "the run happened" and "we can show
 * you the run" come apart.
 */
function RunReceipt({ summary }: { summary: AuditRunSummary }) {
  const counts = summary.findingCounts
  return (
    <section className="rounded-xl border border-surface-700 bg-surface-900 px-5 py-4">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500 mb-3">
        Run stored
      </h3>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
        <span className="text-surface-100">{summary.status}</span>
        <span className="text-surface-400">{timestamp(summary.startedAt)}</span>
        <span className="tabular-nums text-surface-400">
          {typeof summary.durationMs === 'number' ? `${summary.durationMs}ms` : '—'}
        </span>
        <span className="font-mono text-[11px] text-surface-400">
          {summary.configVersion || 'no config version'}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-surface-300">
        {counts
          ? `${counts.total} findings — ${counts.fail} fail · ${counts.degraded} degraded · ${counts.pass} pass · ${counts.not_run} not run`
          : 'Finding counts unreadable for this run. That is not zero findings.'}
      </p>
      {summary.notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {summary.notes.map((n, i) => (
            <li key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--color-warning)' }}>
              {n}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-sm px-3 py-2 text-[12px] leading-relaxed"
      style={{
        color: 'var(--color-warning)',
        backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'color-mix(in srgb, var(--color-warning) 25%, transparent)',
      }}
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
