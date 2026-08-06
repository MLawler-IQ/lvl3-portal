import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadManifest } from '@/lib/eval/manifest'
import { scoreCase } from '@/lib/eval/score'
import { runChecks } from '@/lib/findings/engine'
import { CHECKS, CHECK_IDS } from '@/lib/findings/checks'
import { toolOk, toolErr } from '@/lib/tools/contract'
import type { StationBundle } from '@/lib/findings/types'
import { tornadoStations } from '../../fixtures/eval/tornado/stations'
import { healthyStations } from '../../fixtures/eval/healthy/stations'

// THE EVAL GATE. Same enforcement pattern as the palette guard: a hard-fail
// vitest, run with the ordinary suite, so it triggers on every PR touching the
// dependency cone — detectors, engine, contract, fixtures, rubric — not only on
// prompt or scoring changes.

const ROOT = join(__dirname, '..', '..')
const FIXTURES_DIR = join(ROOT, 'fixtures', 'eval')

/** Every fixture must be wired here; discovery asserts the two lists agree. */
const CASES: Record<string, () => StationBundle> = {
  healthy: healthyStations,
  tornado: tornadoStations,
}

describe('eval gate', () => {
  // Anti-rot rule: the harness must know exactly how many cases it expects. A
  // path refactor that silently discovers zero fixtures must be a red build, and
  // a new fixture directory that nobody wired into CASES must be one too.
  it('discovers exactly the wired fixture cases', () => {
    const onDisk = readdirSync(FIXTURES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect(onDisk).toEqual(Object.keys(CASES).sort())
    expect(onDisk.length).toBeGreaterThan(0)
  })

  for (const [name, build] of Object.entries(CASES)) {
    it(`case "${name}" scores green`, () => {
      const manifest = loadManifest(join(FIXTURES_DIR, name), ROOT)
      const findings = runChecks(CHECKS, build())
      const result = scoreCase(manifest, findings)
      expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([])
      expect(result.pass).toBe(true)
      expect(result.recall.satisfied).toBe(result.recall.total)
    })
  }

  it('tornado recall is 5 of 5, not a smaller denominator', () => {
    const manifest = loadManifest(join(FIXTURES_DIR, 'tornado'), ROOT)
    expect(manifest.must_find).toHaveLength(5)
    const result = scoreCase(manifest, runChecks(CHECKS, tornadoStations()))
    expect(result.recall).toEqual({ satisfied: 5, total: 5 })
  })
})

// The gate is only trustworthy if it demonstrably bites. Each case below injects
// one realistic breakage and asserts the scorer goes red with the RIGHT failure
// kind — the in-test version of "inject a defect and watch it fail".
describe('eval gate — proves it bites', () => {
  it('a failed GSC station is must-find-not-run, never a pass', () => {
    const stations = tornadoStations()
    stations.gsc = toolErr('GSC auth expired', { sources: ['gsc'] })
    const result = scoreCase(
      loadManifest(join(FIXTURES_DIR, 'tornado'), ROOT),
      runChecks(CHECKS, stations),
    )
    expect(result.pass).toBe(false)
    const failure = result.failures.find((f) => f.checkId === 'ONPAGE-006')
    expect(failure?.kind).toBe('must-find-not-run')
  })

  it('an ingest truncation trips the magnitude band even though the ID still fires', () => {
    const stations = tornadoStations()
    const crawl = stations.crawl!
    if (!crawl.ok) throw new Error('fixture crawl must be ok')
    stations.crawl = toolOk(
      { site: crawl.data.site, pages: crawl.data.pages.slice(0, 30) },
      { sources: ['crawl'] },
    )
    const result = scoreCase(
      loadManifest(join(FIXTURES_DIR, 'tornado'), ROOT),
      runChecks(CHECKS, stations),
    )
    expect(result.pass).toBe(false)
    // ONPAGE-003 still finds missing H1s — but ~30, nowhere near 191.
    const failure = result.failures.find((f) => f.checkId === 'ONPAGE-003')
    expect(failure?.kind).toBe('magnitude')
  })

  it('an empty GSC station cannot vacuously pass the healthy case', () => {
    const stations = healthyStations()
    stations.gsc = toolOk([], { sources: ['gsc'] })
    const result = scoreCase(
      loadManifest(join(FIXTURES_DIR, 'healthy'), ROOT),
      runChecks(CHECKS, stations),
    )
    expect(result.pass).toBe(false)
    const failure = result.failures.find((f) => f.checkId === 'ONPAGE-006')
    expect(failure?.kind).toBe('must-pass-failed')
    expect(failure?.detail).toContain('not_run')
  })

  it('losing the SAB flag turns the healthy case red via the FP trap', () => {
    // The realistic regression path: an ingester change drops isServiceAreaBusiness,
    // and the completeness check starts docking the hidden address again — the
    // exact documented false positive. The healthy fixture exists to catch it.
    const stations = healthyStations()
    const gbp = stations.gbp!
    if (!gbp.ok) throw new Error('fixture gbp must be ok')
    stations.gbp = toolOk({ ...gbp.data, isServiceAreaBusiness: false }, { sources: ['gbp'] })
    const result = scoreCase(
      loadManifest(join(FIXTURES_DIR, 'healthy'), ROOT),
      runChecks(CHECKS, stations),
    )
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.checkId === 'LOCAL-003' && f.kind === 'forbidden-finding')).toBe(true)
  })

  it('a degraded station cannot satisfy must_pass', () => {
    const stations = healthyStations()
    const crawl = stations.crawl!
    if (!crawl.ok) throw new Error('fixture crawl must be ok')
    stations.crawl = toolOk(crawl.data, {
      sources: ['crawl'],
      degraded: true,
      notes: ['half the site did not render'],
    })
    const result = scoreCase(
      loadManifest(join(FIXTURES_DIR, 'healthy'), ROOT),
      runChecks(CHECKS, stations),
    )
    expect(result.pass).toBe(false)
    const failure = result.failures.find((f) => f.checkId === 'ONPAGE-003')
    expect(failure?.kind).toBe('must-pass-failed')
    expect(failure?.detail).toContain('degraded')
  })
})

describe('manifest loader', () => {
  function writeManifest(json: object): string {
    const dir = mkdtempSync(join(tmpdir(), 'eval-manifest-'))
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(json))
    return dir
  }

  const base = { case: 't', description: 'd', must_find: [], must_not_find: [], must_pass: [] }

  it('rejects a check id that does not exist in the rubric', () => {
    const dir = writeManifest({ ...base, must_pass: ['NOPE-001'] })
    expect(() => loadManifest(dir, ROOT)).toThrow(/does not exist in docs\/rubric/)
  })

  it('rejects a rubric check with no registered detector', () => {
    // Pick a real rubric id that has no detector, from the rubric itself, so this
    // test survives new detectors being registered.
    const rubric = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('node:fs').readFileSync(join(ROOT, 'docs/rubric/rubric.json'), 'utf8'),
    ) as { id: string }[]
    const undetected = rubric.find((c) => !CHECK_IDS.has(c.id))
    expect(undetected).toBeDefined()
    const dir = writeManifest({ ...base, must_find: [{ id: undetected!.id }] })
    expect(() => loadManifest(dir, ROOT)).toThrow(/no registered detector/)
  })

  it('accepts the real fixture manifests', () => {
    expect(() => loadManifest(join(FIXTURES_DIR, 'tornado'), ROOT)).not.toThrow()
    expect(() => loadManifest(join(FIXTURES_DIR, 'healthy'), ROOT)).not.toThrow()
  })
})
