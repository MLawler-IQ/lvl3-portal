import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKS, CHECK_IDS } from '@/lib/findings/checks'
import { runChecks } from '@/lib/findings/engine'
import type { StationBundle } from '@/lib/findings/types'
import { loadManifest } from '@/lib/eval/manifest'
import { scoreCase } from '@/lib/eval/score'
import { formatLintReport, lintFixture, type LintRule } from '@/lib/eval/lint'
import { toolErr, toolOk } from '@/lib/tools/contract'
import type { CrawlStationData, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import {
  ALL_ENCODINGS,
  H1_ENCODINGS,
  KNOWN_UNCOVERED_ENCODINGS,
  REGISTERED_CHECK_IDS,
  SCENARIOS,
  SCENARIO_IDS,
  generateFixture,
  generateSuite,
  makeRng,
  readMagnitude,
  type GeneratedFixture,
} from '@/lib/eval/injectors'

// Tests for the causal scenario-template injectors.
//
// The last describe block is the one that carries the argument. The injectors were
// written from docs/rubric/rubric.json's check/howToTest/notes text, and the
// detectors in lib/findings/checks.ts were written separately from the same rubric.
// Neither was derived from the other. When a generated fixture's manifest — whose
// magnitudes come from the rubric-derived predicates — matches what runChecks
// actually produces, that agreement is evidence about the pipeline rather than a
// tautology. Where they DISAGREE it is also evidence, which is why the measured
// gaps are asserted rather than papered over.

const ROOT = join(__dirname, '..', '..')
const SEED = 4271

/** Deep-copy a fixture so a corruption test cannot leak into another test. */
function clone(fx: GeneratedFixture): GeneratedFixture {
  const data = JSON.parse(JSON.stringify(fx.data)) as GeneratedFixture['data']
  return {
    ...fx,
    data,
    manifest: JSON.parse(JSON.stringify(fx.manifest)) as GeneratedFixture['manifest'],
    stations: {
      crawl: toolOk({ site: data.site, pages: data.pages }, { sources: ['crawl'] }),
      gsc: toolOk(data.gsc, { sources: ['gsc'] }),
      gbp: toolOk(data.gbp, { sources: ['gbp'] }),
    },
  }
}

/** Re-wrap mutated raw data into a station bundle, as a live run would. */
function rewrap(data: {
  site: CrawlStationData['site']
  pages: CrawlStationData['pages']
  gsc: GSCRow[]
  gbp: GbpProfileRecord
}): StationBundle {
  return {
    crawl: toolOk({ site: data.site, pages: data.pages }, { sources: ['crawl'] }),
    gsc: toolOk(data.gsc, { sources: ['gsc'] }),
    gbp: toolOk(data.gbp, { sources: ['gbp'] }),
  }
}

function lint(fx: GeneratedFixture) {
  return lintFixture({ stations: fx.stations, manifest: fx.manifest })
}

function rules(fx: GeneratedFixture): LintRule[] {
  return lint(fx).violations.map((v) => v.rule)
}

// ---------------------------------------------------------------------------

describe('seeded PRNG', () => {
  it('is a pure function of its seed', () => {
    const draws = (seed: string): number[] =>
      Array.from({ length: 24 }, (_, i) => makeRng(seed).derive(`s${i}`).next())
    expect(draws('abc')).toEqual(draws('abc'))
    expect(draws('abc')).not.toEqual(draws('abd'))
  })

  it('never touches Math.random or the clock', () => {
    // Structural, not behavioural: nothing under lib/eval/injectors/ may reach for
    // ambient nondeterminism, because a fixture that changes between runs makes the
    // eval gate flaky and a flaky gate gets deleted rather than fixed.
    const rng = makeRng('x')
    const before = Math.random
    Math.random = (): number => {
      throw new Error('generator reached for Math.random')
    }
    try {
      expect(() => generateSuite(1)).not.toThrow()
      expect(() => rng.shuffle([1, 2, 3, 4, 5])).not.toThrow()
    } finally {
      Math.random = before
    }
  })

  it('derives independent sub-streams', () => {
    const parent = makeRng('scenario@1')
    expect(parent.derive('h1').next()).not.toEqual(parent.derive('geo').next())
    expect(parent.derive('h1').next()).toEqual(makeRng('scenario@1/h1').next())
  })

  it('produces integers inside the requested inclusive range', () => {
    const rng = makeRng('range')
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 7)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(7)
      expect(Number.isInteger(n)).toBe(true)
    }
  })
})

