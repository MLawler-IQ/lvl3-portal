// The seven questions an audit answers, and coverage reported per question.
//
// WHY THIS EXISTS. Until now the pipeline could describe its own completeness only as a
// count of rubric rows — "8 of 80 criteria evaluated". That number is true and nearly
// useless. Nobody outside this repo cares that 36 rows are assisted-tier, and a reader
// given "8 of 80" learns that the instrument is mostly unbuilt without learning which of
// their problems went unexamined. A count is also gameable from the inside: registering
// eight cheap hygiene detectors moves 8/80 to 16/80 and moves the reader's actual answer
// by nothing. docs/AUDIT-REDESIGN-PLAN.md calls that out as the reason the client-report
// gate stops being a count.
//
// So coverage is reported against the QUESTION. "Visibility: not measured" is a sentence
// someone can act on; "8 of 80" is not.
//
// THE DENOMINATOR NEVER SHRINKS. Every active rubric row belongs to exactly one question,
// and a question's `total` is its row count whether or not anything can evaluate them.
// This is tests/unit/eval-gate.test.ts's fixed-denominator rule carried up one level: in
// there, a check going not_run must not inflate recall by shrinking what recall is
// measured against; out here, an unbuilt detector must not inflate coverage by leaving its
// criterion out of the count.
//
// PURE. rubric.json plus a run's findings, in, buckets out. No Supabase, no network, no
// clock, no registry import — deliberately not `lib/findings/checks.ts`, which would pull
// the whole check registry and its analyses into every renderer. The bucket rules below
// are written so the registry is not needed.
//
// It imports the rubric rather than reading it with fs, for the reason lib/scoring/rubric.ts
// gives: a JSON import is bundled, behaves identically in Next, vitest and tsc, and cannot
// fail per-environment the way a `docs/` path next to a serverless bundle can.

import { z } from 'zod'
import rubricJson from '@/docs/rubric/rubric.json'
import type { Finding } from '@/lib/findings/types'

/**
 * The seven questions, in the order a run answers them.
 *
 * ORDER IS THE ARGUMENT, not presentation. Measurement is first because if GA4, GSC and
 * call tracking are not capturing outcomes then every number downstream is unfalsifiable —
 * the 80-check critique's one structural complaint about the old category order was that
 * measurement readiness sat last. Hygiene is last because past a floor it stops changing
 * outcomes, and it is where audit theatre concentrates.
 */
export const QUESTION_KEYS = [
  'measurement',
  'visibility',
  'demand',
  'competition',
  'conversion',
  'risk',
  'hygiene',
] as const

export type AuditQuestion = (typeof QUESTION_KEYS)[number]

export interface QuestionMeta {
  key: AuditQuestion
  /** 1-7, matching QUESTION_KEYS. The order the run answers them in. */
  order: number
  /** Short form, for a column or a chip. */
  label: string
  /** The question itself, as someone outside this repo would read it. */
  question: string
}

/**
 * Wording, keyed by question.
 *
 * Kept as a record rather than baked into an ordered literal so QUESTION_KEYS stays the
 * single authority on order — an ordered literal carries `order: 1..7` as hand-typed
 * numbers, and the day someone reorders one list and not the other, the report renders
 * two questions numbered 3.
 */
const META: Record<AuditQuestion, { label: string; question: string }> = {
  measurement: { label: 'Measurement', question: 'Can we measure anything?' },
  visibility: { label: 'Visibility', question: 'Where is the business actually visible?' },
  demand: { label: 'Demand', question: 'What demand exists, and what does the SERP do with it?' },
  competition: { label: 'Competition', question: 'Who is beating us, and by what?' },
  conversion: { label: 'Conversion', question: 'Can we convert what we get?' },
  risk: { label: 'Risk', question: 'Is anything about to break?' },
  hygiene: { label: 'Hygiene', question: 'Is hygiene below the floor?' },
}

export const QUESTIONS: readonly QuestionMeta[] = QUESTION_KEYS.map((key, i) => ({
  key,
  order: i + 1,
  ...META[key],
}))

/** Bucket a criterion falls into for one run. Exhaustive and mutually exclusive. */
export type CoverageBucket = 'evaluated' | 'dataMissing' | 'notEvaluated' | 'humanJudgement'

