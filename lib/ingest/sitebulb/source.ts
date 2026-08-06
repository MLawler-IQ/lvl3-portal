// Where a Sitebulb export's bytes come from. The only IO the ingesters do.
//
// WHY A SEAM AT ALL. `ingestSitebulbCrawl` and `readSitebulbManifest` both used to call
// readdir/readFile directly against a directory path. That works for a local fixture and
// for nothing else: the upload path parses a zip in-request with no directory anywhere
// (no storage bucket, by design), and a Vercel function has no writable tree to extract
// one into. Both ingesters now take a source, so the same code reads a fixture directory,
// an uploaded zip, or an in-memory map built by a test.
//
// TWO RULES.
//
// 1. `list()` IS THE SOLE AUTHORITY ON ABSENCE. `read()` never reports "not there" — it
//    throws. That split matters because the two failures mean opposite things downstream:
//    a file absent from `list()` is a MISSING SIGNAL (it lands in `filesMissing` and
//    degrades the station), while a file that is listed but unreadable is a BROKEN SOURCE
//    (a truncated zip, a permissions fault) and must surface as a ToolErr. Collapsing them
//    would let a corrupt export masquerade as a merely incomplete one.
//
// 2. BYTES ON THE INTERFACE, TEXT AS A FREE FUNCTION. `manifest.ts` needs bytes for
//    XLSX.read; everything else needs UTF-8. A `readText` MEMBER alongside `read` would
//    let two implementations disagree about decoding — which is the exact class of bug
//    csv.ts's header comment is about (a BOM left in place makes row['URL'] undefined for
//    every row of every file and the ingest silently produces empty pages). As a free
//    function there is one decode site in the repo.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCsv, toTable, type CsvTable } from './csv'

export interface CrawlExportSource {
  /**
   * A stable human label for error messages — a directory path, a zip filename.
   *
   * Exists because the backbone error interpolates it: an operator who is told "this
   * export has no *_internal.csv" needs to know WHICH export.
   */
  readonly label: string
  /**
   * Every entry, source-relative and forward-slashed, including `hints/x.csv`.
   *
   * Forward slashes regardless of platform, because zip entry names use them and the
   * suffix matching in crawl.ts is shared between both source kinds.
   */
  list(): Promise<string[]>
  /** One entry's raw bytes. Throws when unreadable — callers wrap in runGuarded. */
  read(name: string): Promise<Uint8Array>
}

/**
 * One entry as UTF-8 text.
 *
 * TextDecoder strips a leading BOM, and parseCsv strips one at position 0, so the second
 * strip is a no-op today. Both are kept: if this ever becomes `Buffer.toString('utf8')`
 * (which preserves the BOM) parseCsv is still the backstop.
 */
export async function readText(source: CrawlExportSource, name: string): Promise<string> {
  return new TextDecoder('utf-8').decode(await source.read(name))
}

/** One entry parsed as a Sitebulb CSV. */
export async function readCsv(source: CrawlExportSource, name: string): Promise<CsvTable> {
  return toTable(parseCsv(await readText(source, name)))
}

/**
 * Reject a name that could escape the source root.
 *
 * Not needed for today's callers — every name handed to `read` came out of `list` — but
 * slice 3 feeds zip entry names into a source, and a Map lookup is traversal-proof by
 * construction while a filesystem join is not. This is the guard for the filesystem side;
 * it is NOT the zip validator, which is its own thing.
 */
function assertSafeName(name: string, label: string): void {
  if (
    name.length === 0 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').includes('..')
  ) {
    throw new Error(`Refusing to read unsafe export entry name ${JSON.stringify(name)} from ${label}`)
  }
}

/**
 * An export unpacked on disk.
 *
 * Recursion is deliberately ONE level deep, reproducing what the export actually looks
 * like: the top level holds the per-report CSVs and the summary workbook, while triggered
 * hints live in `hints/`. A general walk would add a code path no export exercises.
 */
export function LocalDirSource(dir: string): CrawlExportSource {
  // Memoized because both ingesters call list(), and two readdir sweeps of the same
  // directory can legitimately disagree — which would put the manifest and the crawl
  // ingest at odds about which files exist.
  let cached: Promise<string[]> | null = null

  return {
    label: dir,
    list() {
      cached ??= (async () => {
        const out: string[] = []
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            for (const nested of await readdir(join(dir, entry.name))) {
              out.push(`${entry.name}/${nested}`)
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
      assertSafeName(name, dir)
      return new Uint8Array(await readFile(join(dir, ...name.split('/'))))
    },
  }
}

/**
 * An export held in memory: an uploaded zip's entries, or a test's hand-built map.
 *
 * Keys are source-relative names exactly as `list()` reports them.
 */
export function BufferSource(
  files: Map<string, Uint8Array>,
  label = 'in-memory export',
): CrawlExportSource {
  return {
    label,
    async list() {
      return Array.from(files.keys())
    },
    async read(name) {
      const bytes = files.get(name)
      if (bytes === undefined) {
        // list() is the authority on absence, so reaching here means the caller invented
        // a name rather than reading one out of the listing.
        throw new Error(`Export entry ${JSON.stringify(name)} is not in ${label}`)
      }
      return bytes
    },
  }
}
