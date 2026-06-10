/**
 * SSRF guard for user-supplied URLs the server will fetch (page crawler,
 * SEO/CRO audits). Blocks non-HTTP(S) schemes and private / reserved /
 * link-local hosts — including the cloud metadata endpoint 169.254.169.254.
 *
 * Note: fetches still follow redirects, so a public URL could in theory
 * redirect to an internal host; this guard covers the common direct-SSRF
 * vector. Tightening to re-validate post-redirect is a follow-up.
 */

const PRIVATE_IPV4 = [
  /^127\./, // loopback
  /^10\./, // private
  /^0\./, // "this" network
  /^192\.168\./, // private
  /^169\.254\./, // link-local incl. cloud metadata
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
]

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local')
  ) {
    return true
  }
  if (h === '::1' || h === '0.0.0.0') return true
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true // IPv6 ULA / link-local
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return PRIVATE_IPV4.some((re) => re.test(h))
  }
  return false
}

/** Throws if the URL isn't a fetchable public http(s) address. Returns the parsed URL. */
export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Refusing to fetch a private or internal address')
  }
  return parsed
}
