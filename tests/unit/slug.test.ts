import { describe, expect, it } from 'vitest'
import { FALLBACK_SLUG, MAX_SLUG_LENGTH, slugify, uniqueSlug } from '@/lib/slug'

describe('slugify', () => {
  it('lowercases and hyphenates ordinary business names', () => {
    expect(slugify('Acme HVAC')).toBe('acme-hvac')
    expect(slugify('Tornado Heating & Air')).toBe('tornado-heating-air')
    expect(slugify('acme')).toBe('acme')
  })

  it('folds accents to their ASCII base letter rather than dropping them', () => {
    // Dropping the letter would give "caf", which reads as a different word and
    // is what an admin retyping the slug by hand would get wrong.
    expect(slugify('Café Niño')).toBe('cafe-nino')
    expect(slugify('Ångström Plumbing')).toBe('angstrom-plumbing')
  })

  it('collapses runs of punctuation and whitespace into single hyphens', () => {
    expect(slugify('  Acme   ---  HVAC!!! ')).toBe('acme-hvac')
    expect(slugify("O'Brien & Sons, Inc.")).toBe('o-brien-sons-inc')
    expect(slugify('A/B/C')).toBe('a-b-c')
  })

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugify('---acme---')).toBe('acme')
    expect(slugify('!Acme!')).toBe('acme')
  })

  it('keeps digits, which appear in real brand names', () => {
    expect(slugify('24/7 Rooter 2')).toBe('24-7-rooter-2')
  })

  it('falls back to a usable slug for input with no ASCII content', () => {
    // An empty slug would produce a broken /clients/ route, so these must still
    // yield something routable.
    expect(slugify('')).toBe(FALLBACK_SLUG)
    expect(slugify('   ')).toBe(FALLBACK_SLUG)
    expect(slugify('🔥🔥🔥')).toBe(FALLBACK_SLUG)
    expect(slugify('!!!___###')).toBe(FALLBACK_SLUG)
  })

  it('caps length and does not end the truncated slug on a hyphen', () => {
    const long = slugify('Extremely Long Home Services Company Of Greater Metropolitan Area')
    expect(long.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(long.endsWith('-')).toBe(false)
    expect(long.startsWith('extremely-long-home-services')).toBe(true)
  })
})

describe('uniqueSlug', () => {
  it('returns the plain slug when nothing is taken', () => {
    expect(uniqueSlug('Acme HVAC', [])).toBe('acme-hvac')
    expect(uniqueSlug('Acme HVAC', ['other-client'])).toBe('acme-hvac')
  })

  it('suffixes -2 on the first collision', () => {
    expect(uniqueSlug('Acme HVAC', ['acme-hvac'])).toBe('acme-hvac-2')
  })

  it('walks the whole chain of collisions', () => {
    const taken = ['acme-hvac', 'acme-hvac-2', 'acme-hvac-3', 'acme-hvac-4']
    expect(uniqueSlug('Acme HVAC', taken)).toBe('acme-hvac-5')
  })

  it('skips past a gap rather than reusing a freed number', () => {
    // Numbering is "first free", not "highest + 1" — a deleted client leaves a
    // hole and reusing it is fine.
    expect(uniqueSlug('Acme HVAC', ['acme-hvac', 'acme-hvac-3'])).toBe('acme-hvac-2')
  })

  it('matches taken slugs case-insensitively', () => {
    expect(uniqueSlug('Acme HVAC', ['ACME-HVAC'])).toBe('acme-hvac-2')
    expect(uniqueSlug('Acme HVAC', ['Acme-Hvac', 'ACME-HVAC-2'])).toBe('acme-hvac-3')
  })

  it('ignores empty and whitespace entries in the taken list', () => {
    expect(uniqueSlug('Acme HVAC', ['', '   ', 'acme-hvac'])).toBe('acme-hvac-2')
  })

  it('accepts any iterable, including a Set', () => {
    expect(uniqueSlug('Acme HVAC', new Set(['acme-hvac']))).toBe('acme-hvac-2')
  })

  it('numbers the fallback slug so unnameable clients still get distinct slugs', () => {
    expect(uniqueSlug('🔥', [FALLBACK_SLUG])).toBe(`${FALLBACK_SLUG}-2`)
    expect(uniqueSlug('', [FALLBACK_SLUG, `${FALLBACK_SLUG}-2`])).toBe(`${FALLBACK_SLUG}-3`)
  })

  it('keeps suffixed slugs within the cap by trimming the stem', () => {
    const name = 'Extremely Long Home Services Company Of Greater Metropolitan Area'
    const base = slugify(name)
    const out = uniqueSlug(name, [base])
    expect(out.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(out.endsWith('-2')).toBe(true)
  })

  it('still resolves when trimming makes two long names collide on the same stem', () => {
    // The failure this guards: trimming the stem to fit the suffix can produce a
    // candidate that is itself already taken. Every candidate is re-checked, so
    // the loop must advance instead of returning a duplicate.
    const name = 'Extremely Long Home Services Company Of Greater Metropolitan Area'
    const base = slugify(name)
    const firstCollision = uniqueSlug(name, [base])
    const second = uniqueSlug(name, [base, firstCollision])
    expect(second).not.toBe(firstCollision)
    expect(second).not.toBe(base)
    expect(second.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
  })

  it('produces a slug that is stable under a second slugify pass', () => {
    // The modal shows the derived slug in an editable field; re-deriving from it
    // must not keep changing it.
    for (const name of ['Acme HVAC', 'Café Niño', '24/7 Rooter', '🔥']) {
      const once = slugify(name)
      expect(slugify(once)).toBe(once)
    }
  })
})
