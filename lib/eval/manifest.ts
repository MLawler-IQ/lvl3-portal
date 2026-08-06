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

const magnitudeSchema = z.object({
  /** Which evidence field carries the magnitude. */
  metric: z.enum(['affectedUrls', 'value']),
  expected: z.number(),
  /** 0 for deterministic fixtures; bands are for record-and-replay snapshots. */
  tolerancePct: z.number().min(0).max(100),
})

const mustFindSchema = z.object({
  id: z.string(),
  magnitude: magnitudeSchema.optional(),
})

const manifestSchema = z.object({
  case: z.string().min(1),
  description: z.string().min(1),
  must_find: z.array(mustFindSchema),
  must_not_find: z.array(z.string()),
  must_pass: z.array(z.string()),
})

export type EvalManifest = z.infer<typeof manifestSchema>
export type MustFindEntry = z.infer<typeof mustFindSchema>

interface RubricCheck {
  id: string
  automation: string
  severity: string
}

let rubricCache: Map<string, RubricCheck> | null = null

function rubric(root: string): Map<string, RubricCheck> {
  if (!rubricCache) {
    const raw = JSON.parse(
      readFileSync(join(root, 'docs/rubric/rubric.json'), 'utf8'),
    ) as RubricCheck[]
    rubricCache = new Map(raw.map((c) => [c.id, c]))
  }
  return rubricCache
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

/** Reset the rubric cache (tests that tamper with paths). */
export function resetRubricCache(): void {
  rubricCache = null
}
