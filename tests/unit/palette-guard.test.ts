import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// A ratchet, not a gate.
//
// The rebrand's stage 1 assumed every colour routed through CSS variables, so
// swapping the variable values would re-skin the app. It didn't: files using raw
// Tailwind palette classes bypassed the tokens entirely and kept rendering
// light-theme status colours on an ink surface — emerald-500 deltas being the
// loudest example.
//
// So this counts what's left and fails if the number goes UP. Each sweep slice
// lowers BUDGET. Without it the next new file quietly reintroduces the problem and
// nobody notices until a screenshot looks wrong.
//
// Two things this deliberately does NOT do: it doesn't fail the build on the
// existing debt (that would block every unrelated commit until the sweep finishes),
// and it doesn't try to parse JSX. It's a text scan, which is the right fidelity for
// "did someone type bg-rose-500 again".

const ROOT = join(__dirname, '..', '..')
// lib/ is included because it holds the token maps (lib/grade-tone.ts,
// lib/delta-tone.ts) and generated CSS strings. Omitting it is how a raw class in
// lib/ would go unnoticed — and lib/ was ALSO missing from tailwind.config.ts's
// content globs, which meant classes defined only there were never generated at all
// and the element rendered untinted. Both gaps are closed.
const SCAN_DIRS = ['app', 'components', 'lib']
const EXTS = ['.ts', '.tsx', '.css']

/**
 * Chromatic Tailwind families only.
 *
 * The neutrals (slate/gray/zinc/neutral/stone) are already at zero from the
 * earlier rebrand, so they're included to keep them there.
 */
const PALETTE = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  'slate', 'gray', 'zinc', 'neutral', 'stone',
]

const CLASS_RE = new RegExp(
  `\\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow|decoration|accent|caret|placeholder)-(?:${PALETTE.join('|')})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`,
  'g',
)

/**
 * Violet specifically is banned outright, not ratcheted — it was the old brand and
 * the spec's first "don't" is no violet anywhere, "including just this one chart".
 *
 * Covers the eight hexes the spec's grep gate names, plus the `violet-*` and
 * `purple-*` Tailwind families, which the ratchet alone would merely tolerate.
 */
// The `#` is optional: docx/xlsx writers pass bare hexes, which is how
// lib/seo-content-engine/docx-writer.ts kept shipping the old violet accent into
// every client .docx long after the app itself was clean. Note this regex matches
// its own source, so never write one of these literals in a comment.
const VIOLET_HEX_RE = /#?\b(?:8B5CF6|A78BFA|7C3AED|C4B5FD|DDD6FE|EDE9FE|4C1D95|6D28D9|9333EA|5B21B6|F5F3FF)\b/gi
const VIOLET_CLASS_RE = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide)-(?:violet|purple)-\d{2,3}\b/g

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(full)
  }
  return out
}

function scan(re: RegExp): { file: string; hits: string[] }[] {
  const found: { file: string; hits: string[] }[] = []
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const hits = readFileSync(file, 'utf8').match(new RegExp(re.source, re.flags))
      if (hits?.length) found.push({ file: relative(ROOT, file), hits })
    }
  }
  return found
}

/**
 * Occurrences of raw palette classes still to be swept, across 47 files.
 *
 * Set to the exact current count, so ANY new one fails immediately — slack here
 * would let a handful creep back in unnoticed. LOWER IT as sweep slices land; never
 * raise it. If a change pushes the count up, the fix is a token, not a bigger number.
 *
 * 348 at the start; 302 after session 1; 191 after the status-chip sweep. Of what is
 * left, 135 sits in app/(dashboard)/tools/ (internal) and 56 everywhere else. The worst
 * files (TfkGeneratorClient 36, PipelineProgress 24, SeoContentEngineClient 19) are 79
 * between them and are all internal tool screens.
 */
const BUDGET = 191

describe('palette regression guard', () => {
  it('does not add raw Tailwind palette classes', () => {
    const found = scan(CLASS_RE)
    const total = found.reduce((n, f) => n + f.hits.length, 0)

    if (total > BUDGET) {
      const worst = [...found]
        .sort((a, b) => b.hits.length - a.hits.length)
        .slice(0, 10)
        .map((f) => `  ${f.file}  (${f.hits.length})`)
        .join('\n')
      throw new Error(
        `Raw palette classes rose to ${total}, over the budget of ${BUDGET}.\n` +
          `Use a design token instead: success / error / warning / surface-* / brand-*.\n` +
          `Worst files:\n${worst}`,
      )
    }
    expect(total).toBeLessThanOrEqual(BUDGET)
  })

  it('has no violet anywhere — the old brand, banned outright', () => {
    expect(scan(VIOLET_HEX_RE).map((f) => f.file)).toEqual([])
    expect(scan(VIOLET_CLASS_RE).map((f) => f.file)).toEqual([])
  })

  // The bug that motivated adding lib/ to SCAN_DIRS: a class defined only in lib/
  // was never generated by Tailwind, because lib/ was outside its content globs, so
  // the C/D grade chips rendered with no background and no border.
  it('keeps every scanned dir inside tailwind content globs', () => {
    const config = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8')
    for (const dir of SCAN_DIRS) {
      expect(config, `tailwind content globs must include ./${dir}`).toMatch(
        new RegExp(`["']\\./${dir}/\\*\\*`),
      )
    }
  })

  // The KpiCard sienna number was an inline style, not a class, so a class-only
  // check would have declared the file clean while it rendered off-spec.
  it('keeps inline style colours off the exec band and its row', () => {
    for (const file of ['components/ui/LedgerRow.tsx', 'components/ui/KpiCard.tsx']) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      // Inline colour is allowed only via a var(--token); never a literal.
      const literals = src.match(/(?:color|background(?:Color)?)\s*:\s*['"]#[0-9a-f]{3,8}/gi)
      expect(literals, `${file} hardcodes a colour in an inline style`).toBeNull()
      expect(src, `${file} still paints the value with the accent`).not.toMatch(
        /color:\s*'var\(--color-accent\)'/,
      )
    }
  })

  // Checks USE, not merely import. A substring match on 'lib/delta-tone' would pass
  // for a file that imported the module and ignored it, or that only named it in a
  // comment — which proves nothing about what colour renders.
  it('routes every delta through the shared tone module', () => {
    const deltaFiles = [
      'components/ui/DeltaChip.tsx',
      'components/dashboard/modules/MetricTable13.tsx',
      'components/home/AdminTriageStrip.tsx',
      'app/(dashboard)/dashboard/DashboardTabs.tsx',
      'components/analytics/seo/searchconsole/GscQueriesTable.tsx',
      'components/analytics/seo/searchconsole/GscUrlsTable.tsx',
    ]
    for (const file of deltaFiles) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src, `${file} must import from lib/delta-tone`).toMatch(
        /import\s*\{[^}]*\}\s*from\s*['"]@\/lib\/delta-tone['"]/,
      )
      // The tone map has to be indexed, which is the only way it affects output.
      expect(src, `${file} imports delta-tone but never indexes DELTA_TONE_TEXT`).toMatch(
        /DELTA_TONE_TEXT\[/,
      )
      // And no file may still pick a delta colour by hand.
      expect(
        src.match(/\b(?:text|bg|border)-(?:emerald|rose|green|red)-\d{2,3}\b/g),
        `${file} still chooses a delta colour directly`,
      ).toBeNull()
    }
  })
})
