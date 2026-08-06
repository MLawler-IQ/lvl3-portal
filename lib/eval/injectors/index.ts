// Causal scenario-template defect injectors for the eval harness.
//
//   rng.ts         seeded PRNG — no Math.random, no Date.now, no new packages
//   predicates.ts  magnitude predicates written from docs/rubric/rubric.json
//   encodings.ts   several surface encodings per defect, plus the near-miss twin
//   site.ts        the healthy baseline every scenario starts from
//   scenarios.ts   four causal templates, each a real failure story
//   generate.ts    seed → { station bundle, manifest } that agree by construction
//
// The linter that refuses physically impossible output lives one level up, at
// lib/eval/lint.ts, because it lints fixtures generally — hand-written ones too.

// Note: the linter is NOT re-exported here. lib/eval/lint.ts imports the
// predicates from this directory, so re-exporting it would close an import cycle
// for no benefit — import it from '@/lib/eval/lint' directly.
export { makeRng, type Rng } from './rng'
export {
  MAGNITUDE_PREDICATES,
  GBP_AUDITED_FIELDS,
  readMagnitude,
  type MagnitudeMetric,
  type MagnitudeReading,
  type PredicateInput,
} from './predicates'
export {
  ALL_ENCODINGS,
  ANALYTICS_ENCODINGS,
  ANALYTICS_NEAR_MISS,
  CANNIBAL_ENCODINGS,
  CANNIBAL_NEAR_MISS,
  GBP_ENCODINGS,
  GBP_NEAR_MISS,
  GEO_ENCODINGS,
  H1_ENCODINGS,
  H1_NEAR_MISS,
  KNOWN_UNCOVERED_ENCODINGS,
  MOBILE_ENCODINGS,
  MOBILE_NEAR_MISS,
  ROBOTS_ENCODINGS,
  ROBOTS_NEAR_MISS,
  type EncodingKind,
} from './encodings'
export { VOCAB, healthyGbp, healthyPage, healthySite, type SiteVocab } from './site'
export {
  REGISTERED_CHECK_IDS,
  SCENARIOS,
  SCENARIO_IDS,
  scenario,
  type BuildContext,
  type EncodingScope,
  type FixtureData,
  type ScenarioTemplate,
  type Variant,
} from './scenarios'
export {
  assertManifestCoherent,
  generateFixture,
  generateSuite,
  type GeneratedFixture,
  type GenerateOptions,
} from './generate'
