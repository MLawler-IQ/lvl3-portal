// The seeded fixture generator.
//
// One call produces BOTH halves of an eval case and they are guaranteed to agree,
// because the manifest's magnitudes are read out of the station data that was just
// built, using the rubric-derived predicates in predicates.ts. A generator whose
// manifest disagrees with its own data is worse than no fixture: it turns the gate
// permanently red for a reason that has nothing to do with the pipeline, and
// permanently red gates get deleted.
//
// Determinism: everything downstream of `seed` is a pure function of it. No
// Math.random, no Date.now, no ambient state. Same seed → byte-identical fixture;
// a fresh seed → a fresh combination of surface encodings, defect counts and
// cities, which is what stops the fixture set from becoming a memorisation target.

import type { StationBundle } from '@/lib/findings/types'
import { toolOk } from '@/lib/tools/contract'
import type { EvalManifest } from '@/lib/eval/manifest'
import { readMagnitude } from './predicates'
import { makeRng } from './rng'
import {
  REGISTERED_CHECK_IDS,
  SCENARIOS,
  SCENARIO_IDS,
  scenario,
  type EncodingScope,
  type FixtureData,
  type ScenarioTemplate,
  type Variant,
} from './scenarios'

export interface GeneratedFixture {
  scenarioId: string
  variant: Variant
  scope: EncodingScope
  seed: string
  /** The story this fixture encodes — carried so a reviewer never has to guess. */
  story: string
  /** Raw station data, pre-envelope. The linter reads this. */
  data: FixtureData
  /** Envelope-wrapped, exactly as a live station run returns. */
  stations: StationBundle
  manifest: EvalManifest
  /** check id → surface encoding ids this build used. */
  encodingsUsed: Record<string, string[]>
}

export interface GenerateOptions {
  variant?: Variant
  /**
   * How much of the rubric to demand. Defaults to 'detector-covered', which is
   * what a CI gate should run; 'rubric' produces the lint-clean, score-red
   * regression fixtures that track the measured detector gaps.
   */
  scope?: EncodingScope
}

function seedLabel(
  scenarioId: string,
  seed: number | string,
  variant: Variant,
  scope: EncodingScope,
): string {
  // The scope is part of the stream label because a scope change alters how many
  // draws each injector makes; sharing a stream would make a scope switch silently
  // re-roll unrelated choices like city names.
  return `${scenarioId}/${variant}/${scope}/${seed}`
}

/**
 * Build the manifest from the data that was just generated.
 *
 * Rules enforced here mirror lib/eval/manifest.ts's loader, so a generated fixture
 * can never be the thing that makes the loader throw:
 *   - every must_find entry carries a REQUIRED magnitude, read from the data;
 *   - at least one must_not_find (the false-positive assertion) always exists;
 *   - no id appears in both must_find and must_not_find, or in both must_find and
 *     must_pass;
 *   - no id appears twice in one list;
 *   - only checks with a registered detector are referenced.
 */
