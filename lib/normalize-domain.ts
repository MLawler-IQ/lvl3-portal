/**
 * Normalize any domain-ish input — GSC `sc-domain:` properties, full URLs
 * (with paths, ports, or query strings), or bare hosts — to a lowercase
 * hostname without the `www.` prefix. Subdomains are preserved
 * (shop.brand.com stays shop.brand.com). URL().hostname-based so URL
 * components never leak into the result; falls back to string cleanup for
 * inputs that won't parse as URLs.
 */
export function normalizeDomain(raw: string): string {
  const cleaned = raw.replace(/^sc-domain:/, '').trim()
  try {
    const host = new URL(cleaned.includes('://') ? cleaned : `https://${cleaned}`).hostname
    return host.replace(/^www\./, '').toLowerCase()
  } catch {
    return cleaned
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[/?#:].*$/, '')
      .toLowerCase()
      .trim()
  }
}

/**
 * Does a Search Console property cover this domain?
 *
 * A `sc-domain:` property covers its own domain AND every subdomain, so it also
 * matches when the target is a subdomain of it. A URL-prefix property has to be
 * an exact host match — `https://shop.brand.com/` does not cover `brand.com`.
 *
 * Lifted out of app/actions/analytics.ts, where it was module-private inside a
 * `'use server'` file and therefore unexportable (every export there has to be
 * an async server action). It belongs next to normalizeDomain anyway.
 */
export function siteMatchesDomain(site: string, domain: string): boolean {
  if (site.startsWith('sc-domain:')) {
    const d = normalizeDomain(site)
    return d === domain || domain.endsWith('.' + d)
  }
  return normalizeDomain(site) === domain
}
