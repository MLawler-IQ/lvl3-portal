// The export source seam.
//
// The properties worth pinning are the two that keep a broken export from reading as a
// merely incomplete one: list() is the only thing that reports absence, and read() throws.
// Everything else here is encoding — the BOM case that used to make every row's URL
// undefined, and the one-decode-site rule that keeps both source kinds agreeing about it.

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  BufferSource,
  LocalDirSource,
  readCsv,
  readText,
  type CrawlExportSource,
} from '@/lib/ingest/sitebulb/source'

const DIR = join(__dirname, '..', '..', 'fixtures', 'ingest', 'sitebulb-mini')

/** The mini fixture as a BufferSource, so a test can omit one file from it. */
async function miniBuffers(): Promise<Map<string, Uint8Array>> {
  const dir = LocalDirSource(DIR)
  const out = new Map<string, Uint8Array>()
  for (const name of await dir.list()) {
    out.set(name, await dir.read(name))
  }
  return out
}

describe('LocalDirSource', () => {
  it('lists top-level entries and one level of subdirectory, forward-slashed', async () => {
    const names = await LocalDirSource(DIR).list()
    expect(names).toContain('mini_internal.csv')
    expect(names).toContain('mini_indexability.csv')
    expect(names).toContain('mini_mobile_friendly.csv')
    expect(names).toContain('hints/mini_url_contains_no_google_analytics_code.csv')
    // Nothing bare from the subdirectory — a `hints/`-less name would defeat the
    // suffix matching that has to work identically for a zip.
    expect(names).not.toContain('mini_url_contains_no_google_analytics_code.csv')
  })

  it('memoizes the listing so two ingesters cannot disagree about what exists', async () => {
    const source = LocalDirSource(DIR)
    const [a, b] = [await source.list(), await source.list()]
    expect(a).toBe(b) // identity, not just equality: one readdir sweep
  })

  it('reads a nested entry by its source-relative name', async () => {
    const bytes = await LocalDirSource(DIR).read(
      'hints/mini_url_contains_no_google_analytics_code.csv',
    )
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('throws on an entry that does not exist rather than reporting absence', async () => {
    // The distinction this seam exists for: absence is list()'s job. A read that
    // cannot resolve is a broken source, and the station turns it into a ToolErr.
    await expect(LocalDirSource(DIR).read('mini_nonexistent.csv')).rejects.toThrow()
  })

  it.each(['../secrets.env', '/etc/passwd', 'hints/../../secrets.env', 'hints\\x.csv', ''])(
    'refuses the unsafe entry name %j',
    async (name) => {
      await expect(LocalDirSource(DIR).read(name)).rejects.toThrow(/unsafe export entry name/)
    },
  )
})

describe('BufferSource', () => {
  it('lists exactly its keys', async () => {
    const source = BufferSource(new Map([['a.csv', new Uint8Array()]]))
    expect(await source.list()).toEqual(['a.csv'])
  })

  it('throws for a name that is not in the map', async () => {
    const source = BufferSource(new Map(), 'test export')
    await expect(source.read('a.csv')).rejects.toThrow(/is not in test export/)
  })

  it('carries a label into its errors so an operator knows which export failed', async () => {
    await expect(BufferSource(new Map(), 'upload.zip').read('a.csv')).rejects.toThrow(/upload\.zip/)
    expect(BufferSource(new Map()).label).toBe('in-memory export')
  })

  it('reproduces the local source byte for byte, so encoding cannot diverge', async () => {
    const buffers = BufferSource(await miniBuffers(), 'mini-as-buffers')
    const local = LocalDirSource(DIR)
    expect((await buffers.list()).sort()).toEqual((await local.list()).sort())
    for (const name of await buffers.list()) {
      expect(await buffers.read(name)).toEqual(await local.read(name))
    }
  })
})

describe('readText / readCsv', () => {
  const sources = async (): Promise<[string, CrawlExportSource][]> => [
    ['LocalDirSource', LocalDirSource(DIR)],
    ['BufferSource', BufferSource(await miniBuffers())],
  ]

  it('strips the BOM, which is what makes row.URL defined at all', async () => {
    // The fixture is deliberately BOM+CRLF (see the ingest test's header). Left in
    // place the BOM joins the first header name and every row's URL is undefined.
    const raw = await readFile(join(DIR, 'mini_internal.csv'))
    expect(raw[0]).toBe(0xef) // the file really does carry one
    for (const [name, source] of await sources()) {
      const table = await readCsv(source, 'mini_internal.csv')
      expect(table.header[0], name).toBe('URL')
      expect(table.rows.every((r) => typeof r['URL'] === 'string'), name).toBe(true)
    }
  })

  it('decodes identically from either source kind', async () => {
    const [[, local], [, buffers]] = await sources()
    expect(await readText(buffers, 'mini_internal.csv')).toBe(
      await readText(local, 'mini_internal.csv'),
    )
  })
})
