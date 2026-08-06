// One test per defect in docs/robots-parser-findings.md, plus the spec behaviours the
// old code happened to get right (so a rewrite cannot quietly lose them).
//
// These are written from RFC 9309 and Google's published matching rules, NOT from
// lib/robots/index.ts — the same discipline the eval injectors use. A test derived from
// the implementation only proves the implementation is self-consistent.
import { describe, it, expect } from 'vitest'
import {
  GOOGLEBOT,
  MAX_ROBOTS_BYTES,
  blockedUrls,
  blocksSiteRoot,
  disallowPatterns,
  groupFor,
  isUrlAllowed,
  normalizeAgentToken,
  normalizeRobotsPath,
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

// ─── APPEND to tests/unit/robots.test.ts ───
// Second round. Found by an adversarial spec-conformance pass over the first version,
// then each claim checked against Google's robots.txt documentation directly — one of
// the five claims was WRONG and is asserted here as correct-as-was, so a future reader
// does not "fix" it back.
//

// Google: "the lines must be separated by CR, CR/LF, or LF". Splitting on /\r?\n/
// collapsed a CR-only file into one line and dropped every rule — a real block read
// as pass, which is the §17 failure mode.
describe('robots: line terminators — CR, CRLF and LF are all valid', () => {
  it('parses a CR-only file', () => {
    const txt = 'User-agent: *\rDisallow: /services/\r'
    expect(disallowPatterns(txt)).toEqual(['/services/'])
    expect(allowed(txt, 'https://x.com/services/plumbing')).toBe(false)
  })

  it('parses a CRLF file', () => {
    const txt = 'User-agent: *\r\nDisallow: /services/\r\n'
    expect(disallowPatterns(txt)).toEqual(['/services/'])
  })

  it('parses a file mixing all three', () => {
    const txt = 'User-agent: *\rDisallow: /a/\r\nDisallow: /b/\nDisallow: /c/'
    expect(disallowPatterns(txt)).toEqual(['/a/', '/b/', '/c/'])
  })
})

// Google: "All non-matching text is ignored (for example, both googlebot/1.2 and
// googlebot* are equivalent to googlebot)."
describe('robots: user-agent tokens are normalised', () => {
  it('strips a version suffix', () => {
    expect(normalizeAgentToken('Googlebot/2.1')).toBe('googlebot')
    expect(allowed('User-agent: Googlebot/2.1\nDisallow: /a/\n', 'https://x.com/a/b')).toBe(false)
  })

  it('strips a trailing wildcard', () => {
    expect(normalizeAgentToken('googlebot*')).toBe('googlebot')
  })

  it('reduces a decorated wildcard to *', () => {
    expect(normalizeAgentToken('* (all bots)')).toBe('*')
    expect(allowed('User-agent: * (all bots)\nDisallow: /a/\n', 'https://x.com/a/b')).toBe(false)
  })

  it('keeps a hyphenated sub-crawler token intact', () => {
    expect(normalizeAgentToken('Googlebot-Image')).toBe('googlebot-image')
  })
})

// Google: "Non-7-bit ASCII characters in a path may be included as UTF-8 characters or
// as percent-escaped UTF-8 encoded characters per RFC 3986." Both sides must normalise
// to one representation or a literal-UTF-8 rule can never match an encoded URL.
describe('robots: percent-encoding is normalised on both sides', () => {
  it('matches a literal UTF-8 rule against a percent-encoded URL', () => {
    const txt = 'User-agent: *\nDisallow: /città/\n'
    expect(allowed(txt, 'https://x.com/citt%C3%A0/pizza')).toBe(false)
  })

  it('matches a percent-encoded rule against a literal UTF-8 URL', () => {
    const txt = 'User-agent: *\nDisallow: /citt%C3%A0/\n'
    expect(allowed(txt, 'https://x.com/città/pizza')).toBe(false)
  })

  it('does NOT decode reserved ASCII escapes — %2F is not /', () => {
    // Decoding %2F would change the path's structure, so it stays escaped.
    expect(normalizeRobotsPath('/a%2Fb')).toBe('/a%2Fb')
    expect(normalizeRobotsPath('/a%2fb')).toBe('/a%2Fb') // canonical upper case
  })

  it('leaves a malformed escape alone rather than throwing', () => {
    expect(() => normalizeRobotsPath('/a%ZZ%C3')).not.toThrow()
  })
})

// Google: "Google enforces a robots.txt file size limit of 500 kibibytes (KiB). Content
// which is after the maximum file size is ignored." Honouring rules past the cut is a
// false positive — reporting a block Google never saw.
describe('robots: the 500 KiB limit is enforced', () => {
  it('ignores a rule past the size limit', () => {
    const padding = '# ' + 'x'.repeat(200) + '\n'
    const head = 'User-agent: *\nDisallow: /early/\n'
    const filler = padding.repeat(Math.ceil(MAX_ROBOTS_BYTES / padding.length) + 1)
    const txt = head + filler + 'Disallow: /late/\n'
    const patterns = disallowPatterns(txt)
    expect(patterns).toContain('/early/')
    expect(patterns).not.toContain('/late/')
  })

  it('does not honour a rule the size cut truncated mid-line', () => {
    // Whatever survives must be a whole line; a half-read pattern must not apply.
    const filler = ('# ' + 'y'.repeat(120) + '\n').repeat(4400)
    const txt = 'User-agent: *\nDisallow: /keep/\n' + filler + 'Disallow: /cut-here-somewhere/\n'
    expect(disallowPatterns(txt).every((p) => !p.startsWith('/cut'))).toBe(true)
  })
})

// The bare trailing `?` is exactly what a `Disallow: /*?` rule exists to catch, and
// URL.search reports '' for it — so the query had to come from the raw URL.
describe('robots: query-string edge cases', () => {
  it('keeps a bare trailing ?', () => {
    expect(robotsTarget('https://x.com/p?')).toBe('/p?')
    expect(allowed('User-agent: *\nDisallow: /*?\n', 'https://x.com/p?')).toBe(false)
  })

  it('drops the fragment, which is never sent to a server', () => {
    expect(robotsTarget('https://x.com/p?a=1#frag')).toBe('/p?a=1')
  })

  it('treats a missing path as /', () => {
    expect(robotsTarget('https://x.com')).toBe('/')
    expect(robotsTarget('https://x.com?a=1')).toBe('/?a=1')
  })
})

// Returning the raw string for an unparseable URL made every scheme-less URL compare
// against a pattern anchored at '/', so nothing matched and it silently read as allowed.
describe('robots: unreadable URLs are reported, not silently allowed', () => {
  it('returns null when no path can be located', () => {
    expect(robotsTarget('example.com/path')).toBeNull()
    expect(robotsTarget('mailto:a@b.c')).toBeNull()
  })

  it('accepts an already-relative path', () => {
    expect(robotsTarget('/a/b?c=1')).toBe('/a/b?c=1')
  })

  it('does not count an unreadable URL as blocked', () => {
    // No rule can be shown to apply, so this is not evidence of a block.
    expect(blockedUrls('User-agent: *\nDisallow: /\n', ['example.com/path'])).toEqual([])
  })
})

// A reviewer claimed Googlebot-Image should fall back to the `googlebot` group. Google's
// docs say otherwise — "Storebot-Google follows group 2, because there is no specific
// Storebot-Google group", group 2 being the `*` group. Implementing the claim would have
// made an image-only block close the whole site to the web crawler again, so this is
// pinned deliberately.
describe('robots: sub-crawlers fall back to * and NOT to their parent group', () => {
  it('sends Googlebot-Image to the * group, not the googlebot group', () => {
    const txt =
      'User-agent: googlebot\nDisallow: /web-only/\n\nUser-agent: *\nDisallow: /everyone/\n'
    expect(allowed(txt, 'https://x.com/web-only/x', 'googlebot-image')).toBe(true)
    expect(allowed(txt, 'https://x.com/everyone/x', 'googlebot-image')).toBe(false)
    // And the web crawler still obeys its own group.
    expect(allowed(txt, 'https://x.com/web-only/x')).toBe(false)
  })

  it('leaves a sub-crawler unconstrained when there is no * group either', () => {
    expect(allowed('User-agent: googlebot\nDisallow: /\n', 'https://x.com/a', 'googlebot-image'))
      .toBe(true)
  })
})


// The first pass asserted a bound on ONE robotsPatternMatches call. The detector calls
// blockedUrls, which is rules x urls — verification measured 2.9s on 13,355 rules x
// 10,000 URLs, so the aggregate path needs its own bound.
describe('robots: the aggregate blockedUrls path is bounded too', () => {
  it('handles a large rule set against a realistic crawl quickly', () => {
    const rules = Array.from({ length: 1000 }, (_, i) => `Disallow: /never-matches-${i}/`)
    const txt = ['User-agent: *', ...rules].join('\n')
    const urls = Array.from({ length: 206 }, (_, i) => `https://x.com/page-${i}`)
    const t0 = Date.now()
    expect(blockedUrls(txt, urls)).toEqual([])
    expect(Date.now() - t0).toBeLessThan(400)
  })

  it('resolves the governing group once, not once per URL', () => {
    // A regression guard for the hoist: with the group resolved per URL this same shape
    // spent ~30% of its runtime re-running groups.filter and chosen.flatMap.
    const rules = Array.from({ length: 2000 }, (_, i) => `Disallow: /x-${i}/`)
    const txt = ['User-agent: *', ...rules].join('\n')
    const urls = Array.from({ length: 1000 }, (_, i) => `https://x.com/p-${i}`)
    const t0 = Date.now()
    blockedUrls(txt, urls)
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})