describe('generator determinism', () => {
  it('same seed produces an identical fixture, station data and manifest alike', () => {
    for (const id of SCENARIO_IDS) {
      const a = generateFixture(id, SEED)
      const b = generateFixture(id, SEED)
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a))
    }
  })

  it('different seeds produce different defect combinations', () => {
    const signatures = new Set<string>()
    const encodingMixes = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      for (const fx of generateSuite(seed)) {
        signatures.add(
          `${fx.scenarioId}|${fx.variant}|${fx.data.pages.length}|${JSON.stringify(fx.manifest.must_find)}`,
        )
        encodingMixes.add(`${fx.scenarioId}|${JSON.stringify(fx.encodingsUsed)}`)
      }
    }
    // 12 seeds x 8 cases. If the seed did not reach the injectors, both sets would
    // collapse to 8.
    expect(signatures.size).toBeGreaterThan(40)
    expect(encodingMixes.size).toBeGreaterThan(40)
  })

  it('varies which surface encoding stands in for a defect', () => {
    // The anti-memorisation property: over a range of seeds every one of the five
    // ONPAGE-003 surface encodings gets exercised, so a detector shaped to a single
    // encoding of "missing H1" cannot score 100%.
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      for (const id of SCENARIO_IDS) {
        const fx = generateFixture(id, seed, { scope: 'rubric' })
        for (const enc of fx.encodingsUsed['ONPAGE-003'] ?? []) seen.add(enc)
      }
    }
    for (const enc of H1_ENCODINGS) {
      expect(seen, `encoding ${enc.id} never appeared across 20 seeds`).toContain(enc.id)
    }
  })

  it('scopes the stream label, so a scope switch is not a silent re-roll of everything', () => {
    const covered = generateFixture('ai-page-spree', SEED, { scope: 'detector-covered' })
    const rubric = generateFixture('ai-page-spree', SEED, { scope: 'rubric' })
    expect(rubric.encodingsUsed['ONPAGE-003']).not.toEqual(covered.encodingsUsed['ONPAGE-003'])
  })
})

describe('scenario templates', () => {
  it('every template documents the real failure mode it encodes', () => {
    for (const template of SCENARIOS) {
      expect(template.story.length, template.id).toBeGreaterThan(200)
      expect(template.cluster.length, `${template.id} must violate a CLUSTER, not one check`)
        .toBeGreaterThan(1)
      expect(template.fpTraps.length, `${template.id} needs a false-positive trap`).toBeGreaterThan(0)
    }
  })

  it('there are three to four templates, drawn from distinct causes', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(3)
    expect(SCENARIOS.length).toBeLessThanOrEqual(4)
    expect(new Set(SCENARIO_IDS).size).toBe(SCENARIOS.length)
  })

  it('no template asserts a check outside its own cluster', () => {
    for (const template of SCENARIOS) {
      for (const id of template.cluster) {
        expect(template.fpTraps, `${template.id}: ${id} is both cluster and FP trap`).not.toContain(id)
      }
    }
  })

  it('every encoding names the real-world configuration it stands for', () => {
    for (const enc of ALL_ENCODINGS) {
      expect(enc.note.length, enc.id).toBeGreaterThan(40)
      expect(CHECK_IDS.has(enc.checkId), `${enc.id} → ${enc.checkId}`).toBe(true)
    }
  })
})

