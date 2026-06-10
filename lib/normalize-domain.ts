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
