// The storage-backed export source.
//
// The properties worth pinning are the ones that keep a broken upload from reading as a
// merely incomplete export. In order of how much damage getting them wrong does:
//
//   1. A listing that could not be completed THROWS. Supabase pages at 100 entries, so the
//      tempting implementation returns the first page and a large export silently loses
//      reports — every check backed by a dropped report then reports `not_run`, which is
//      indistinguishable from an export that never had them.
//   2. `read` throws for a broken fetch and RETURNS for a zero-byte object. Those mean
//      opposite things: an empty CSV is a report that found nothing, a failed read is a
//      report we cannot see. One test asserts they are distinguishable, because the obvious
//      shortcut — treating an empty body as an error, or an error as empty bytes — collapses
//      them and nothing downstream would notice.
//   3. The traversal guard, which is what stops an object key being concatenated out of the
//      prefix it is supposed to be scoped to.
//
// NO NETWORK. Everything drives a stub with the same shape as `supabase.storage.from(...)`.

import { describe, expect, it } from 'vitest'
import {
  AUDIT_EXPORT_BUCKET,
  StoragePrefixSource,
  describeUnsafeExportName,
  exportPrefix,
  isUuid,
  type ExportStorageBucket,
  type ExportStorageEntry,
} from '@/lib/audit/storage-source'

const CLIENT = '11111111-2222-4333-8444-555555555555'
const RUN = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const PREFIX = exportPrefix(CLIENT, RUN)

interface StubOptions {
  /** Object key (relative to the prefix) → bytes. Folders are derived from the keys. */
  objects?: Record<string, Uint8Array>
  /** Prefixes whose `list` fails, keyed by the full path the source asks for. */
  listErrors?: Record<string, string>
  /** Object keys (relative to the prefix) whose `download` fails. */
  downloadErrors?: Record<string, string>
  /** Return `{ data: null, error: null }` from every list — the shape neither branch expects. */
  listReturnsNothing?: boolean
}

interface Stub {
  bucket: ExportStorageBucket
  listCalls: { path: string; limit?: number; offset?: number }[]
  downloadCalls: string[]
}

/**
 * A stand-in for `supabase.storage.from('audit-exports')`.
 *
 * Reproduces the two behaviours the real API has that the source has to cope with: a page
 * size (so pagination is exercised rather than assumed) and folder rows carrying a null id
 * alongside real objects.
 */