export interface QuestionCoverage extends QuestionMeta {
  /** Active rubric rows tagged with this question. THE DENOMINATOR. */
  total: number
  /** A detector ran and reached a verdict: pass, fail or degraded. */
  evaluated: readonly string[]
  /** A detector ran and could not answer — `not_run`. Named, never collapsed. */
  dataMissing: readonly string[]
  /**
   * No finding in this run, and the rubric marks the row `auto`.
   *
   * Deliberately NOT called "no detector exists": a run loaded out of `audit_runs.result`
   * was scored against whatever registry existed the day it ran, so "this run did not
   * evaluate it" is the only claim the data supports. Whether a detector exists today is a
   * different question and this module does not import the registry to answer it.
   */
  notEvaluated: readonly string[]
  /**
   * No finding in this run, and the rubric marks the row `assisted`.
   *
   * Split from `notEvaluated` because collapsing them turns "72 criteria our tooling
   * should cover and does not" into the headline, when roughly half of the gap is criteria
   * that need a strategist's judgement and should never have a detector — automating them
   * means letting a model adjudicate a status, which is AUTOMATION-CONTEXT.md §17's
   * failure mode 7 with a roadmap attached.
   */
  humanJudgement: readonly string[]
}

export interface QuestionCoverageReport {
  questions: readonly QuestionCoverage[]
  /**
   * Findings whose checkId is in no rubric row.
   *
   * Surfaced rather than thrown or dropped. lib/scoring/rubric.ts throws for an unknown id
   * because inventing an effort tier would silently reorder a plan; here the caller is a
   * renderer holding a stored run, and blanking the screen over one stale id is worse than
   * printing the id. Dropping it silently is worse than both — the row would vanish from
   * every count and the totals would still look tidy.
   */
  unknownCheckIds: readonly string[]
  /**
   * Findings for rows marked `retired: true`.
   *
   * Surfaced for the same reason as `unknownCheckIds`, and it is the same class of
   * disagreement: a stored run was scored against a rubric that still asked this, and the
   * rubric no longer does. A retired row is in no question's denominator, so its finding
   * can go in no bucket without breaking the sum — which leaves exactly two options, drop
   * it or name it. Naming it is the only one that survives someone asking "where did
   * ONPAGE-002 go?" six months from now.
   */
  retiredWithFindings: readonly string[]
  /**
   * Findings whose `status` is not one of the four, rendered as `ID (status)`.
   *
   * FindingStatus makes this unreachable from live code; stored jsonb is not live code. The
   * bucketing deliberately does not have an `else` that treats an unrecognised status as a
   * verdict — that would be the one direction this module exists to prevent, a numerator
   * inflated by data nobody can read.
   */
  unreadableStatuses: readonly string[]
  /** Sum of every question's `total`. 80 today, 70 once slice 2 retires ten rows. */
  activeRows: number
  /** Rows marked `retired: true`. They are in no question's denominator. */
  retiredRows: number
}

export interface RubricPartition {
  /** Question key -> active row ids, in rubric file order. */
  active: ReadonlyMap<AuditQuestion, readonly string[]>
  /**
   * Ids marked `retired: true`.
   *
   * A retired row keeps whatever `question` tag it was given — the tag records where it
   * used to sit, which is worth keeping (the house rule is that nothing gets thrown away)
   * — but it is excluded from every denominator and from `active`.
   */
  retired: readonly string[]
}

// ---------------------------------------------------------------------------
// The rubric, parsed for the fields this module needs
// ---------------------------------------------------------------------------

const rowSchema = z.object({
  id: z.string().min(1),
  question: z.enum(QUESTION_KEYS),
  automation: z.enum(['auto', 'assisted']),
  /** Absent on every row until slice 2 retires the first one. */
  retired: z.boolean().optional(),
})

interface QuestionRow {
  id: string
  question: AuditQuestion
  automation: 'auto' | 'assisted'
  retired: boolean
}

/**
 * Validated at module load, for the reason lib/scoring/rubric.ts states: a hand-edit that
 * drops `question` from one row, or misspells a question key, must be a red build rather
 * than a runtime surprise on one client's screen.
 */
function buildRows(): QuestionRow[] {
  const parsed = z.array(rowSchema).safeParse(rubricJson)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `docs/rubric/rubric.json cannot be partitioned by question: ${issue?.path.join('.')} — ${issue?.message}`,
    )
  }

  const seen = new Set<string>()
  return parsed.data.map((row) => {
    if (seen.has(row.id)) {
      // A duplicate id would make one criterion count twice in one question's denominator.
      throw new Error(`docs/rubric/rubric.json contains duplicate check id ${row.id}`)
    }
    seen.add(row.id)
    return { ...row, retired: row.retired ?? false }
  })
}

