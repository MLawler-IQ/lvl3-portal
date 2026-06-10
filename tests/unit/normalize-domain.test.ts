import { describe, expect, it } from 'vitest'

import { normalizeDomain } from '@/lib/normalize-domain'

describe('normalizeDomain', () => {
  it('strips the GSC sc-domain: prefix', () => {
    expect(normalizeDomain('sc-domain:example.com')).toBe('example.com')
    expect(normalizeDomain('sc-domain:www.example.com')).toBe('example.com')
  })

  it('extracts the hostname from full URLs with paths and query strings', () => {
    expect(normalizeDomain('https://www.brand.com/services/plumbing?utm_source=x#top')).toBe(
      'brand.com',
    )
    expect(normalizeDomain('http://brand.com/path/')).toBe('brand.com')
  })

  it('drops ports', () => {
    expect(normalizeDomain('https://www.brand.com:8080/path')).toBe('brand.com')
    expect(normalizeDomain('localhost:3000')).toBe('localhost')
  })

  it('strips the www. prefix', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com')
    expect(normalizeDomain('https://WWW.Example.COM')).toBe('example.com')
  })

  it('preserves non-www subdomains', () => {
    expect(normalizeDomain('shop.brand.com')).toBe('shop.brand.com')
    expect(normalizeDomain('https://blog.brand.com/post')).toBe('blog.brand.com')
    expect(normalizeDomain('sc-domain:shop.brand.com')).toBe('shop.brand.com')
  })

  it('passes bare domains through, lowercased', () => {
    expect(normalizeDomain('example.com')).toBe('example.com')
    expect(normalizeDomain('  Example.COM  ')).toBe('example.com')
  })

  it('falls back to string cleanup for garbage that will not parse as a URL', () => {
    // Space in host makes URL() throw → fallback path
    expect(normalizeDomain('www.bad domain.com/path?q=1')).toBe('bad domain.com')
    expect(normalizeDomain('https://bad host.com:8080/x')).toBe('bad host.com')
    // Never throws, always returns a string
    expect(typeof normalizeDomain('   ')).toBe('string')
  })
})
