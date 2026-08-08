import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHECKS } from '@/lib/findings/checks'
import { runChecks } from '@/lib/findings/engine'
import type { Finding, StationBundle } from '@/lib/findings/types'
import {
  buildSnapshot,
  compareSnapshot,
  readSnapshot,
  serializeSnapshot,
  snapshotUpdateRequested,
  updateSnapshotIfRequested,
  type ScoringSnapshot,
} from '@/lib/eval/snapshot'
import { SCORING_CONFIG, bandFor, type ScoringConfig } from '@/lib/scoring/config'
import { contextFromStations, scoreFindings } from '@/lib/scoring/score'
import type { ScoringResult } from '@/lib/scoring/types'
import { tornadoStations } from '../../fixtures/eval/tornado/stations'
import { healthyStations } from '../../fixtures/eval/healthy/stations'

// THE SCORING SNAPSHOT GATE.
//
// The layer the slice-1 critique found missing: fixtures assert a finding is
// present, validators assert it is traceable, and until this file existed nothing
// asserted a SCORE or a RANK. A change that halved every impact number or
// inverted the priority order passed the whole harness green.
//
// Re-baselining is deliberate:  EVAL_SNAPSHOT_UPDATE=1 npx vitest run tests/unit/eval-snapshot.test.ts
// and the resulting diff to fixtures/eval/*/scoring.snapshot.json goes in front of
// a human alongside the code diff. The comparison path never writes.

const ROOT = join(__dirname, '..', '..')
const FIXTURES_DIR = join(ROOT, 'fixtures', 'eval')

/**
 * The gate that guards the gate.
 *
 * With EVAL_SNAPSHOT_UPDATE=1 exported in a shell, every case test below writes its
 * snapshot and returns early, and the byte-exact test then compares the file against the
 * bytes that were just written to it. The whole comparison layer silently becomes a rubber
 * stamp — and nothing complained, because the existing guard tests pass env literals
 * (`{EVAL_SNAPSHOT_UPDATE:'0'}`) rather than reading `process.env`. A stale export from an
 * earlier re-baseline would have carried on approving whatever the code produced.
 *
 * So this test fails whenever the variable is set, INCLUDING during a deliberate
 * re-baseline. That is the design, not an oversight: one red test naming what happened is
 * how re-baseline mode announces itself. The re-baseline is still a two-step ritual —
 * write, then unset and confirm green — and this makes the second step unskippable.
 *
 * docs/AUTOMATION-PLAN.md asked for exactly this ("A test fails if EVAL_SNAPSHOT_UPDATE is
 * set during a normal run") and it was never built.
 */
describe('the snapshot gate cannot be silently disabled', () => {
  it('fails while EVAL_SNAPSHOT_UPDATE is set, so a stale export cannot rubber-stamp a run', () => {
    expect(
      process.env.EVAL_SNAPSHOT_UPDATE ?? '(unset)',
      'EVAL_SNAPSHOT_UPDATE is set, so the snapshot cases above WROTE their fixtures instead ' +
        'of comparing against them. If you just re-baselined: read `git diff fixtures/eval/`, ' +
        'then unset the variable and re-run to confirm the suite is green against the new ' +
        'bytes. If you did not: a stale export has been approving every scoring change.',
    ).not.toBe('1')
  })
})

const CASES: Record<string, () => StationBundle> = {
  healthy: healthyStations,
  tornado: tornadoStations,
}

function snapshotPath(caseName: string): string {
  return join(FIXTURES_DIR, caseName, 'scoring.snapshot.json')
}

function computeSnapshot(
  caseName: string,
  build: () => StationBundle,
  config: ScoringConfig = SCORING_CONFIG,
): { findings: Finding[]; scored: ScoringResult; snapshot: ScoringSnapshot } {
  const stations = build()
  const findings = runChecks(CHECKS, stations)
  const scored = scoreFindings(findings, contextFromStations(stations), config)
  return { findings, scored, snapshot: buildSnapshot(caseName, findings, scored, config) }
}

