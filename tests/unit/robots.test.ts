// One test per defect in docs/robots-parser-findings.md, plus the spec behaviours the
// old code happened to get right (so a rewrite cannot quietly lose them).
//
// These are written from RFC 9309 and Google's published matching rules, NOT from
// lib/robots/index.ts — the same discipline the eval injectors use. A test derived from
// the implementation only proves the implementation is self-consistent.
import { describe, it, expect } from 'vitest'
import {
  GOOGLEBOT,
  blockedUrls,
  blocksSiteRoot,
  disallowPatterns,
  groupFor,
  isUrlAllowed,
  parseRobotsTxt,
  robotsPatternMatches,
  robotsTarget,
} from '@/lib/robots'

const allowed = (txt: string, url: string, agent = GOOGLEBOT) =>
  isUrlAllowed(url, parseRobotsTxt(txt), agent)

describe('robots: pattern matching', () => {
  it('is a prefix match when unanchored', () => {
    expect(robotsPatternMatches('/services/plumbing', '/services/')).toBe(true)
    expect(robotsPatternMatches('/about', '/services/')).toBe(false)
  })

  it('honours a trailing $ as an end anchor', () => {
    expect(robotsPatternMatches('/page.php', '/page.php$')).toBe(true)
    expect(robotsPatternMatches('/page.php?x=1', '/page.php$')).toBe(false)
  })

  it('treats * as any run of characters', () => {
    expect(robotsPatternMatches('/a/deep/path/file.pdf', '/a/*/file.pdf')).toBe(true)
    expect(robotsPatternMatches('/a/file.pdf', '/a/*.pdf')).toBe(true)
    expect(robotsPatternMatches('/a/file.txt', '/a/*.pdf')).toBe(false)
  })

  it('combines * with a $ anchor', () => {
    expect(robotsPatternMatches('/x/y.pdf', '/*.pdf$')).toBe(true)
    expect(robotsPatternMatches('/x/y.pdf?v=2', '/*.pdf$')).toBe(false)
  })

  it('does not treat regex metacharacters as syntax', () => {
    // A literal '.' must not match an arbitrary character.
    expect(robotsPatternMatches('/aXb', '/a.b')).toBe(false)
    expect(robotsPatternMatches('/a.b', '/a.b')).toBe(true)
  })
})

// DEFECT 1 — the regex build backtracked catastrophically: 10 wildcards took 19.1s
// against a 40-character path. robots.txt is third-party input, so this was a hang
// reachable without an attacker.
describe('robots: DEFECT 1 — no catastrophic backtracking', () => {
  it('matches a pathological wildcard rule in well under a second', () => {
    const rule = '/' + '*a'.repeat(20) + '$'
    const target = '/' + 'a'.repeat(200) + 'b'
    const t0 = Date.now()
    const result = robotsPatternMatches(target, rule)
    const ms = Date.now() - t0
    expect(result).toBe(false)
    // The old implementation could not finish 10 wildcards in 19 seconds.
    expect(ms).toBeLessThan(250)
  })

  it('stays linear as wildcard count grows', () => {
    const target = '/' + 'a'.repeat(200) + 'b'
    const time = (n: number) => {
      const rule = '/' + '*a'.repeat(n) + '$'
      const t0 = Date.now()
      robotsPatternMatches(target, rule)
      return Date.now() - t0
    }
    time(4)
    expect(time(24)).toBeLessThan(250)
  })
})

