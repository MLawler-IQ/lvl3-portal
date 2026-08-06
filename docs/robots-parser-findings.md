# TECH-001 robots.txt handling — six confirmed defects

**Status: ALL RESOLVED.** Six defects fixed in `df0c79e`, three defects *introduced by
that fix* found by an adversarial spec pass and fixed in `fc2bbf1`, and the ONPAGE-012
divergence resolved in `4053c0c`. A fresh verification pass independently re-derived all
six original defects and confirmed each is genuinely fixed. Kept as the decision record —
the reasoning is what stops any of this being reintroduced.

Note the line references below point at code that no longer exists:
`parseGooglebotDisallows` and `pathMatchesRule` were deleted from
`lib/findings/checks.ts`, and the second implementation in
`lib/eval/injectors/predicates.ts` is gone. There is now one implementation,
`lib/robots/index.ts`, with a spec-derived suite in `tests/unit/robots.test.ts`.

Recovered from a verification subagent that was killed mid-run (`stoppedByUser`) on
2026-08-06 at 07:42 before it could report. It had confirmed 11 failing probes and was
one step from writing them up. Every claim below was then **independently re-verified**
against the source, not taken from the dead agent's word.

Source under review: `lib/findings/checks.ts` — `parseGooglebotDisallows` (18 lines,
L105–122) and `pathMatchesRule` (L125–141). Both are mine, added in 62c1f36.

Why this matters more than the count suggests: **TECH-001 is one of the nine `critical`
checks and it is `auto` tier**, so it reports without a human in the loop. Five of the
six defects below produce a *false positive* — the pipeline telling a client something
alarming and wrong. `AUTOMATION-CONTEXT.md` §17 names that as the worst failure mode in
the system.

## The defects

| # | Defect | Direction | Reachability |
|---|---|---|---|
| 1 | ReDoS: catastrophic backtracking in `pathMatchesRule` | hang | third-party input |
| 2 | `Allow:` not implemented at all | false positive | every WordPress site |
| 3 | No user-agent group precedence — `*` and `Googlebot` groups are unioned | false positive | common |
| 4 | `includes('googlebot')` also matches `Googlebot-Image` / `-News` / `-Video` | false positive | common, severe |
| 5 | Multiple `User-agent:` lines in one group — last line wins, Googlebot's rules dropped | false negative | common |
| 6 | Inline `#` comments not stripped, so the rule silently never matches | false negative | common |

Plus: a query-string rule (`Disallow: /*?`) can never match, because `pathMatchesRule`
tests `new URL(url).pathname`, which excludes the query string.

### 1. ReDoS — confirmed exponential

`pathMatchesRule` builds a regex by splitting the rule on `*` and joining with `.*`.
Nested quantifiers over a repeating subject backtrack catastrophically. Measured on
`url = '/' + 'a'.repeat(40) + 'b'`, `rule = '/' + '*a'.repeat(n) + '$'`:

| wildcards | time |
|---|---|
| 4 | 1 ms |
| 6 | 57 ms |
| 8 | 1,374 ms |
| 10 | 19,133 ms |

~24x per two added wildcards. **`robots.txt` is fetched from the client's own site**, so
this is adversarial-input-reachable without any attacker: one pathological rule file
hangs the crawl station. Fix by matching literally (walk the `*`-separated segments with
`indexOf`) instead of compiling a regex, or cap wildcard count and bail.

### 2. `Allow:` is not implemented

Line 117 only reads the `disallow` directive. There is no `allow` branch anywhere in the
function. So the single most common `robots.txt` on the internet:

```
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
```

reports `/wp-admin/admin-ajax.php` as blocked from Google. Real Googlebot resolves
Disallow/Allow by **longest matching pattern**, so the Allow wins.

Apex is ~107 mostly-WordPress home-services brands. This fires on essentially all of
them.

### 3–5. User-agent grouping is wrong in three separate ways

```ts
if (directive === 'user-agent') {
  appliesToGoogle = value === '*' || value.includes('googlebot')
}
```

A single boolean cannot model robots.txt grouping, which requires picking the **one most
specific matching group** and ignoring all others.

- **(3)** With both a `*` group and a `Googlebot` group present, this unions their rules.
  Real Googlebot ignores the `*` group entirely. A site that deliberately opens paths to
  Googlebot while closing them to everyone else is reported as blocking Googlebot.
  Verified: `User-agent: *\nDisallow: /services/\n\nUser-agent: Googlebot\nDisallow:`
  yields `["/services/"]`; correct answer is `[]`.
- **(4)** `value.includes('googlebot')` is true for `googlebot-image`, `googlebot-news`
  and `googlebot-video`. A site with `User-agent: Googlebot-Image` / `Disallow: /` —
  a normal way to keep images out of Image Search — is reported as **blocking the entire
  site from Google**. Verified: yields `["/"]`. Worst-case output in the whole check.
