/**
 * Best-effort in-memory IP rate limiter for public route handlers (same
 * approach and caveat as app/api/report-chat: per lambda instance only).
 */
export function createIpLimiter({
  windowMs,
  max,
}: {
  windowMs: number
  max: number
}): (ip: string) => boolean {
  const hits = new Map<string, number[]>()
  return function rateLimited(ip: string): boolean {
    const now = Date.now()
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
    recent.push(now)
    hits.set(ip, recent)
    return recent.length > max
  }
}
