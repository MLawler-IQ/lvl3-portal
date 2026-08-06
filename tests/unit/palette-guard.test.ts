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
const SCAN_DIRS = ['app', 'components']
const EXTS = ['.ts', '.tsx']

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
 */
const VIOLET_HEX_RE = /#(?:8B5CF6|A78BFA|7C3AED|C4B5FD|DDD6FE|EDE9FE|4C1D95|6D28D9)\b/gi

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
 * Occurrences of raw palette classes still to be swept, across 60 files.
 *
 * Set to the exact current count, so ANY new one fails immediately — slack here
 * would let a handful creep back in unnoticed. LOWER IT as sweep slices land; never
 * raise it. If a change pushes the count up, the fix is a token, not a bigger number.
 *
 * For scale: 40% of the remainder sits in app/(dashboard)/tools/, and the three worst
 * files (TfkGeneratorClient, PipelineProgress, SeoContentEngineClient) are 79 between
 * them.
 */
const BUDGET = 302

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
    const found = scan(VIOLET_HEX_RE)
    expect(found.map((f) => f.file)).toEqual([])
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
      expect(src, `${file} should import from lib/delta-tone`).toMatch(/lib\/delta-tone/)
    }
  })
})
