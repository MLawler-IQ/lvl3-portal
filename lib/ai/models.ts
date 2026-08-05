// Model ids in one place.
//
// The string 'claude-sonnet-4-6' is currently a hardcoded literal in 10+ files
// and 'claude-haiku-4-5-20251001' in 5 more, so a model bump means a grep. New
// code uses these constants; the existing call sites are left alone rather than
// swept in an unrelated slice.

/** Reasoning-heavy work: synthesis, agentic loops, anything client-facing. */
export const MODEL_SONNET = 'claude-sonnet-4-6'

/** Cheap, high-volume extraction, classification and formatting. */
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001'