/**
 * The three statuses that count as a verdict.
 *
 * A Set rather than a `!== 'not_run'` test, so an unrecognised status falls through to
 * being named instead of being counted as evaluated. `FindingStatus` makes that unreachable
 * from live code; this module's declared input is a run out of `audit_runs.result` jsonb,
 * which is not live code, and its own tests feed it deliberately malformed rows.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['pass', 'fail', 'degraded'])

const ROWS: readonly QuestionRow[] = buildRows()
const BY_ID: ReadonlyMap<string, QuestionRow> = new Map(ROWS.map((r) => [r.id, r]))

/** Every rubric row's question tag, keyed by id. Includes retired rows. */
export function questionOf(checkId: string): AuditQuestion | null {
  return BY_ID.get(checkId)?.question ?? null
}

export function partitionRubricByQuestion(): RubricPartition {
  const active = new Map<AuditQuestion, string[]>()
  for (const key of QUESTION_KEYS) active.set(key, [])

  const retired: string[] = []
  for (const row of ROWS) {
    if (row.retired) {
      retired.push(row.id)
      continue
    }
    // Non-null: every key was seeded above, and `question` is a QUESTION_KEYS member by schema.
    active.get(row.question)!.push(row.id)
  }

  return { active, retired }
}

// ---------------------------------------------------------------------------
// Coverage for one run
// ---------------------------------------------------------------------------

/**
 * Bucket every active rubric row for one run's findings.
 *
 * The four buckets are decided by the run's own findings plus the rubric, and by nothing
 * else. There is no registry lookup and no station lookup, which is what lets a stored run
 * from `audit_runs.result` produce the same report as a live one: a stored run carries its
 * findings, and its findings are the whole basis of the claim.
 */
export function questionCoverage(findings: readonly Finding[] = []): QuestionCoverageReport {
  const terminal = new Set<string>()
  const notRun = new Set<string>()
  const unknown: string[] = []
  const retiredSeen: string[] = []
  const unreadable: string[] = []

  for (const finding of findings) {
    const id = finding?.checkId
    if (!id) continue

    const row = BY_ID.get(id)
    if (!row) {
      if (!unknown.includes(id)) unknown.push(id)
      continue
    }
    if (row.retired) {
      // In no denominator, so it can be in no bucket. Named rather than dropped — see
      // `retiredWithFindings`.
      if (!retiredSeen.includes(id)) retiredSeen.push(id)
      continue
    }

    if (finding.status === 'not_run') notRun.add(id)
    else if (TERMINAL_STATUSES.has(finding.status)) terminal.add(id)
    // No `else` that counts as a verdict. An unreadable status is named, never bucketed.
    else unreadable.push(`${id} (${String(finding.status)})`)
  }

  const { active, retired } = partitionRubricByQuestion()

  const questions = QUESTIONS.map((meta): QuestionCoverage => {
    const ids = active.get(meta.key) ?? []
    const evaluated: string[] = []
    const dataMissing: string[] = []
    const notEvaluated: string[] = []
    const humanJudgement: string[] = []

    for (const id of ids) {
      // `not_run` is tested FIRST, so one id carrying both a verdict and a not_run — which
      // nothing emits today, and which would mean the run and itself disagree — resolves to
      // the unflattering reading. A tie-break that favoured the verdict would inflate the
      // numerator on exactly the input that says the run is confused.
      if (notRun.has(id)) dataMissing.push(id)
      else if (terminal.has(id)) evaluated.push(id)
      else if (BY_ID.get(id)?.automation === 'assisted') humanJudgement.push(id)
      else notEvaluated.push(id)
    }

    return { ...meta, total: ids.length, evaluated, dataMissing, notEvaluated, humanJudgement }
  })

  return {
    questions,
    unknownCheckIds: unknown,
    retiredWithFindings: retiredSeen,
    unreadableStatuses: unreadable,
    activeRows: questions.reduce((sum, q) => sum + q.total, 0),
    retiredRows: retired.length,
  }
}

/**
 * One line per question, for a text report or a chip.
 *
 * "not measured" rather than "0 of 14" when nothing was evaluated: the point of the
 * per-question framing is that a reader learns which of their problems went unexamined,
 * and a zero is easy to read past.
 */
export function summariseQuestion(q: QuestionCoverage): string {
  if (q.total === 0) return 'no criteria'
  if (q.evaluated.length === 0 && q.dataMissing.length === 0) return `not measured (${q.total} criteria)`
  if (q.evaluated.length === 0) return `not measured — ${q.dataMissing.length} of ${q.total} attempted`
  return `${q.evaluated.length} of ${q.total} evaluated`
}