// DEFECT 2 — `Allow:` was not implemented at all.
describe('robots: DEFECT 2 — Allow overrides a broader Disallow', () => {
  it('lets the longest matching pattern win', () => {
    const txt = 'User-agent: *\nDisallow: /services/\nAllow: /services/plumbing/\n'
    expect(allowed(txt, 'https://x.com/services/plumbing/emergency')).toBe(true)
    expect(allowed(txt, 'https://x.com/services/hvac')).toBe(false)
  })

  it('handles the most common robots.txt on the internet', () => {
    const txt = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n'
    expect(allowed(txt, 'https://x.com/wp-admin/admin-ajax.php')).toBe(true)
    expect(allowed(txt, 'https://x.com/wp-admin/options.php')).toBe(false)
  })

  it('breaks an equal-specificity tie in favour of Allow', () => {
    const txt = 'User-agent: *\nDisallow: /a/b\nAllow: /a/b\n'
    expect(allowed(txt, 'https://x.com/a/b')).toBe(true)
  })

  it('still reports the Disallow pattern for the evidence string', () => {
    // Reporting and deciding are separate: the rule exists even where an Allow wins.
    const txt = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n'
    expect(disallowPatterns(txt)).toEqual(['/wp-admin/'])
  })
})

// DEFECT 3 — the `*` and `Googlebot` groups were unioned. Exactly one group applies.
describe('robots: DEFECT 3 — user-agent group precedence', () => {
  it('ignores the * group entirely when a Googlebot group exists', () => {
    const txt = 'User-agent: *\nDisallow: /services/\n\nUser-agent: Googlebot\nDisallow:\n'
    expect(disallowPatterns(txt)).toEqual([])
    expect(allowed(txt, 'https://x.com/services/plumbing')).toBe(true)
  })

  it('still applies the Googlebot group’s own rules', () => {
    const txt = 'User-agent: *\nDisallow:\n\nUser-agent: Googlebot\nDisallow: /private/\n'
    expect(allowed(txt, 'https://x.com/private/x')).toBe(false)
    expect(allowed(txt, 'https://x.com/public')).toBe(true)
  })

  it('falls back to * when no group names the crawler', () => {
    const txt = 'User-agent: *\nDisallow: /x/\n'
    expect(allowed(txt, 'https://x.com/x/y')).toBe(false)
  })

  it('merges two groups that name the same agent', () => {
    const txt =
      'User-agent: Googlebot\nDisallow: /a/\n\nUser-agent: Googlebot\nDisallow: /b/\n'
    expect(disallowPatterns(txt).sort()).toEqual(['/a/', '/b/'])
  })

  it('is case-insensitive on the agent token only', () => {
    const txt = 'User-agent: GoOgLeBoT\nDisallow: /a/\n'
    expect(allowed(txt, 'https://x.com/a/b')).toBe(false)
  })
})

// DEFECT 4 — includes('googlebot') also matched Googlebot-Image/-News/-Video, so a
// routine image-only block reported the WHOLE SITE blocked from Google.
describe('robots: DEFECT 4 — Googlebot-* are distinct product tokens', () => {
  it('does not let a Googlebot-Image group bind the web crawler', () => {
    const txt = 'User-agent: Googlebot-Image\nDisallow: /\n'
    expect(disallowPatterns(txt)).toEqual([])
    expect(allowed(txt, 'https://x.com/anything')).toBe(true)
    expect(blocksSiteRoot(txt)).toBe(false)
  })

  it('still binds the image crawler when that is who we ask about', () => {
    const txt = 'User-agent: Googlebot-Image\nDisallow: /\n'
    expect(allowed(txt, 'https://x.com/a.jpg', 'googlebot-image')).toBe(false)
  })

  it('prefers the * group over an unrelated Googlebot-News group', () => {
    const txt = 'User-agent: *\nDisallow: /x/\n\nUser-agent: Googlebot-News\nDisallow: /\n'
    expect(allowed(txt, 'https://x.com/y')).toBe(true)
    expect(allowed(txt, 'https://x.com/x/y')).toBe(false)
  })
})