describe('generated manifests', () => {
  const suite = generateSuite(SEED)

  it('covers every scenario in both variants', () => {
    expect(suite).toHaveLength(SCENARIOS.length * 2)
    expect(new Set(suite.map((f) => f.variant))).toEqual(new Set(['defect', 'near-miss']))
  })

  for (const fx of suite) {
    it(`${fx.manifest.case} satisfies every loader rule`, () => {
      // Written to disk and loaded through the real loader, so the generator cannot
      // drift from lib/eval/manifest.ts's validation without this going red.
      const dir = mkdtempSync(join(tmpdir(), 'eval-generated-'))
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(fx.manifest, null, 2))
      const loaded = loadManifest(dir, ROOT)
      expect(loaded).toEqual(fx.manifest)

      // Every must_find carries a REQUIRED magnitude with a real metric.
      for (const entry of loaded.must_find) {
        expect(entry.magnitude.expected).toBeGreaterThan(0)
        expect(['affectedUrls', 'value']).toContain(entry.magnitude.metric)
      }
      expect(loaded.must_not_find.length).toBeGreaterThan(0)
      // Only checks with a registered detector — no manifest may demand what nothing
      // can produce.
      for (const id of [
        ...loaded.must_find.map((e) => e.id),
        ...loaded.must_not_find,
        ...loaded.must_pass,
      ]) {
        expect(CHECK_IDS.has(id), id).toBe(true)
      }
    })
  }

  // The guarantee the test below states is only as wide as REGISTERED_CHECK_IDS, so that
  // list drifting away from CHECK_IDS silently narrows it. That is exactly what happened:
  // ONPAGE-012 was in CHECK_IDS and not in REGISTERED_CHECK_IDS, so every generated
  // manifest asserted nothing about it in either variant, and a detector/predicate
  // disagreement the harness exists to catch sat there unnoticed.
  it('REGISTERED_CHECK_IDS equals CHECK_IDS — no silently-unasserted check', () => {
    expect(new Set(REGISTERED_CHECK_IDS)).toEqual(CHECK_IDS)
  })

  it('asserts every non-cluster check as must_pass, so a half-dead pipeline cannot score well', () => {
    for (const fx of suite) {
      const asserted = new Set([
        ...fx.manifest.must_find.map((e) => e.id),
        ...fx.manifest.must_pass,
      ])
      for (const id of REGISTERED_CHECK_IDS) expect(asserted, `${fx.manifest.case}/${id}`).toContain(id)
    }
  })

  it('generates genuinely template-dominated content, and ONPAGE-012 now catches it', () => {
    // This test used to assert ONPAGE-012 had no detector and was merely RECORDED, in a
    // `unassertable` field nothing read. The detector is registered, the id is in
    // REGISTERED_CHECK_IDS, and the dead field is gone.
    const spree = generateFixture('ai-page-spree', SEED, { variant: 'defect' })
    expect(CHECK_IDS.has('ONPAGE-012')).toBe(true)

    const generated = spree.data.pages.filter((p) => p.templateGroup === 'service-generated')
    expect(generated.length).toBeGreaterThan(10)
    for (const page of generated) {
      expect(page.uniqueWordCount / page.wordCount).toBeLessThan(0.35)
    }

    const finding = runChecks(CHECKS, spree.stations).find((f) => f.checkId === 'ONPAGE-012')!
    expect(finding.status).toBe('fail')
    expect(finding.evidence.affectedUrls).toBeGreaterThanOrEqual(generated.length)
  })
})

