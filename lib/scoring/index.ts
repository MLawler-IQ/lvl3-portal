// The scoring stage's public surface.

export {
  SCORING_CONFIG,
  LOCAL_CTR_CURVE,
  EFFORT_WEIGHTS,
  SEVERITY_WEIGHTS,
  CATEGORY_WEIGHTS,
  BASIS_WEIGHTS,
  DEFAULT_CATEGORY_WEIGHT,
  bandFor,
  ctrAt,
} from './config'
export type {
  CtrCurvePoint,
  EffortTier,
  ImpactBasis,
  PriorityBand,
  ScoringConfig,
  Severity,
} from './config'

export {
  consolidationImpact,
  localVisibilityImpact,
  measurementGapImpact,
  stuckKeywordImpact,
  templateFixImpact,
} from './impact'
export type { BasisComputation, CompetingCluster } from './impact'

export { criticalCheckIds, rubricEntry, rubricIndex } from './rubric'
export type { RubricEntry } from './rubric'

export {
  basisRuleFor,
  checksWithBasisRules,
  competingClustersFromGsc,
  contextFromStations,
  scoreFindings,
  stuckKeywordInputsFromGsc,
} from './score'

export type {
  ScoredRecommendation,
  ScoreInputs,
  ScoringContext,
  ScoringResult,
  UnscoredFinding,
} from './types'
