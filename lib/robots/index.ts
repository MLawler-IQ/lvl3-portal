// One robots.txt implementation, shared by the detector and the eval predicates.
//
// There used to be two — `parseGooglebotDisallows`/`pathMatchesRule` in
// lib/findings/checks.ts and `googlebotDisallowRules`/`robotsPathBlocked` in
// lib/eval/injectors/predicates.ts — and they returned OPPOSITE answers on three
// probes. That is worse than either being wrong alone: the eval gate can go green
// while the detector is wrong, or red while it is right, so the gate stops carrying
// information. See docs/robots-parser-findings.md for the defects this replaces.
//
// Written against RFC 9309 and Google's published matching rules, quoted inline where
// the behaviour is surprising. Independence lives in tests/unit/robots.test.ts, which is
// written from those documents rather than from this file.
//
// The behaviours that matter, each of which an earlier version got wrong:
//
//   GROUPS      A group is one or more consecutive `user-agent` lines plus the rules
//               that follow. A `user-agent` line appearing AFTER rules starts a new
//               group. Groups naming the same agent are merged.
//   PRECEDENCE  Exactly ONE group applies: "Only one group is valid for a particular
//               crawler." The `*` group is a fallback used only when no group names the
//               crawler — never unioned with it.
//   NO PARENT   There is deliberately NO fallback from a sub-crawler to its parent.
//   FALLBACK    Google's own example: "Storebot-Google follows group 2, because there is
//               no specific Storebot-Google group", where group 2 is the `*` group. So
//               `Googlebot-Image` with no group of its own obeys `*`, NOT `Googlebot`.
//               This was verified against the docs after a reviewer claimed the
//               opposite; implementing that claim would have made an image-only block
//               close the whole site to the web crawler again.
//   TOKENS      `Googlebot-Image`, `-News` and `-Video` are DIFFERENT product tokens, so
//               matching is on the token, not a substring. But the token must first be
//               NORMALISED: "All non-matching text is ignored (for example, both
//               googlebot/1.2 and googlebot* are equivalent to googlebot)."
//   ALLOW       `Allow:` wins by LONGEST matching pattern; "in case of conflicting
//               rules, Google uses the least restrictive rule", so an exact tie goes to
//               Allow.
//   COMMENTS    A trailing `# comment` is stripped, not just a whole-line one.
//   CASE        Paths are CASE-SENSITIVE; only the user-agent token is not.
//   ENCODING    "Non-7-bit ASCII characters in a path may be included as UTF-8
//               characters or as percent-escaped UTF-8 encoded characters per RFC 3986."
//               Both sides are normalised to one representation before comparing, or a
//               rule written in literal UTF-8 could never match a percent-encoded URL.
//   LINE ENDS   "the lines must be separated by CR, CR/LF, or LF" — a BARE CR is a valid
//               separator. Splitting on /\r?\n/ collapsed a CR-only file into a single
//               line and silently dropped every rule, turning a real block into a pass.
//   SIZE        "Google enforces a robots.txt file size limit of 500 kibibytes (KiB).
//               Content which is after the maximum file size is ignored." Honouring
//               rules Google would never read produces a false positive.
//   QUERY       Patterns may contain `?`, so matching runs against path + query.
//
// Matching is deliberately regex-free. Compiling `*` into `.*` gave catastrophic
// backtracking — measured 1ms / 57ms / 1.4s / 19.1s at 4 / 6 / 8 / 10 wildcards, and
// robots.txt is fetched from the client's own site, so a pathological rule file hung
// the crawl station with no attacker involved. The segment walk below is O(n·m) with no
// backtracking: because `*` can absorb any run of characters, matching each literal
// segment at its earliest possible position is always safe, so no retry is ever needed.

/** One rule line. `allow: false` is a Disallow. */
export interface RobotsRule {
  allow: boolean
  /** Path pattern, case preserved, encoding-normalised. May contain `*` and a trailing `$`. */
  pattern: string
}

/** One `user-agent` group and the rules that follow it. */
export interface RobotsGroup {
  /** Normalised, lowercased product tokens this group names. */
  agents: string[]
  rules: RobotsRule[]
}

/** The crawler we evaluate for. Google's web crawler product token. */
export const GOOGLEBOT = 'googlebot'

/** Google ignores everything past 500 KiB. */
export const MAX_ROBOTS_BYTES = 500 * 1024

/**
 * Normalise a user-agent value to its product token.
 *
 * "All non-matching text is ignored (for example, both `googlebot/1.2` and `googlebot*`
 * are equivalent to `googlebot`)." A product token is `[a-zA-Z_-]+`, so everything from
 * the first character outside that set is dropped. `*` stays `*`, including when it
 * carries a trailing comment-like suffix such as `* (all bots)`.
 */