// DEFECT 5 — each user-agent line overwrote the flag, so the last one won and
// Googlebot's real rules were dropped. A genuine block reported `pass`.
describe('robots: DEFECT 5 — multiple user-agent lines share one group', () => {
  it('applies rules when Googlebot is named first', () => {
    const txt = 'User-agent: googlebot\nUser-agent: bingbot\nDisallow: /services/\n'
    expect(disallowPatterns(txt)).toEqual(['/services/'])
    expect(allowed(txt, 'https://x.com/services/x')).toBe(false)
  })

  it('applies rules when Googlebot is named last', () => {
    const txt = 'User-agent: bingbot\nUser-agent: googlebot\nDisallow: /services/\n'
    expect(allowed(txt, 'https://x.com/services/x')).toBe(false)
  })

  it('starts a new group when a user-agent line follows rules', () => {
    const txt = 'User-agent: googlebot\nDisallow: /a/\nUser-agent: bingbot\nDisallow: /b/\n'
    expect(disallowPatterns(txt)).toEqual(['/a/'])
    expect(allowed(txt, 'https://x.com/b/x')).toBe(true)
  })
})

// DEFECT 6 — only whole-line comments were skipped, so a trailing comment became part
// of the rule and the rule then matched nothing.
describe('robots: DEFECT 6 — inline comments are stripped', () => {
  it('does not absorb a trailing comment into the pattern', () => {
    const txt = 'User-agent: *\nDisallow: /services/ # money pages\n'
    expect(disallowPatterns(txt)).toEqual(['/services/'])
    expect(allowed(txt, 'https://x.com/services/plumbing')).toBe(false)
  })

  it('still skips whole-line comments', () => {
    const txt = '# a note\nUser-agent: *\n# another\nDisallow: /x/\n'
    expect(disallowPatterns(txt)).toEqual(['/x/'])
  })
})

// DEFECT 7 — matching ran against pathname only, so a pattern containing `?` could
// never match.
describe('robots: DEFECT 7 — query strings are matchable', () => {
  it('includes the query string in the match target', () => {
    expect(robotsTarget('https://x.com/p?sessionid=1')).toBe('/p?sessionid=1')
  })

  it('blocks a session-id parameter rule', () => {
    const txt = 'User-agent: *\nDisallow: /*?\n'
    expect(allowed(txt, 'https://x.com/p?sessionid=1')).toBe(false)
    expect(allowed(txt, 'https://x.com/p')).toBe(true)
  })
})

// Paths are case-sensitive per spec; only the user-agent token is not. Both old
// implementations lowercased the path AND the rule.
describe('robots: paths are case-sensitive', () => {
  it('does not let /Admin block /admin', () => {
    const txt = 'User-agent: *\nDisallow: /Admin/\n'
    expect(allowed(txt, 'https://x.com/admin/x')).toBe(true)
    expect(allowed(txt, 'https://x.com/Admin/x')).toBe(false)
  })
})

describe('robots: absent or empty directives', () => {
  it('treats a missing robots.txt as allow-all', () => {
    expect(disallowPatterns(null)).toEqual([])
    expect(blockedUrls(null, ['https://x.com/a'])).toEqual([])
    expect(blocksSiteRoot(null)).toBe(false)
  })

  it('treats an empty Disallow as allow-all', () => {
    const txt = 'User-agent: *\nDisallow:\n'
    expect(disallowPatterns(txt)).toEqual([])
    expect(allowed(txt, 'https://x.com/anything')).toBe(true)
  })

  it('ignores rules that appear before any user-agent line', () => {
    expect(disallowPatterns('Disallow: /x/\nUser-agent: *\nDisallow: /y/\n')).toEqual(['/y/'])
  })

  it('returns no group when robots.txt names only other crawlers', () => {
    expect(groupFor(parseRobotsTxt('User-agent: bingbot\nDisallow: /\n'))).toBeNull()
  })

  it('detects a genuine root block', () => {
    expect(blocksSiteRoot('User-agent: *\nDisallow: /\n')).toBe(true)
  })
})

describe('robots: blockedUrls reports a magnitude', () => {
  it('counts only the URLs actually blocked', () => {
    const txt = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n'
    expect(
      blockedUrls(txt, [
        'https://x.com/',
        'https://x.com/wp-admin/options.php',
        'https://x.com/wp-admin/admin-ajax.php',
      ])
    ).toEqual(['https://x.com/wp-admin/options.php'])
  })
})