function buildManifest(
  template: ScenarioTemplate,
  data: FixtureData,
  variant: Variant,
  scope: EncodingScope,
  seed: string,
): EvalManifest {
  const input = {
    crawl: { site: data.site, pages: data.pages },
    gsc: data.gsc,
    gbp: data.gbp,
  }

  const cluster =
    variant === 'defect'
      ? [...template.cluster, ...(scope === 'rubric' ? template.rubricOnlyCluster : [])]
      : []
  const mustFind = cluster.map((id) => {
    const reading = readMagnitude(id, input)
    if (!reading) {
      throw new Error(`${template.id}: no rubric-derived magnitude predicate for ${id}`)
    }
    if (reading.count <= 0) {
      // A must_find whose magnitude is zero is a scenario bug, not a fixture:
      // the manifest would demand a finding the data does not contain.
      throw new Error(
        `${template.id}: cluster check ${id} produced a magnitude of 0 — the scenario did not inject the defect it claims`,
      )
    }
    return {
      id,
      magnitude: {
        metric: reading.metric,
        expected: reading.count,
        // Zero tolerance: these fixtures are deterministic, so any band would only
        // hide a truncating ingester. lib/eval/manifest.ts caps tolerance at 50%
        // for the record-and-replay snapshots that come later.
        tolerancePct: 0,
      },
    }
  })

  const findIds = new Set(mustFind.map((e) => e.id))
  // Everything outside the cluster must affirmatively PASS: a fixture that only
  // asserts its own defects cannot tell "the pipeline is precise" from "the
  // pipeline only ran two checks".
  const mustPass = REGISTERED_CHECK_IDS.filter((id) => !findIds.has(id))
  // The FP traps are the subset called out explicitly, so a fired finding is
  // reported as a forbidden-finding rather than a softer must_pass miss. On the
  // near-miss variant every cluster check joins them — that is the whole point of
  // the variant.
  const traps = Array.from(
    new Set([
      ...template.fpTraps,
      ...(variant === 'near-miss' ? [...template.cluster, ...template.rubricOnlyCluster] : []),
    ]),
  ).filter((id) => !findIds.has(id))

  if (traps.length === 0) {
    throw new Error(`${template.id}: every fixture must carry at least one must_not_find`)
  }

  const manifest: EvalManifest = {
    case: `${template.id}-${variant}-${scope}@${seed}`,
    description:
      `${variant === 'defect' ? 'Generated defect fixture' : 'Generated NEAR-MISS fixture'} ` +
      `for the "${template.id}" causal scenario, scope ${scope}, seed ${seed}. ${template.story} ` +
      (variant === 'near-miss'
        ? 'This variant replaces every cluster defect with the legitimate configuration adjacent to it, ' +
          'so the cluster checks move from must_find to must_not_find: it measures precision, not recall.'
        : `Surface encodings used: ${Object.entries(data.encodingsUsed)
            .map(([check, ids]) => `${check} [${ids.join(', ')}]`)
            .join('; ')}.`),
    must_find: mustFind,
    must_not_find: traps,
    must_pass: Array.from(mustPass),
  }

  assertManifestCoherent(manifest)
  return manifest
}

/** The loader's rules, applied in memory before anything reaches disk. */
export function assertManifestCoherent(manifest: EvalManifest): void {
  const findIds = manifest.must_find.map((e) => e.id)
  for (const [name, list] of [
    ['must_find', findIds],
    ['must_not_find', manifest.must_not_find],
    ['must_pass', manifest.must_pass],
  ] as const) {
    const dupe = list.find((id, i) => list.indexOf(id) !== i)
    if (dupe) throw new Error(`${manifest.case}: ${dupe} appears twice in ${name}`)
  }
  for (const id of findIds) {
    if (manifest.must_not_find.includes(id)) {
      throw new Error(`${manifest.case}: ${id} is in both must_find and must_not_find`)
    }
    if (manifest.must_pass.includes(id)) {
      throw new Error(`${manifest.case}: ${id} is in both must_find and must_pass`)
    }
  }
  if (manifest.must_not_find.length === 0) {
    throw new Error(`${manifest.case}: must_not_find may not be empty`)
  }
}

/** Generate one fixture: station bundle plus the manifest that answers for it. */
export function generateFixture(
  scenarioId: string,
  seed: number | string,
  opts: GenerateOptions = {},
): GeneratedFixture {
  const template = scenario(scenarioId)
  const variant = opts.variant ?? 'defect'
  const scope = opts.scope ?? 'detector-covered'
  const label = seedLabel(scenarioId, seed, variant, scope)
  const data = template.build({ rng: makeRng(label), variant, scope })
  const manifest = buildManifest(template, data, variant, scope, String(seed))

  return {
    scenarioId,
    variant,
    scope,
    seed: String(seed),
    story: template.story,
    data,
    stations: {
      crawl: toolOk({ site: data.site, pages: data.pages }, { sources: ['crawl'] }),
      gsc: toolOk(data.gsc, { sources: ['gsc'] }),
      gbp: toolOk(data.gbp, { sources: ['gbp'] }),
    },
    manifest,
    encodingsUsed: data.encodingsUsed,
  }
}

/**
 * Every scenario at one seed, both variants — the suite a CI gate runs.
 *
 * Detector-covered scope only: these are the fixtures that must score green. The
 * 'rubric'-scope fixtures are generated explicitly by the gap tests, because a
 * gate cannot be built out of cases that are supposed to be red.
 */
export function generateSuite(
  seed: number | string,
  scope: EncodingScope = 'detector-covered',
): GeneratedFixture[] {
  const out: GeneratedFixture[] = []
  for (const template of SCENARIOS) {
    out.push(generateFixture(template.id, seed, { variant: 'defect', scope }))
    out.push(generateFixture(template.id, seed, { variant: 'near-miss', scope }))
  }
  return out
}

export { SCENARIO_IDS, SCENARIOS, REGISTERED_CHECK_IDS }
export type { EncodingScope, FixtureData, ScenarioTemplate, Variant }