describe('fixture linter', () => {
  it('passes every generated fixture, at several seeds and both scopes', () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const scope of ['detector-covered', 'rubric'] as const) {
        for (const fx of generateSuite(seed, scope)) {
          const report = lint(fx)
          expect(report.ok, `${fx.manifest.case}\n${formatLintReport(report)}`).toBe(true)
          expect(report.violations).toEqual([])
        }
      }
    }
  })

  it('passes the hand-written tornado and healthy fixtures too', async () => {
    // The linter has to be usable on fixtures it did not generate, or it only ever
    // validates its own output.
    const { tornadoStations } = await import('../../fixtures/eval/tornado/stations')
    const { healthyStations } = await import('../../fixtures/eval/healthy/stations')
    for (const [name, dir, stations] of [
      ['tornado', 'tornado', tornadoStations()],
      ['healthy', 'healthy', healthyStations()],
    ] as const) {
      const manifest = loadManifest(join(ROOT, 'fixtures', 'eval', dir), ROOT)
      const report = lintFixture({ stations, manifest })
      expect(report.ok, `${name}\n${formatLintReport(report)}`).toBe(true)
    }
  })

  it('never throws — it returns structured violations', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.data.pages = []
    fx.stations = rewrap(fx.data)
    expect(() => lint(fx)).not.toThrow()
    expect(rules(fx)).toContain('crawl-station-unusable')
  })

  it('rejects a GSC row for a URL the crawl never saw', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.data.gsc.push({
      query: 'ghost query',
      page: 'https://valleyair-hvac.example/does-not-exist/',
      clicks: 4,
      impressions: 900,
      ctr: 0.4,
      position: 6,
    })
    fx.stations = rewrap(fx.data)
    const report = lint(fx)
    expect(report.ok).toBe(false)
    expect(report.violations.map((v) => v.rule)).toContain('gsc-page-not-in-crawl')
  })

  it('rejects a robots-blocked page that carries impressions', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    const ranking = fx.data.gsc.find((r) => r.impressions > 0)!
    const page = fx.data.pages.find((p) => p.url === ranking.page)!
    page.robotsMeta = 'noindex,follow'
    fx.stations = rewrap(fx.data)
    const report = lint(fx)
    expect(report.ok).toBe(false)
    expect(report.violations.map((v) => v.rule)).toContain('blocked-page-has-impressions')
  })

  it('rejects an error page that carries impressions', () => {
    const fx = clone(generateFixture('migration-gone-wrong', SEED))
    const ranking = fx.data.gsc.find((r) => r.impressions > 0)!
    fx.data.pages.find((p) => p.url === ranking.page)!.status = 410
    fx.stations = rewrap(fx.data)
    expect(rules(fx)).toContain('error-page-has-impressions')
  })

  it('rejects an implausible targetGeo', () => {
    const fx = clone(generateFixture('gbp-misconfig', SEED))
    fx.data.pages.find((p) => p.targetGeo !== null)!.targetGeo = 'anaheim'
    fx.stations = rewrap(fx.data)
    const report = lint(fx)
    expect(report.ok).toBe(false)
    const violation = report.violations.find((v) => v.rule === 'implausible-target-geo')
    expect(violation?.detail).toContain("'City, ST'")
  })

  it('rejects a duplicated crawl URL', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.data.pages.push({ ...fx.data.pages[3] })
    fx.stations = rewrap(fx.data)
    expect(rules(fx)).toContain('duplicate-crawl-url')
  })

  it('rejects a same-origin canonical pointing at a URL not in the crawl', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.data.pages[2].canonical = 'https://valleyair-hvac.example/vanished/'
    fx.stations = rewrap(fx.data)
    expect(rules(fx)).toContain('same-origin-canonical-missing')
  })

  it('permits a cross-origin canonical, which a botched migration really does leave behind', () => {
    const fx = generateFixture('migration-gone-wrong', SEED)
    const crossOrigin = fx.data.pages.filter(
      (p) => p.canonical !== null && !p.canonical.startsWith('https://northstar-roofing.example'),
    )
    expect(crossOrigin.length).toBeGreaterThan(0)
    expect(lint(fx).ok).toBe(true)
  })

  it('rejects more clicks than impressions', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.data.gsc[0].clicks = fx.data.gsc[0].impressions + 5
    fx.stations = rewrap(fx.data)
    expect(rules(fx)).toContain('gsc-row-impossible')
  })

  // THE IMPORTANT ONE: a manifest that disagrees with its own station data.
  it('rejects a manifest magnitude the station data does not contain', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.manifest.must_find[0].magnitude.expected += 7
    const report = lint(fx)
    expect(report.ok).toBe(false)
    const violation = report.violations.find((v) => v.rule === 'magnitude-mismatch')
    expect(violation?.subject).toBe(fx.manifest.must_find[0].id)
    expect(violation?.detail).toContain('the station data contains')
  })

  it('rejects a manifest asserting the wrong evidence metric for a check', () => {
    const fx = clone(generateFixture('gbp-misconfig', SEED))
    const entry = fx.manifest.must_find.find((e) => e.id === 'LOCAL-003')!
    entry.magnitude.metric = 'affectedUrls'
    expect(rules(fx)).toContain('magnitude-mismatch')
  })

  it('rejects a must_not_find whose defect is actually present in the data', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    // ONPAGE-006 is a declared false-positive trap here; put real cannibalisation
    // in the data and the manifest becomes unsatisfiable.
    const [a, b] = fx.data.pages.filter((p) => p.status === 200).slice(0, 2)
    for (const page of [a, b]) {
      fx.data.gsc.push({
        query: 'shared query',
        page: page.url,
        clicks: 1,
        impressions: 400,
        ctr: 0.3,
        position: 20,
      })
    }
    fx.stations = rewrap(fx.data)
    expect(rules(fx)).toContain('must-not-find-violated-by-data')
  })

  it('rejects a must_pass whose defect is actually present in the data', () => {
    const fx = clone(generateFixture('gbp-misconfig', SEED))
    // ONPAGE-003 is in must_pass for this scenario; break one page's H1.
    fx.data.pages[1].h1s = []
    fx.stations = rewrap(fx.data)
    expect(rules(fx)).toContain('must-pass-violated-by-data')
  })

  it('rejects an id with no registered detector', () => {
    // Was ONPAGE-012, which the integration pass registered. Picked from the rubric
    // at runtime so this test cannot go stale the next time a detector lands.
    const fx = clone(generateFixture('template-bug', SEED))
    const unregistered = (
      JSON.parse(
        readFileSync(join(__dirname, '..', '..', 'docs/rubric/rubric.json'), 'utf8'),
      ) as { id: string }[]
    ).find((c) => !CHECK_IDS.has(c.id))!
    expect(unregistered, 'every rubric check has a detector — pick a new probe').toBeDefined()
    fx.manifest.must_pass.push(unregistered.id)
    expect(rules(fx)).toContain('unknown-check-id')
  })

  it('rejects a fixture with no false-positive assertion', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.manifest.must_not_find = []
    expect(rules(fx)).toContain('empty-must-not-find')
  })

  it('rejects an unsatisfiable manifest and a duplicated list entry', () => {
    const conflict = clone(generateFixture('template-bug', SEED))
    conflict.manifest.must_not_find.push(conflict.manifest.must_find[0].id)
    expect(rules(conflict)).toContain('manifest-conflict')

    const dupe = clone(generateFixture('template-bug', SEED))
    dupe.manifest.must_pass.push(dupe.manifest.must_pass[0])
    expect(rules(dupe)).toContain('manifest-conflict')
  })

  it('skips rules it cannot run rather than inventing a verdict', () => {
    const fx = clone(generateFixture('template-bug', SEED))
    fx.stations = { ...fx.stations, gsc: toolErr('GSC auth expired', { sources: ['gsc'] }) }
    const report = lint(fx)
    expect(report.skipped.some((s) => s.includes('gsc'))).toBe(true)
    expect(report.violations.map((v) => v.rule)).not.toContain('gsc-page-not-in-crawl')
  })
})

