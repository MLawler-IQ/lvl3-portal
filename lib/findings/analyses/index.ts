// The derived analyses: pure functions over station data. No network, no LLM, no
// clock, no randomness — given the same stations they return the same numbers.
//
// Each one is exported and tested independently of any CheckDefinition. Where a
// rubric check exists the wrapper in ../detectors is a thin adapter over the
// analysis, never the other way round; three of these four analyses have no
// rubric check at all and exist to feed scoring and synthesis.

export {
  DEFAULT_MIN_FAMILY_SIZE,
  deriveTemplateKey,
  deriveTemplatePattern,
  groupByUrlTemplate,
  groupKeyFor,
  normalizeUrlKey,
  templateFixLeverage,
} from './template-groups'
export type {
  TemplateGroup,
  TemplateGrouping,
  TemplateGroupingOptions,
  TemplateLeverage,
} from './template-groups'

export {
  DEFAULT_COHORT_METRICS,
  DEFAULT_INDISTINGUISHABLE_WITHIN_PCT,
  visibilityCohorts,
} from './visibility-cohort'
export type {
  CohortComparison,
  CohortMetric,
  CohortSplitMetric,
  CohortStat,
  VisibilityCohortAnalysis,
  VisibilityCohortOptions,
} from './visibility-cohort'

export {
  DEFAULT_CTR_BY_POSITION,
  DEFAULT_MIN_IMPRESSIONS,
  DEFAULT_TAIL_CTR,
  DEFAULT_TARGET_POSITION,
  ctrFromTable,
  defaultCtrCurve,
  opportunityByTemplateFamily,
  sizeOpportunity,
} from './opportunity-sizing'
export type {
  CtrCurve,
  OpportunityRow,
  OpportunitySizing,
  OpportunitySizingOptions,
  OpportunityUnit,
  TemplateFamilyOpportunity,
} from './opportunity-sizing'

export {
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_MIN_UNIQUE_SHARE,
  contentToTemplateRatio,
  uniqueShare,
} from './content-template-ratio'
export type {
  ContentTemplateRatioAnalysis,
  ContentTemplateRatioOptions,
  TemplateContentRatio,
} from './content-template-ratio'

export { mean, median, pct, relativeGap } from './stats'