- **(5)** Each `user-agent` line *overwrites* the flag rather than accumulating, so a
  group headed by two agent lines (`User-agent: googlebot` then `User-agent: bingbot`)
  ends with `appliesToGoogle = false` and drops Googlebot's real rules. Genuine blocks
  get reported as `pass`.

### 6. Inline comments become part of the rule

Line 110 skips lines that *start* with `#`, but nothing strips a trailing comment. So
`Disallow: /services/ # money pages` parses to the rule
`"/services/ # money pages"`, which matches no path — a real block reported as `pass`.

## Two implementations disagreed with each other — RESOLVED in df0c79e

`lib/findings/checks.ts` and `lib/eval/injectors/predicates.ts` both implement robots
logic, and they return **opposite** answers on the same input:

| probe | `checks.ts` | `predicates.ts` |
|---|---|---|
| two agent lines, googlebot first | `[]` | `[{pattern:'/services/'}]` |
| `Googlebot-Image` group only | `["/"]` | `[]` |
| `Disallow: /*?` vs `?sessionid=` | `false` | `true` |

This is exactly the circularity the eval plan warned about: the injector predicate and
the detector are independent implementations, so the eval gate can go green while the
detector is wrong — or red while the detector is right. Both now call one shared implementation, `lib/robots/index.ts`.

The honest lesson, recorded because it generalises: duplicating an implementation only
buys independence when the two authors reason differently. Both of these were written by
the same author from the same misunderstanding, so the duplication bought a disagreement
rather than a cross-check — and a gate whose two halves disagree carries no signal at
all. Independence moved to a suite written from RFC 9309 and Google's published matching
rules instead. The same call was then made for ONPAGE-012, for a stronger reason: robots
at least had an external normative spec a second author could read, whereas the
ONPAGE-012 rubric row states no threshold, so a second reading could only diverge.

## ONPAGE-012 detector and predicate also diverged — RESOLVED in 4053c0c

Reproduced exactly as documented: detector 6, predicate 0, on all three scenarios. The
resolution went further than picking a side, because on two of the three axes *neither*
side was right:

| axis | detector was | predicate was | resolved to |
|---|---|---|---|
| zero-word page | `0` (dominated) | `1` (pristine) | **excluded, counted, surfaced** — both invented a number |
| threshold | `< 0.5` | `<= 0.35` | `< 0.5`, marked NOT IN THE RUBRIC / OURS |
| grouping | derived from URL | required `templateGroup` | derived from URL, never gated |

The root cause was not any of those. `REGISTERED_CHECK_IDS` listed 7 ids while
`CHECK_IDS` had 8, and every generated manifest's `must_pass` is built from that list —
so **ONPAGE-012 was asserted by no generated fixture in either variant.** The harness
that exists to catch a disagreement could not see this one. A drift guard now asserts
set equality.

Tornado's `must_find` of 148 survives unchanged. It will become **190** when that fixture
becomes a record-and-replay snapshot of the real export, because `wordCount` then becomes
content+template with 3,551 template words on every row and the blog family joins.
Re-derive at that moment as a reviewed manifest edit.

## What was done, in order

1. ✅ ReDoS — matching is now a regex-free segment walk. 24 wildcards against a 200-char
   path finishes under 250 ms, versus 19.1 s at ten wildcards before.
2. ✅ Collapsed `checks.ts` and `predicates.ts` onto `lib/robots/index.ts`.
3. ✅ Group precedence, `Allow:` longest-match, the `Googlebot-*` distinction,
   multi-agent groups, inline comments, query-string rules — plus case-sensitive paths.
4. ✅ A second round from an adversarial spec pass (`fc2bbf1`): bare-`CR` line
   terminators, percent-encoding normalised on both sides, product-token normalisation,
   the 500 KiB parse cap, and `robotsTarget` no longer silently allowing unreadable URLs.
5. ✅ ONPAGE-012 reconciled (`4053c0c`).
6. ✅ Fresh verification pass completed. Gates green; it found three further defects
   outside this document's scope — `LOCAL-016` reporting `pass` on unmeasured data and a
   raw NUL byte in `opportunity-sizing.ts`, both fixed in `a233554`, plus a design-level
   note that "unmeasured" is still not representable for `TECH-001` and `TECH-011`.

## Still open

One design gap, recorded rather than fixed: `CrawlSiteRecord.robotsTxt` is
`string | null` with null documented as "the fetch 404'd", so a station that never
attempted the fetch is indistinguishable from a site serving no robots.txt — and
`TECH-001` returns `pass` for both. `TECH-011`'s `hasViewportMeta` / `tapTargetsOk` are
non-nullable booleans with the same problem. The direction is also inconsistent across
checks: `MEAS-001` and `LOCAL-003` default to *fail* in the same situation while these
default to *pass*. Nothing constructs a `CrawlPageRecord` yet, so this is forward-looking
— but it needs settling before the ingester is wired, or an ingester gap becomes a clean
bill of health.