/** Deep copy so a negative case cannot leak into the next test. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('scoring snapshot gate', () => {
  it('every fixture has a snapshot file', () => {
    for (const name of Object.keys(CASES)) {
      const path = snapshotPath(name)
      expect(
        existsSync(path),
        `${path} is missing. A fixture without a scoring snapshot is an ungated fixture. Re-baseline deliberately: EVAL_SNAPSHOT_UPDATE=1 npx vitest run tests/unit/eval-snapshot.test.ts`,
      ).toBe(true)
    }
  })

  for (const [name, build] of Object.entries(CASES)) {
    it(`case "${name}" matches its scoring snapshot`, () => {
      const { snapshot } = computeSnapshot(name, build)
      const path = snapshotPath(name)

      // The ONLY write path, and it is off unless an operator asked for it.
      const updated = updateSnapshotIfRequested(path, snapshot)
      if (updated === 'written') {
        // A run that re-baselines is not a run that verifies. Say so loudly
        // rather than reporting a green gate that just overwrote its own answer.
        expect(snapshotUpdateRequested()).toBe(true)
        return
      }

      const result = compareSnapshot(readSnapshot(path), snapshot)
      expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([])
      expect(result.pass).toBe(true)
      expect(result.severityWeightedLoss).toBe(0)
    })
  }

  it('the stored tornado snapshot holds every critical fail inside the top-K', () => {
    const stored = readSnapshot(snapshotPath('tornado'))
    const topK = new Set(stored.topKItems.map((i) => i.checkId))
    expect(stored.criticalFails.length).toBeGreaterThan(0)
    for (const id of stored.criticalFails) expect(topK.has(id)).toBe(true)
  })

  it('the healthy case snapshots an EMPTY plan — a clean site earns no recommendations', () => {
    const stored = readSnapshot(snapshotPath('healthy'))
    expect(stored.topKItems).toEqual([])
    expect(stored.criticalFails).toEqual([])
    expect(stored.totals.scored).toBe(0)
    expect(stored.totals.pass).toBe(CHECKS.length)
  })
})

describe('scoring snapshot gate — determinism', () => {
  it('identical findings produce byte-identical snapshot output', () => {
    for (const [name, build] of Object.entries(CASES)) {
      const a = serializeSnapshot(computeSnapshot(name, build).snapshot)
      const b = serializeSnapshot(computeSnapshot(name, build).snapshot)
      expect(a).toBe(b)
    }
  })

  it('the serialized snapshot equals the bytes on disk', () => {
    for (const [name, build] of Object.entries(CASES)) {
      const fresh = serializeSnapshot(computeSnapshot(name, build).snapshot)
      expect(fresh).toBe(readFileSync(snapshotPath(name), 'utf8'))
    }
  })

  it('a case compares clean against itself', () => {
    const { snapshot } = computeSnapshot('tornado', tornadoStations)
    const result = compareSnapshot(snapshot, clone(snapshot))
    expect(result.pass).toBe(true)
  })
})

// A gate without demonstrated negative cases is not a gate. Each case below is a
// realistic scoring regression, and each must go red with the right failure kind.
describe('scoring snapshot gate — proves it bites', () => {
  const expected = () => readSnapshot(snapshotPath('tornado'))

  function actualFrom(mutate: (scored: ScoringResult) => ScoringResult, config = SCORING_CONFIG) {
    const stations = tornadoStations()
    const findings = runChecks(CHECKS, stations)
    const scored = mutate(scoreFindings(findings, contextFromStations(stations), config))
    return buildSnapshot('tornado', findings, scored, config)
  }

  /** Re-sort and re-rank after a score mutation, the same way the scorer does. */
  function resort(scored: ScoringResult, config = SCORING_CONFIG): ScoringResult {
    const items = [...scored.items].sort((a, b) =>
      b.priorityScore !== a.priorityScore
        ? b.priorityScore - a.priorityScore
        : a.checkId < b.checkId
          ? -1
          : a.checkId > b.checkId
            ? 1
            : 0,
    )
    items.forEach((item, i) => {
      item.rank = i + 1
      item.band = bandFor(item.priorityScore, config)
    })
    return { ...scored, items }
  }

  it('halving every impact number is caught even though the ordering survives', () => {
    const actual = actualFrom((scored) =>
      resort({
        ...scored,
        items: scored.items.map((item) => ({
          ...item,
          impact: item.impact / 2,
          priorityScore: item.priorityScore / 2,
        })),
      }),
    )
    // The ordering is untouched: a uniform halving is monotonic.
    expect(actual.topKItems.map((i) => i.checkId)).toEqual(
      expected().topKItems.map((i) => i.checkId),
    )
    const result = compareSnapshot(expected(), actual)
    expect(result.pass).toBe(false)
    const drifted = result.failures.filter((f) => f.kind === 'impact-drift')
    expect(drifted.length).toBe(expected().topKItems.length)
    expect(result.failures.some((f) => f.kind === 'priority-drift')).toBe(true)
  })

  it('inverting the ranking is caught — the realistic bug is a flipped division', () => {
    // effortWeight / impact instead of impact / effortWeight.
    const actual = actualFrom((scored) =>
      resort({
        ...scored,
        items: scored.items.map((item) => ({
          ...item,
          priorityScore: item.impact === 0 ? 0 : item.effortWeight / item.impact,
        })),
      }),
    )
    const before = expected()
    expect(actual.topKItems[0].checkId).not.toBe(before.topKItems[0].checkId)
    const result = compareSnapshot(before, actual)
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.kind === 'priority-drift')).toBe(true)
    expect(result.failures.some((f) => f.kind === 'band-changed')).toBe(true)
  })

  it('inverting the ranking also breaks top-K SET membership once K is smaller than the plan', () => {
    // With topK = 3 the set gate itself bites: the two items an inverted model
    // promotes were nowhere near the top three.
    const config: ScoringConfig = { ...SCORING_CONFIG, topK: 3 }
    const baseline = actualFrom((s) => s, config)
    const inverted = actualFrom(
      (scored) =>
        resort(
          {
            ...scored,
            items: scored.items.map((item) => ({
              ...item,
              priorityScore: item.impact === 0 ? 0 : item.effortWeight / item.impact,
            })),
          },
          config,
        ),
      config,
    )
    const result = compareSnapshot(baseline, inverted, config)
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.kind === 'topk-membership-lost')).toBe(true)
    expect(result.failures.some((f) => f.kind === 'topk-membership-added')).toBe(true)
    // Severity-weighted, so the message can say a critical fell out, not just "one item".
    expect(result.severityWeightedLoss).toBeGreaterThan(0)
  })

  it('burying a critical finding below the top-K fails, even when nothing else moved', () => {
    const before = expected()
    const critical = before.criticalFails[0]
    expect(critical).toBeDefined()

    const actual = actualFrom((scored) => {
      // Realistic shape of the regression: a tuning change pushes one critical's
      // score to the floor while other work crowds the top of the plan.
      const filler = ['ONPAGE-001', 'ONPAGE-002', 'ONPAGE-004', 'TECH-004'].map((checkId, i) => ({
        ...scored.items[0],
        checkId,
        severity: 'high' as const,
        priorityScore: 900 - i,
        impact: 900 - i,
      }))
      return resort({
        ...scored,
        items: [
          ...scored.items.map((item) =>
            item.checkId === critical ? { ...item, priorityScore: 0.01, impact: 0.01 } : item,
          ),
          ...filler,
        ],
      })
    })

    // The critical is still a critical fail; it just is not in the plan any more.
    expect(actual.criticalFails).toContain(critical)
    expect(actual.topKItems.map((i) => i.checkId)).not.toContain(critical)

    const result = compareSnapshot(before, actual)
    expect(result.pass).toBe(false)
    const buried = result.failures.find((f) => f.kind === 'critical-not-in-topk')
    expect(buried?.checkId).toBe(critical)
    expect(buried?.detail).toContain('buried')
  })

  it('a plan that shrank because checks stopped running is not a plan that got better', () => {
    // Kill the crawl station: four of the five findings become not_run, the plan
    // shortens, and the totals catch it as well as the membership loss.
    const stations = tornadoStations()
    stations.crawl = undefined
    const findings = runChecks(CHECKS, stations)
    const scored = scoreFindings(findings, contextFromStations(stations))
    const result = compareSnapshot(expected(), buildSnapshot('tornado', findings, scored))
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.kind === 'totals-changed')).toBe(true)
    expect(result.failures.some((f) => f.kind === 'topk-membership-lost')).toBe(true)
    expect(result.severityWeightedLoss).toBeGreaterThan(0)
  })

  it('a scoring config version bump fails until the snapshot is re-baselined', () => {
    const before = expected()
    const actual = clone(before)
    actual.configVersion = 'scoring-9999-01-01.9'
    const result = compareSnapshot(before, actual)
    expect(result.pass).toBe(false)
    expect(result.failures[0].kind).toBe('config-version-changed')
  })

  it('reclassifying a recommendation type fails, even at an identical score', () => {
    const before = expected()
    const actual = clone(before)
    actual.topKItems[0].basis = 'stuck_keyword'
    const result = compareSnapshot(before, actual)
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.kind === 'basis-changed')).toBe(true)
  })

  it('an effort-tier change fails — the effort lookup is part of the ranking', () => {
    const before = expected()
    const actual = clone(before)
    actual.topKItems[0].effort = 'high'
    actual.topKItems[0].effortWeight = 5
    const result = compareSnapshot(before, actual)
    expect(result.pass).toBe(false)
    expect(result.failures.some((f) => f.kind === 'rubric-attribute-changed')).toBe(true)
  })
})