export function normalizeAgentToken(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('*')) return '*'
  const m = /^[a-zA-Z_-]+/.exec(trimmed)
  return m ? m[0].toLowerCase() : ''
}

/**
 * Put a path or pattern into ONE encoding so the two sides are comparable.
 *
 * Percent-escapes whose byte is >= 0x80 are part of a UTF-8 sequence and get decoded to
 * the character they denote, so `/citt%C3%A0/` and `/città/` compare equal. ASCII-range
 * escapes are deliberately LEFT ENCODED and merely upper-cased: `%2F` is not
 * interchangeable with `/`, and decoding it would change the path's structure.
 */
export function normalizeRobotsPath(input: string): string {
  if (!input.includes('%')) return input
  let out = ''
  for (let i = 0; i < input.length; ) {
    if (input[i] !== '%' || i + 2 >= input.length) {
      out += input[i]
      i += 1
      continue
    }
    const hex = input.slice(i + 1, i + 3)
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
      out += input[i]
      i += 1
      continue
    }
    const byte = parseInt(hex, 16)
    if (byte < 0x80) {
      // Reserved/ASCII escape: keep it escaped, canonical upper case.
      out += `%${hex.toUpperCase()}`
      i += 3
      continue
    }
    // Collect the whole UTF-8 sequence, then decode it in one go.
    let seq = ''
    let j = i
    while (j + 2 < input.length && input[j] === '%') {
      const h = input.slice(j + 1, j + 3)
      if (!/^[0-9a-fA-F]{2}$/.test(h) || parseInt(h, 16) < 0x80) break
      seq += `%${h}`
      j += 3
    }
    try {
      out += decodeURIComponent(seq)
    } catch {
      out += seq // malformed sequence: leave it alone rather than throw
    }
    i = j
  }
  return out
}

/**
 * Split robots.txt into groups, preserving order.
 *
 * A `user-agent` line following one or more rules begins a new group; consecutive
 * `user-agent` lines accumulate into the same group's agent list.
 */
export function parseRobotsTxt(body: string): RobotsGroup[] {
  // Enforce the size limit on BYTES, not characters, then drop the partial line the
  // cut may have left, so a truncated rule cannot be honoured as a whole one.
  let text = body
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_ROBOTS_BYTES) {
    text = Buffer.from(text, 'utf8').subarray(0, MAX_ROBOTS_BYTES).toString('utf8')
    const lastBreak = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'))
    text = lastBreak === -1 ? '' : text.slice(0, lastBreak)
  }

  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let sawRuleInCurrent = false

  // CR, CR/LF and LF are all valid separators.
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    // Strip trailing comments before anything else, so a rule can never absorb one.
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line === '') continue
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const field = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()

    if (field === 'user-agent') {
      if (current === null || sawRuleInCurrent) {
        current = { agents: [], rules: [] }
        groups.push(current)
        sawRuleInCurrent = false
      }
      const token = normalizeAgentToken(value)
      if (token !== '') current.agents.push(token)
      continue
    }

    if (field === 'allow' || field === 'disallow') {
      if (current === null) continue // rules before any user-agent line are ignored
      sawRuleInCurrent = true
      // `Disallow:` with an empty value is an explicit allow-all and contributes no
      // rule. An empty `Allow:` is likewise meaningless.
      if (value === '') continue
      current.rules.push({ allow: field === 'allow', pattern: normalizeRobotsPath(value) })
      continue
    }
    // sitemap:, crawl-delay: and unknown fields do not affect grouping.
  }

  return groups
}

/**
 * The single group that governs `agent`, with same-agent groups merged.
 *
 * Returns null when nothing applies — which means "allowed", not "blocked". Note there
 * is NO parent-crawler fallback: an agent with no group of its own gets `*` or nothing.
 */
export function groupFor(groups: RobotsGroup[], agent: string = GOOGLEBOT): RobotsGroup | null {
  const token = normalizeAgentToken(agent)
  const exact = groups.filter((g) => g.agents.includes(token))
  const chosen = exact.length > 0 ? exact : groups.filter((g) => g.agents.includes('*'))
  if (chosen.length === 0) return null
  return { agents: [token], rules: chosen.flatMap((g) => g.rules) }
}

/**
 * Does `pattern` match `target`? Linear, no regex, no backtracking.
 *
 * `*` matches any run of characters; a trailing `$` anchors the end of the target.
 */