function stub(options: StubOptions = {}): Stub {
  const objects = options.objects ?? {}
  const listCalls: Stub['listCalls'] = []
  const downloadCalls: string[] = []

  function entriesAt(path: string): ExportStorageEntry[] {
    const rel = path === PREFIX ? '' : `${path.slice(PREFIX.length + 1)}/`
    const out: ExportStorageEntry[] = []
    const folders = new Set<string>()
    for (const key of Object.keys(objects)) {
      if (!key.startsWith(rel)) continue
      const tail = key.slice(rel.length)
      const cut = tail.indexOf('/')
      if (cut === -1) {
        out.push({ name: tail, id: `id-${key}` })
      } else {
        folders.add(tail.slice(0, cut))
      }
    }
    // Folder rows carry a null id — that is the discriminator the source uses, and it is
    // the SDK's actual behaviour rather than a convenience of this stub.
    for (const folder of Array.from(folders)) out.push({ name: folder, id: null })
    return out
  }

  const bucket: ExportStorageBucket = {
    async list(path, opts) {
      listCalls.push({ path, limit: opts?.limit, offset: opts?.offset })
      const failure = options.listErrors?.[path]
      if (failure) return { data: null, error: { message: failure } }
      if (options.listReturnsNothing) return { data: null, error: null }
      const all = entriesAt(path)
      const limit = opts?.limit ?? 100
      const offset = opts?.offset ?? 0
      return { data: all.slice(offset, offset + limit), error: null }
    },
    async download(path) {
      downloadCalls.push(path)
      const rel = path.slice(PREFIX.length + 1)
      const failure = options.downloadErrors?.[rel]
      if (failure) return { data: null, error: { message: failure } }
      const bytes = objects[rel]
      if (bytes === undefined) return { data: null, error: { message: 'Object not found' } }
      // lib.dom types `BlobPart` as an `ArrayBufferView<ArrayBuffer>`, and a `Uint8Array`
      // is typed over `ArrayBufferLike` (which admits SharedArrayBuffer). The value is a
      // valid Blob part at runtime; only the declaration is narrower than reality.
      return { data: new Blob([bytes as unknown as BlobPart]), error: null }
    },
  }

  return { bucket, listCalls, downloadCalls }
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

const MINI = {
  'mini_internal.csv': bytes('URL\nhttps://example.com/\n'),
  'mini_indexability.csv': bytes('URL\nhttps://example.com/\n'),
  'hints/mini_url_contains_no_google_analytics_code.csv': bytes('URL\n'),
}

describe('exportPrefix / isUuid', () => {
  it('puts the client first so the bucket is browsable per client', () => {
    expect(exportPrefix(CLIENT, RUN)).toBe(`${CLIENT}/${RUN}`)
  })

  it('accepts a uuid and rejects anything that could reach outside a prefix', () => {
    expect(isUuid(CLIENT)).toBe(true)
    expect(isUuid(crypto.randomUUID())).toBe(true)
    for (const bad of ['', '..', `${CLIENT}/..`, 'not-a-uuid', `${CLIENT} `, `../../${CLIENT}`]) {
      expect(isUuid(bad), bad).toBe(false)
    }
  })

  it('names the bucket the migration creates', () => {
    expect(AUDIT_EXPORT_BUCKET).toBe('audit-exports')
  })
})

describe('describeUnsafeExportName', () => {
  it('accepts the names a Sitebulb export actually carries', () => {
    for (const name of [
      'tornadohvacca_com_internal.csv',
      'tornadohvacca_com_summary.xlsx',
      'hints/tornadohvacca_com_url_contains_no_google_analytics_code.csv',
      'export-2026-08-07.csv',
      'a file with spaces.csv',
    ]) {
      expect(describeUnsafeExportName(name), name).toBeNull()
    }
  })

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['../secrets.env', 'traversal'],
    ['hints/../../secrets.env', 'traversal past the prefix'],
    ['hints\\x.csv', 'backslash'],
    ['a//b.csv', 'empty segment'],
    ['./x.csv', 'dot segment'],
    ['a/b/c.csv', 'too deep for a one-level listing'],
    ['-leading-hyphen.csv', 'outside the accepted character set'],
    ['weird;name.csv', 'outside the accepted character set'],
  ])('refuses %j (%s)', (name) => {
    const reason = describeUnsafeExportName(name)
    expect(reason).not.toBeNull()
    // Prose, not a boolean: the caller shows this to an operator, and "invalid filename"
    // sends someone back to Sitebulb with nothing to change.
    expect(reason!.length).toBeGreaterThan(20)
  })

  it('refuses a third level explicitly, because such a file would upload and never be listed', () => {
    expect(describeUnsafeExportName('reports/hints/x.csv')).toMatch(/never be listed/)
  })
})

describe('StoragePrefixSource.list', () => {
  it('lists top-level entries and one level of subdirectory, forward-slashed', async () => {
    const { bucket } = stub({ objects: MINI })
    const names = await StoragePrefixSource(bucket, PREFIX).list()

    expect(names).toContain('mini_internal.csv')
    expect(names).toContain('mini_indexability.csv')
    expect(names).toContain('hints/mini_url_contains_no_google_analytics_code.csv')
    // Nothing bare from the subdirectory — a `hints/`-less name would defeat the suffix
    // matching that has to work identically for every source kind.
    expect(names).not.toContain('mini_url_contains_no_google_analytics_code.csv')
  })

  it('memoizes so the manifest ingest and the crawl ingest cannot disagree about what exists', async () => {
    const { bucket, listCalls } = stub({ objects: MINI })
    const source = StoragePrefixSource(bucket, PREFIX)
    const [a, b] = [await source.list(), await source.list()]
    expect(a).toBe(b) // identity, not just equality: one sweep
    const sweeps = listCalls.filter((c) => c.path === PREFIX).length
    expect(sweeps).toBe(1)
  })

  it('pages past the 100-entry default rather than returning a truncated export', async () => {
    const many: Record<string, Uint8Array> = { 'big_internal.csv': bytes('URL\n') }
    for (let i = 0; i < 250; i += 1) many[`big_report_${i}.csv`] = bytes('URL\n')

    const { bucket, listCalls } = stub({ objects: many })
    const names = await StoragePrefixSource(bucket, PREFIX).list()

    expect(names).toHaveLength(251)
    expect(names).toContain('big_report_249.csv')
    // Proof it actually paginated rather than the stub handing everything back at once.
    expect(listCalls.filter((c) => c.path === PREFIX).length).toBeGreaterThan(1)
  })

  it('throws when the listing fails, so a broken source is never read as an empty export', async () => {
    const { bucket } = stub({ objects: MINI, listErrors: { [PREFIX]: 'connection reset' } })
    await expect(StoragePrefixSource(bucket, PREFIX).list()).rejects.toThrow(/connection reset/)
  })

  it('throws when a listing returns neither entries nor an error', async () => {
    const { bucket } = stub({ objects: MINI, listReturnsNothing: true })
    await expect(StoragePrefixSource(bucket, PREFIX).list()).rejects.toThrow(
      /neither entries nor an error/,
    )
  })

  it('throws when a subdirectory listing fails, rather than reporting the export without its hints', async () => {
    const { bucket } = stub({
      objects: MINI,
      listErrors: { [`${PREFIX}/hints`]: 'timed out' },
    })
    // The dangerous alternative is catching this and returning the top-level files: the
    // export would look like one where hints were never exported, and MEAS-001 would report
    // not_run for a reason that is not true.
    await expect(StoragePrefixSource(bucket, PREFIX).list()).rejects.toThrow(/timed out/)
  })

  it('carries a label into its errors so an operator knows which export failed', async () => {
    const { bucket } = stub({ listErrors: { [PREFIX]: 'boom' } })
    await expect(StoragePrefixSource(bucket, PREFIX, 'upload 42').list()).rejects.toThrow(/upload 42/)
    expect(StoragePrefixSource(bucket, PREFIX).label).toBe(`audit-exports/${PREFIX}`)
  })
})

