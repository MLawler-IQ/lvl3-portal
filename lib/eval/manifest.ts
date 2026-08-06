// Eval-case manifests: the answer key for a fixture, validated hard at load.
//
// A manifest is a policy artifact — it says what a correct pipeline run over this
// fixture MUST surface (with magnitudes), what it must NOT, and what must
// affirmatively pass. The loader enforces the rules as errors, not conventions,
// because a manifest that demands the impossible produces a permanently red gate,
// and permanently red gates get deleted.
//
// One deliberate refinement from the approved plan, discovered on contact with the
// rubric data: the plan said `must_find` may only reference `automation: auto`
// checks. But three of the five real Tornado findings (cannibalisation ONPAGE-006,
// analytics-missing MEAS-001, service-area LOCAL-016) are `assisted` tier — the
// tier describes how much human validation the finding needs before a client sees
// it, not whether a detector can raise it. The precise invariant behind the plan's
// rule is "never demand what nothing can produce", so the enforced rule is:
// every referenced check must have a REGISTERED DETECTOR (and exist in the
// rubric). Auto-only would have thrown away the two biggest real findings.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CHECK_IDS } from '@/lib/findings/checks'

// All three schemas are .strict(): a plain z.object() STRIPS unknown keys, so a
// misspelled `magnitude` key would silently downgrade that entry to ID-presence
// — the truncation guard dying with the build still green. A broken manifest
// must be a red build.
const magnitudeSchema = z
  .object({
    /** Which evidence field carries the magnitude. */
    metric: z.enum(['affectedUrls', 'value']),
    expected: z.number().min(0),
    /** 0 for deterministic fixtures; small bands for record-and-replay snapshots.
     *  Capped at 50 — a 100% tolerance accepts anything from 0 to 2x expected,
     *  which is the truncation guard looking asserted while being vacuous. */
    tolerancePct: z.number().min(0).max(50),
  })
  .strict()

// magnitude is REQUIRED. ID-presence alone is magnitude-blind: an ingester
// truncating the crawl to 10 URLs still "finds" ONPAGE-003.
const mustFindSchema = z
  .object({
    id: z.string(),
    magnitude: magnitudeSchema,
  })
  .strict()

const manifestSchema = z
  .object({
    case: z.string().min(1),
    description: z.string().min(1),
    must_find: z.array(mustFindSchema),
    /** Every fixture carries at least one false-positive assertion. */
    must_not_find: z.array(z.string()).min(1),
    must_pass: z.array(z.string()),
  })
  .strict()

export type EvalManifest = z.infer<typeof manifestSchema>
export type MustFindEntry = z.infer<typeof mustFindSchema>

interface RubricCheck {
  id: string
  automation: string
  severity: string
}

// Keyed by root: an unkeyed cache would validate manifests from repo B against
// repo A's rubric once warm.
const rubricCache = new Map<string, Map<string, RubricCheck>>()

function rubric(root: string): Map<string, RubricCheck> {
  let cached = rubricCache.get(root)
  if (!cached) {
    const raw = JSON.parse(
      readFileSync(join(root, 'docs/rubric/rubric.json'), 'utf8'),
    ) as RubricCheck[]
    cached = new Map(raw.map((c) => [c.id, c]))
    rubricCache.set(root, cached)
  }
  return cached
}

/**
 * Load and validate one fixture's manifest.
 *
 * Throws with a named reason on any violation — a broken manifest must be a red
 * build, never a silently skipped case.
 */
export function loadManifest(fixtureDir: string, repoRoot: string): EvalManifest {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'))
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`${fixtureDir}: invalid manifest — ${parsed.error.issues[0]?.message}`)
  }
  const manifest = parsed.data
  const checks = rubric(repoRoot)

  // Internal coherence before existence checks. A manifest demanding a check
  // both fire and not fire (or fire and pass) is unsatisfiable — a permanently
  // red gate, which is the artifact this loader exists to make impossible.
  const findIds = manifest.must_find.map((e) => e.id)
  for (const list of [findIds, manifest.must_not_find, manifest.must_pass]) {
    const dupe = list.find((id, i) => list.indexOf(id) !== i)
    if (dupe) throw new Error(`${manifest.case}: ${dupe} appears twice in one list`)
  }
  for (const id of findIds) {
    if (manifest.must_not_find.includes(id)) {
      throw new Error(`${manifest.case}: ${id} is in both must_find and must_not_find — unsatisfiable`)
    }
    if (manifest.must_pass.includes(id)) {
      throw new Error(`${manifest.case}: ${id} is in both must_find and must_pass — unsatisfiable`)
    }
  }

  const referenced = [
    ...manifest.must_find.map((e) => e.id),
    ...manifest.must_not_find,
    ...manifest.must_pass,
  ]
  for (const id of referenced) {
    if (!checks.has(id)) {
      throw new Error(
        `${manifest.case}: manifest references ${id}, which does not exist in docs/rubric/rubric.json`,
      )
    }
    if (!CHECK_IDS.has(id)) {
      throw new Error(
        `${manifest.case}: manifest references ${id}, which has no registered detector in lib/findings/checks.ts — a manifest may never demand what nothing can produce`,
      )
    }
  }
  return manifest
}

/** Reset the rubric cache (tests that tamper with rubric contents on disk). */
export function resetRubricCache(): void {
  rubricCache.clear()
}