export function robotsPatternMatches(target: string, pattern: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern

  if (!body.includes('*')) {
    return anchored ? target === body : target.startsWith(body)
  }

  const parts = body.split('*')
  const first = parts[0]
  if (!target.startsWith(first)) return false
  let pos = first.length

  // Every interior segment must appear in order. Earliest position is always safe.
  for (let i = 1; i < parts.length - 1; i++) {
    const seg = parts[i]
    if (seg === '') continue
    const at = target.indexOf(seg, pos)
    if (at === -1) return false
    pos = at + seg.length
  }

  const last = parts[parts.length - 1]
  if (last === '') return true // pattern ends in `*`, so the tail is free
  if (anchored) {
    if (!target.endsWith(last)) return false
    return target.length - last.length >= pos
  }
  return target.indexOf(last, pos) !== -1
}

/**
 * What a pattern is matched against: path plus query, case preserved, encoding-normalised.
 *
 * Returns null when the input cannot be read as a URL with a path. Deliberately NOT the
 * raw string in that case: falling back to it made every scheme-less URL compare against
 * a pattern anchored at `/`, so nothing ever matched and the URL silently read as
 * allowed. A caller that cannot locate a path has not learned that the URL is crawlable.
 *
 * The query is taken from the RAW url rather than from URL.search, because `URL.search`
 * is '' for a bare trailing `?` — which would hide exactly the URLs a `Disallow: /*?`
 * rule exists to catch.
 */
export function robotsTarget(url: string): string | null {
  const withoutFragment = url.split('#')[0]
  const schemeEnd = withoutFragment.indexOf('://')
  let pathAndQuery: string
  if (schemeEnd === -1) {
    // No scheme. Accept an already-relative path; refuse anything else.
    if (!withoutFragment.startsWith('/')) return null
    pathAndQuery = withoutFragment
  } else {
    const afterAuthority = withoutFragment.slice(schemeEnd + 3)
    const slash = afterAuthority.indexOf('/')
    if (slash === -1) {
      const q = afterAuthority.indexOf('?')
      pathAndQuery = q === -1 ? '/' : `/${afterAuthority.slice(q)}`
    } else {
      pathAndQuery = afterAuthority.slice(slash)
    }
  }
  return normalizeRobotsPath(pathAndQuery)
}

/**
 * Is `url` crawlable by `agent`?
 *
 * Google resolves a conflict by the LONGEST matching pattern and uses the least
 * restrictive rule on a tie, so an equal-length Allow beats a Disallow. Specificity is
 * the pattern length as written, which is what the spec's own worked examples use.
 */
export function isUrlAllowed(
  url: string,
  groups: RobotsGroup[],
  agent: string = GOOGLEBOT
): boolean {
  return isAllowedInGroup(url, groupFor(groups, agent))
}

/**
 * The per-URL half of `isUrlAllowed`, with the group already resolved.
 *
 * Exists so a caller checking many URLs resolves the governing group ONCE. Doing it
 * per URL re-ran `groups.filter` plus `chosen.flatMap` over every rule each time and
 * measured at 30% of total runtime on a 563 KiB robots.txt.
 */
function isAllowedInGroup(url: string, group: RobotsGroup | null): boolean {
  if (group === null) return true

  const target = robotsTarget(url)
  // Unreadable URL: no rule can be shown to apply, so this is not evidence of a block.
  if (target === null) return true

  let bestLength = -1
  let bestAllow = true

  for (const rule of group.rules) {
    if (!robotsPatternMatches(target, rule.pattern)) continue
    if (rule.pattern.length > bestLength || (rule.pattern.length === bestLength && rule.allow)) {
      bestLength = rule.pattern.length
      bestAllow = rule.allow
    }
  }

  return bestLength === -1 ? true : bestAllow
}

/**
 * Disallow patterns from the governing group — for reporting, not for deciding.
 *
 * A rule appearing here does NOT mean anything is blocked; an `Allow:` may override it.
 * Use `isUrlAllowed` to decide, and this only to describe.
 */
export function disallowPatterns(
  robotsTxt: string | null | undefined,
  agent: string = GOOGLEBOT
): string[] {
  if (!robotsTxt) return []
  const group = groupFor(parseRobotsTxt(robotsTxt), agent)
  return group === null ? [] : group.rules.filter((r) => !r.allow).map((r) => r.pattern)
}

/** The subset of `urls` that `agent` may not crawl. */
export function blockedUrls(
  robotsTxt: string | null | undefined,
  urls: string[],
  agent: string = GOOGLEBOT
): string[] {
  if (!robotsTxt) return []
  // Parse AND resolve the group once, then reuse it for every URL.
  const group = groupFor(parseRobotsTxt(robotsTxt), agent)
  if (group === null) return []
  return urls.filter((u) => !isAllowedInGroup(u, group))
}

/** Does the governing group disallow the site root outright? */
export function blocksSiteRoot(
  robotsTxt: string | null | undefined,
  agent: string = GOOGLEBOT
): boolean {
  if (!robotsTxt) return false
  return !isUrlAllowed('https://example.com/', parseRobotsTxt(robotsTxt), agent)
}