describe('StoragePrefixSource.read', () => {
  it('returns the object bytes for a name that came out of the listing', async () => {
    const { bucket, downloadCalls } = stub({ objects: MINI })
    const source = StoragePrefixSource(bucket, PREFIX)

    // Compared as plain arrays: a Blob's arrayBuffer in jsdom comes from a different realm
    // than the test's TextEncoder output, so `toEqual` on the typed arrays fails on
    // constructor identity while reporting "no visual difference". The bytes are the claim.
    const backbone = await source.read('mini_internal.csv')
    expect(backbone).toBeInstanceOf(Uint8Array)
    expect(Array.from(backbone)).toEqual(Array.from(MINI['mini_internal.csv']))
    expect(
      Array.from(await source.read('hints/mini_url_contains_no_google_analytics_code.csv')),
    ).toEqual(Array.from(MINI['hints/mini_url_contains_no_google_analytics_code.csv']))
    // The prefix is prepended by the source; the caller only ever names export-relative
    // paths, which is what keeps the ingester's naming convention intact.
    expect(downloadCalls).toEqual([
      `${PREFIX}/mini_internal.csv`,
      `${PREFIX}/hints/mini_url_contains_no_google_analytics_code.csv`,
    ])
  })

  it('throws for an object that is not there rather than reporting absence', async () => {
    // The distinction the seam exists for: absence is list()'s job. A read that cannot
    // resolve is a broken source, and the station turns it into a ToolErr.
    const { bucket } = stub({ objects: MINI })
    await expect(StoragePrefixSource(bucket, PREFIX).read('mini_missing.csv')).rejects.toThrow(
      /Object not found/,
    )
  })

  it('throws when the download fails, naming the entry and the export', async () => {
    const { bucket } = stub({
      objects: MINI,
      downloadErrors: { 'mini_internal.csv': 'signature expired' },
    })
    await expect(StoragePrefixSource(bucket, PREFIX).read('mini_internal.csv')).rejects.toThrow(
      /mini_internal\.csv.*signature expired/,
    )
  })

  it('distinguishes a failed read from an empty file', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. An empty CSV parses as a report that found
    // nothing; a failed read means we do not know what the report said. Collapsing them —
    // returning empty bytes on error, or throwing on an empty body — turns a broken source
    // into a clean-looking one, or a legitimately empty report into a station failure.
    const { bucket } = stub({
      objects: { ...MINI, 'mini_empty.csv': new Uint8Array(0) },
      downloadErrors: { 'mini_broken.csv': 'network error' },
    })
    const source = StoragePrefixSource(bucket, PREFIX)

    const empty = await source.read('mini_empty.csv')
    expect(empty).toBeInstanceOf(Uint8Array)
    expect(empty.byteLength).toBe(0)

    await expect(source.read('mini_broken.csv')).rejects.toThrow(/network error/)
  })

  it.each(['../secrets.env', '/etc/passwd', 'hints/../../secrets.env', 'hints\\x.csv', ''])(
    'refuses the unsafe entry name %j before it reaches storage',
    async (name) => {
      const { bucket, downloadCalls } = stub({ objects: MINI })
      await expect(StoragePrefixSource(bucket, PREFIX).read(name)).rejects.toThrow(
        /unsafe export entry name/,
      )
      // The guard runs BEFORE the key is concatenated onto the prefix — the point is that
      // the request is never made, not that it fails.
      expect(downloadCalls).toEqual([])
    },
  )
})