// ---------------------------------------------------------------------------
// The test that proves the injectors and the detectors agree without either
// having been written from the other.
// ---------------------------------------------------------------------------

describe('generated fixtures score green against the real detectors', () => {
  for (const template of SCENARIOS) {
    it(`${template.id}: the pipeline finds exactly what the manifest claims`, () => {
      const fx = generateFixture(template.id, SEED, { variant: 'defect' })
      expect(lint(fx).ok, formatLintReport(lint(fx))).toBe(true)

      const findings = runChecks(CHECKS, fx.stations)
      const result = scoreCase(fx.manifest, findings)
      expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([])
      expect(result.pass).toBe(true)
      expect(result.recall).toEqual({
        satisfied: fx.manifest.must_find.length,
        total: fx.manifest.must_find.length,
      })
      // Recall over a cluster, not a single check — that is what a causal template
      // buys over independently sampled defects.
      expect(result.recall.total).toBeGreaterThan(1)
    })

    it(`${template.id}: the NEAR-MISS variant fires nothing — the precision half`, () => {
      const fx = generateFixture(template.id, SEED, { variant: 'near-miss' })
      expect(lint(fx).ok, formatLintReport(lint(fx))).toBe(true)
      expect(fx.manifest.must_find).toEqual([])
      // Every cluster check the defect variant asserts is now a must_not_find, and
      // every registered check must affirmatively pass.
      for (const id of template.cluster) expect(fx.manifest.must_not_find).toContain(id)
      expect(new Set(fx.manifest.must_pass)).toEqual(new Set(REGISTERED_CHECK_IDS))

      const result = scoreCase(fx.manifest, runChecks(CHECKS, fx.stations))
      expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([])
    })
  }

  it('holds across a range of seeds, not just the one it was written against', () => {
    for (let seed = 100; seed < 112; seed++) {
      for (const fx of generateSuite(seed)) {
        const result = scoreCase(fx.manifest, runChecks(CHECKS, fx.stations))
        expect(result.failures, `${fx.manifest.case}: ${JSON.stringify(result.failures)}`).toEqual([])
      }
    }
  })

  it('still bites: truncating the crawl trips the magnitude band', () => {
    // The generated fixtures inherit the property the hand-written ones have — an
    // ingester that silently truncates still "finds" the defect, and only the
    // magnitude catches it.
    const fx = generateFixture('ai-page-spree', SEED, { variant: 'defect' })
    const crawl = fx.stations.crawl!
    if (!crawl.ok) throw new Error('fixture crawl must be ok')
    const truncated: StationBundle = {
      ...fx.stations,
      crawl: toolOk({ site: crawl.data.site, pages: crawl.data.pages.slice(0, 8) }, { sources: ['crawl'] }),
    }
    const result = scoreCase(fx.manifest, runChecks(CHECKS, truncated))
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.checkId === 'ONPAGE-003' && f.kind === 'magnitude')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The gaps the injectors found on their first run. Asserted, not commented.
// ---------------------------------------------------------------------------

describe('measured detector gaps (scope: rubric)', () => {
  // Writing the injectors from the rubric instead of from lib/findings/checks.ts
  // was supposed to be able to surface places where the detectors are laxer than
  // the rubric. It did, immediately. Each gap below is recorded in
  // KNOWN_UNCOVERED_ENCODINGS and reproduced here, so that FIXING a detector turns
  // this block red and forces the exclusion to be deleted — the alternative, a
  // comment, rots silently.
  // HISTORY, worth keeping: writing the injectors from the rubric instead of from
  // lib/findings/checks.ts was supposed to be able to surface places where the
  // detectors were laxer than the rubric. It did, immediately, and the integration
  // pass then FIXED both — which turned this block red exactly as designed and
  // forced the exclusions to be deleted rather than left to rot in a comment.
  //
  // The gap assertions below are now inverted into REGRESSION GUARDS: if either
  // detector ever reverts to the lax reading, these fail.
  const EXPECTED_GAPS: Record<string, { checkId: string; kind: string }> = {}

  it('the rubric-scope fixtures still LINT CLEAN — the data and the manifest agree', () => {
    for (const id of SCENARIO_IDS) {
      const fx = generateFixture(id, SEED, { scope: 'rubric' })
      expect(lint(fx).ok, `${id}\n${formatLintReport(lint(fx))}`).toBe(true)
    }
  })

  it('ONPAGE-003 CATCHES an <h1> that exists but renders no text', () => {
    // Was: "misses". The detector counted h1s.length, so [""], ["   "] and an <h1>
    // wrapping only an image each read as one good heading. It now counts H1s
    // carrying usable text, so the rubric and the detector agree on all three.
    const base = generateFixture('template-bug', SEED, { scope: 'rubric' })
    const crawl = base.stations.crawl!
    if (!crawl.ok) throw new Error('bad fixture')
    for (const encId of ['h1-empty-string', 'h1-whitespace-only', 'h1-image-alt-only']) {
      const enc = H1_ENCODINGS.find((e) => e.id === encId)!
      const pages = crawl.data.pages.map((p, i) =>
        i === 1 ? enc.apply(p, makeRng('gap')) : { ...p, h1s: [`Heading ${i}`] },
      )
      const data = { site: crawl.data.site, pages }
      const rubricSays = readMagnitude('ONPAGE-003', { crawl: data })!
      const detectorSays = runChecks(CHECKS, {
        ...base.stations,
        crawl: toolOk(data, { sources: ['crawl'] }),
      }).find((f) => f.checkId === 'ONPAGE-003')!
      expect(rubricSays.count, encId).toBe(1)
      expect(detectorSays.status, `${encId} regressed to the lax h1s.length reading`).toBe('fail')
      expect(detectorSays.evidence.affectedUrls, encId).toBe(rubricSays.count)
      expect(KNOWN_UNCOVERED_ENCODINGS[encId], `${encId} is covered now`).toBeUndefined()
    }
  })

  it('ONPAGE-003 still accepts a real H1 padded with whitespace — the near miss', () => {
    // The other direction: an untrimmed equality test would call this blank. Real
    // words wrapped in template newlines are a fine heading.
    const base = generateFixture('template-bug', SEED, { scope: 'rubric' })
    const crawl = base.stations.crawl!
    if (!crawl.ok) throw new Error('bad fixture')
    const pages = crawl.data.pages.map((p, i) => ({ ...p, h1s: [i === 1 ? '\n  Real Heading  \n' : `Heading ${i}`] }))
    const finding = runChecks(CHECKS, {
      ...base.stations,
      crawl: toolOk({ site: crawl.data.site, pages }, { sources: ['crawl'] }),
    }).find((f) => f.checkId === 'ONPAGE-003')!
    expect(finding.status).toBe('pass')
  })

  it('TECH-001 CATCHES a section-level Disallow and reports a blocked-URL count', () => {
    // Was: "only asks whether the site ROOT is disallowed", so the staging
    // robots.txt this scenario ships passed — despite the rubric note naming money
    // pages. The detector now parses every Googlebot-applicable Disallow, matches
    // it against crawled URLs, and reports a real magnitude.
    const fx = generateFixture('migration-gone-wrong', SEED, { scope: 'rubric' })
    const rubricSays = readMagnitude('TECH-001', {
      crawl: { site: fx.data.site, pages: fx.data.pages },
    })!
    expect(rubricSays.count).toBeGreaterThan(0)
    const finding = runChecks(CHECKS, fx.stations).find((f) => f.checkId === 'TECH-001')!
    expect(finding.status, 'TECH-001 regressed to the root-only reading').toBe('fail')
    expect(finding.evidence.affectedUrls).toBe(rubricSays.count)
  })

  it('every scenario now scores GREEN at rubric scope — no gaps left in the detectors', () => {
    // EXPECTED_GAPS is empty, and this is the assertion that keeps it honest: if a
    // future detector drifts laxer than the rubric, a rubric-scope fixture goes red
    // here rather than being quietly excluded.
    expect(Object.keys(EXPECTED_GAPS)).toEqual([])
    for (const id of SCENARIO_IDS) {
      const fx = generateFixture(id, SEED, { scope: 'rubric' })
      const result = scoreCase(fx.manifest, runChecks(CHECKS, fx.stations))
      expect(result.failures, `${id}: ${JSON.stringify(result.failures)}`).toEqual([])
    }
  })

  it('gbp-misconfig has no gap: every encoding it uses is detector-covered', () => {
    const fx = generateFixture('gbp-misconfig', SEED, { scope: 'rubric' })
    const result = scoreCase(fx.manifest, runChecks(CHECKS, fx.stations))
    expect(result.failures).toEqual([])
    expect(Object.keys(EXPECTED_GAPS)).not.toContain('gbp-misconfig')
  })
})
