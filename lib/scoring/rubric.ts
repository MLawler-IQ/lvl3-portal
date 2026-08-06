// The effort lookup table, read from docs/rubric/rubric.json.
//
// Two rules this module exists to enforce:
//
//   1. EFFORT IS NEVER INVENTED. The rubric ships an `effort` tier for all 80
//      checks; the scorer reads it and has no fallback. A finding for a check the
//      rubric does not know is an error, not a default-to-medium — defaulting
//      would let a typo'd check id score as an ordinary medium-effort item and
//      quietly change everyone's priority order.
//   2. The rubric is validated at load, so a hand-edit that drops `effort` from
//      one row is a red build rather than a runtime surprise on one client.
//
// It is imported, not read with fs, on purpose. lib/eval/manifest.ts reads the
// same file from disk because it is test-only infrastructure with a repo root in
// hand; the scorer runs inside the deployed app, where `docs/` is not guaranteed
// to be on the filesystem next to the bundle. A JSON import is bundled, is
// identical in Next, vitest and tsc, and cannot fail per-environment.

import { z } from 'zod'
import rubricJson from '@/docs/rubric/rubric.json'
import type { EffortTier, Severity } from './config'

const rowSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  effort: z.enum(['low', 'medium', 'high']),
})

/** The columns the scorer consumes. The rubric carries more; we ignore the rest. */
export interface RubricEntry {
  id: string
  category: string
  severity: Severity
  effort: EffortTier
}

function buildIndex(): Map<string, RubricEntry> {
  const parsed = z.array(rowSchema).safeParse(rubricJson)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `docs/rubric/rubric.json is not scorable: ${issue?.path.join('.')} — ${issue?.message}`,
    )
  }
  const index = new Map<string, RubricEntry>()
  for (const row of parsed.data) {
    if (index.has(row.id)) {
      // A duplicate id would make the effort lookup order-dependent.
      throw new Error(`docs/rubric/rubric.json contains duplicate check id ${row.id}`)
    }
    index.set(row.id, row)
  }
  return index
}

const INDEX = buildIndex()

/** Every rubric check, keyed by id. Frozen at module load. */
export function rubricIndex(): ReadonlyMap<string, RubricEntry> {
  return INDEX
}

/** Throws for an unknown check id — see rule 1 above. */
export function rubricEntry(checkId: string): RubricEntry {
  const entry = INDEX.get(checkId)
  if (!entry) {
    throw new Error(
      `${checkId} is not in docs/rubric/rubric.json — effort and severity cannot be looked up, and the scorer never invents them`,
    )
  }
  return entry
}

/** Check ids the rubric marks critical. Nine of them, which is what makes the
 *  snapshot gate's "every critical fail is in the top-K" rule cheap to hold. */
export function criticalCheckIds(): Set<string> {
  const out = new Set<string>()
  for (const entry of Array.from(INDEX.values())) {
    if (entry.severity === 'critical') out.add(entry.id)
  }
  return out
}