describe('scoring snapshot gate — never self-heals', () => {
  it('comparing does not write, even when the comparison fails', () => {
    const path = snapshotPath('tornado')
    const beforeBytes = readFileSync(path, 'utf8')
    const stored = readSnapshot(path)
    const broken = clone(stored)
    broken.topKItems.forEach((i) => {
      i.impact = i.impact / 2
    })
    expect(compareSnapshot(stored, broken).pass).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(beforeBytes)
  })

  it('the updater does nothing without EVAL_SNAPSHOT_UPDATE=1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scoring-snapshot-'))
    const path = join(dir, 'scoring.snapshot.json')
    const { snapshot } = computeSnapshot('tornado', tornadoStations)

    expect(updateSnapshotIfRequested(path, snapshot, {})).toBe('not-requested')
    expect(updateSnapshotIfRequested(path, snapshot, { EVAL_SNAPSHOT_UPDATE: '0' })).toBe(
      'not-requested',
    )
    expect(updateSnapshotIfRequested(path, snapshot, { EVAL_SNAPSHOT_UPDATE: 'true' })).toBe(
      'not-requested',
    )
    expect(existsSync(path)).toBe(false)

    expect(updateSnapshotIfRequested(path, snapshot, { EVAL_SNAPSHOT_UPDATE: '1' })).toBe('written')
    expect(readFileSync(path, 'utf8')).toBe(serializeSnapshot(snapshot))
  })

  it('snapshotUpdateRequested is exact, not truthy', () => {
    expect(snapshotUpdateRequested({})).toBe(false)
    expect(snapshotUpdateRequested({ EVAL_SNAPSHOT_UPDATE: '' })).toBe(false)
    expect(snapshotUpdateRequested({ EVAL_SNAPSHOT_UPDATE: 'yes' })).toBe(false)
    expect(snapshotUpdateRequested({ EVAL_SNAPSHOT_UPDATE: '1' })).toBe(true)
  })
})
