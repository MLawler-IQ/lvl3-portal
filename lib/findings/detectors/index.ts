// CheckDefinition wrappers over the derived analyses in ../analyses.
//
// Only rubric checks live here. Of the four derived analyses, exactly one maps to
// a rubric row today:
//
//   ONPAGE-012  content-to-template ratio          → onpage-012.ts
//
// The other three deliberately have no wrapper:
//   · template grouping    — infrastructure. It makes other findings actionable
//                            ("one template fix covers 130 pages"); it is not
//                            itself a defect.
//   · visibility cohorts   — a diagnostic whose most valuable output is a NEGATIVE
//                            result. A check that fires on "the cohorts differ"
//                            would be a hypothesis, not a defect. It supplies half
//                            the evidence for ONPAGE-007 (uniform inbound link
//                            counts signalling no priority); the anchor-text half
//                            needs a crawl field that does not exist yet.
//   · opportunity sizing   — an input to scoring's impact number, not a pass/fail.
//
// Inventing rubric ids for the other three would put un-reviewed checks in front
// of clients. The registry in ../checks.ts imports from here.

export { onpage012 } from './onpage-012'

import type { CheckDefinition } from '@/lib/findings/types'
import { onpage012 } from './onpage-012'

/** Every derived-analysis-backed check, for the registry to spread in. */
export const DERIVED_CHECKS: CheckDefinition[] = [onpage012]
