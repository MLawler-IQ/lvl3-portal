// Pure display helpers for GBP location labels — safe to import from client
// components (no googleapis / server deps).

/** True when several locations share one title (chain brands, e.g. "True Food Kitchen"). */
export function hasDuplicateTitles(titles: Array<string | null | undefined>): boolean {
  const seen = new Set<string>()
  for (const t of titles) {
    const key = (t ?? '').trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/**
 * Display label for a GBP location. When titles are duplicated across the
 * account (multi-location brands) and the city is known, prefer "City, ST" —
 * a row of identical brand names tells you nothing.
 */
export function gbpLocationLabel(
  title: string,
  locality?: string | null,
  administrativeArea?: string | null,
  preferCity = false,
): string {
  if (preferCity && locality) {
    return administrativeArea ? `${locality}, ${administrativeArea}` : locality
  }
  return title
}
