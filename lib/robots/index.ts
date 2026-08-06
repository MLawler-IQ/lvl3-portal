// One robots.txt implementation, shared by the detector and the eval predicates.
//
// There used to be two — `parseGooglebotDisallows`/`pathMatchesRule` in
// lib/findings/checks.ts and `googlebotDisallowRules`/`robotsPathBlocked` in
// lib/eval/injectors/predicates.ts — and they returned OPPOSITE answers on three
// probes. That is worse than either being wrong alone: the eval gate can go green
// while the detector is wrong, or red while it is right, so the gate stops carrying
// information. See docs/robots-parser-findings.md for the six defects this replaces.
//
// Written against RFC 9309 and Google's published matching rules. The behaviours that
// matter, each of which the old code got wrong:
//
//   GROUPS      A group is one or more consecutive `user-agent` lines plus the rules
//               that follow. A `user-agent` line appearing AFTER rules starts a new
//               group. Groups naming the same agent are merged.
//   PRECEDENCE  Exactly ONE group applies: the one naming the crawler. The `*` group is
//               a fallback used only when no group names the crawler — never unioned
//               with it. The old code OR'd them, so a site that deliberately opens
//               paths to Googlebot while closing them to everyone else read as blocked.
//   TOKENS      `Googlebot-Image`, `-News` and `-Video` are DIFFERENT product tokens.
//               The old `value.includes('googlebot')` matched all of them, so a routine
//               `User-agent: Googlebot-Image / Disallow: /` reported the entire site
//               blocked from Google — the loudest wrong answer the check can give.
//   ALLOW       `Allow:` exists and wins by LONGEST matching pattern, ties to Allow.
//               The old code ignored the directive entirely, so the most common
//               robots.txt on the internet (`Disallow: /wp-admin/` +
//               `Allow: /wp-admin/admin-ajax.php`) reported a block.
//   COMMENTS    A trailing `# comment` is stripped. The old detector only skipped
//               whole-line comments, so `Disallow: /x/ # note` became the rule
//               "/x/ # note", which matches nothing — a real block read as `pass`.
//   CASE        Paths are CASE-SENSITIVE; only the user-agent token is not. Both old
//               versions lowercased the path and the rule, which silently made
//               `Disallow: /Admin` block `/admin`.
//   QUERY       Patterns may contain `?`, so matching runs against pathname + search.
//               The old detector matched `new URL(url).pathname`, which drops the query
//               string, so `Disallow: /*?` could never match anything.
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
  /** Raw path pattern, case preserved. May contain `*` and a trailing `$`. */
  pattern: string
}

/** One `user-agent` group and the rules that follow it. */
export interface RobotsGroup {
  /** Lowercased product tokens this group names. */
  agents: string[]
  rules: RobotsRule[]
}

/** The crawler we evaluate for. Google's web crawler product token. */
export const GOOGLEBOT = 'googlebot'

/**
 * Split robots.txt into groups, preserving order.
 *
 * A `user-agent` line following one or more rules begins a new group; consecutive
 * `user-agent` lines accumulate into the same group's agent list. That distinction is
 * the whole reason a single `appliesToGoogle` boolean could not work.
 */
export function parseRobotsTxt(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let sawRuleInCurrent = false

  for (const rawLine of body.split(/\r?\n/)) {
    // Strip trailing comments before anything else, so a rule can never absorb one.
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line === '') continue
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const field = line.slice(0, sep).trim().toLowerCase()
    // Only the field name and the user-agent are case-insensitive; paths are not.
    const value = line.slice(sep + 1).trim()

    if (field === 'user-agent') {
      if (current === null || sawRuleInCurrent) {
        current = { agents: [], rules: [] }
        groups.push(current)
        sawRuleInCurrent = false
      }
      if (value !== '') current.agents.push(value.toLowerCase())
      continue
    }

    if (field === 'allow' || field === 'disallow') {
      if (current === null) continue // rules before any user-agent line are ignored
      sawRuleInCurrent = true
      // `Disallow:` with an empty value is an explicit allow-all and contributes no
      // rule. An empty `Allow:` is likewise meaningless.
      if (value === '') continue
      current.rules.push({ allow: field === 'allow', pattern: value })
      continue
    }
    // sitemap:, crawl-delay: and unknown fields do not affect grouping.
  }

  return groups
}

/**
 * The single group that governs `agent`, with same-agent groups merged.
 *
 * Returns null when nothing applies — which means "allowed", not "blocked".
 */
export function groupFor(groups: RobotsGroup[], agent: string = GOOGLEBOT): RobotsGroup | null {
  const token = agent.toLowerCase()
  // Exact product-token match wins outright. `googlebot-image` is not `googlebot`.
  const exact = groups.filter((g) => g.agents.includes(token))
  const chosen = exact.length > 0 ? exact : groups.filter((g) => g.agents.includes('*'))
  if (chosen.length === 0) return null
  return {
    agents: [token],
    rules: chosen.flatMap((g) => g.rules),
  }
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

/** What a pattern is matched against: path plus query string, case preserved. */
export function robotsTarget(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}`
  } catch {
    return url
  }
}

/**
 * Is `url` crawlable by `agent`?
 *
 * Google resolves a conflict by the LONGEST matching pattern, and an Allow wins a tie.
 * Specificity is the pattern length as written, which is what the spec's own worked
 * examples use.
 */
export function isUrlAllowed(
  url: string,
  groups: RobotsGroup[],
  agent: string = GOOGLEBOT
): boolean {
  const group = groupFor(groups, agent)
  if (group === null) return true

  const target = robotsTarget(url)
  let bestLength = -1
  let bestAllow = true

  for (const rule of group.rules) {
    if (!robotsPatternMatches(target, rule.pattern)) continue
    if (
      rule.pattern.length > bestLength ||
      // Equal specificity: Allow wins.
      (rule.pattern.length === bestLength && rule.allow)
    ) {
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
  const groups = parseRobotsTxt(robotsTxt)
  if (groupFor(groups, agent) === null) return []
  return urls.filter((u) => !isUrlAllowed(u, groups, agent))
}

/** Does the governing group disallow the site root outright? */
export function blocksSiteRoot(
  robotsTxt: string | null | undefined,
  agent: string = GOOGLEBOT
): boolean {
  if (!robotsTxt) return false
  const groups = parseRobotsTxt(robotsTxt)
  return !isUrlAllowed('https://example.com/', groups, agent)
}
