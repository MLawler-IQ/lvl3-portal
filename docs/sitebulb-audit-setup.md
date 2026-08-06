# Sitebulb audit setup — required configuration

The crawl backs **33 of the 80 rubric checks (41%)**, 28 of them `auto` tier, including
4 of the 9 `critical` checks. Everything in this file exists because
`AUTOMATION-CONTEXT.md` §16 records the real risk plainly: **a misconfigured crawl
silently produces passes.** A check that runs against missing data and reports "fine"
is the single worst failure mode in the pipeline (§17), so the settings below are
requirements, not preferences.

Where a setting is **off by default**, that is called out. Those are the traps.

---

## 1. Tier

**Sitebulb Desktop Pro** (~$425/yr) for the pilot; **Cloud Small** (~$2,940/yr,
1M URLs/mo) when the fleet turns on.

**Not Lite.** Lite omits structured data, Core Web Vitals, hreflang, mobile-friendly
checks and scheduling — which between them account for the majority of the critical
crawl-backed checks below.

## 2. Crawler settings

| Setting | Value | Why — checks that die without it |
|---|---|---|
| **Chrome Crawler** | **ON** | `TECH-003` noindex on money pages, `TECH-011` mobile rendering, `CRO-001` tap-to-call position — all specify *rendered DOM*. An HTML-only crawl cannot see them |
| **Response vs Render** report | **ON** | `TECH-004` (content and links in raw HTML, not only rendered) and `GEO-002` (AI crawlers do not execute JavaScript). This diff IS the check — it is why Sitebulb replaced building our own renderer |
| **Check Similar** | **ON — off by default** | `ONPAGE-012` content-to-template ratio. Supplies the near-duplicate/similarity data behind `uniqueWordCount`. §7 records why this check exists: a pure duplicate check *passed* Tornado while its pages were 71% boilerplate |
| **Structured data checks** | **ON — off by default** | `TECH-013` LocalBusiness/HVACBusiness markup matching visible NAP, `TECH-014`, `GEO-006`. §16 names this as the specific reason the last Tornado audit needs re-running |
| **Mobile crawl / mobile viewport** | **ON** | `TECH-011`, `TECH-012` mobile parity, `CRO-001`. HVAC emergency search is mobile and converts by tapping to call — these are revenue checks, not hygiene |
| **Core Web Vitals** | ON | Complements the PageSpeed station; gives per-URL coverage where the API's daily quota won't stretch |
| **hreflang** | ON | `TECH-019` — cheap, and only reports when genuinely multi-region |

## 3. URL sources — all four

Sitebulb defaults to crawling from the start URL alone. That cannot find an orphan,
which is the whole point of `TECH-008` (no orphan money pages).

- [x] **Website crawl** (start URL)
- [x] **XML sitemaps** — also feeds `TECH-005`
- [x] **Google Analytics** — pages with traffic that the crawl never reached
- [x] **Google Search Console** — pages with impressions that the crawl never reached

The GA and GSC connections are the orphan detector. A page earning impressions that
no internal link points to is exactly the finding, and it is invisible without them.

## 4. Custom extractions — required, and easy to miss

`MEAS-001` (GA4 installed and firing) is **critical severity** and was the finding
that mattered most on Tornado: **no GA or GTM code on any of 187 HTML pages, and zero
goal conversions against the 37 URLs receiving traffic.** Nothing was measurable.

Sitebulb will not report that per-URL without being told to look. Add two custom
extractions (Regex, applied to page source):

| Name | Pattern | Populates |
|---|---|---|
| `ga4` | `G-[A-Z0-9]{6,}` | `CrawlPageRecord.analytics.ga4` |
| `gtm` | `GTM-[A-Z0-9]{4,}` | `CrawlPageRecord.analytics.gtm` |

Without these, `MEAS-001` must report `not_run` — which is correct behaviour, but it
means the audit cannot tell you the site is unmeasurable.

## 5. What to export and hand over

**`summary.xlsx` is the backbone — export it, not just the hints folder.**

§11 states the ingester rule and it is load-bearing: hint CSVs only exist for
*triggered* hints. Reading only the hints folder makes a `pass` indistinguishable from
a `not_run` — a check with no hint file could mean "clean" or "never evaluated", and
the pipeline must never guess. `summary.xlsx` enumerates every URL crawled, so absence
of a hint against a present URL is a real pass.

Hand over:

1. **`summary.xlsx`** — required
2. The **hints/issues export** (CSV) — the triggered findings
3. The **internal links export** — needed for `internalLinksIn`, the signal behind §9's
   most useful negative result (earning and invisible pages both had ~186 inbound
   links, killing the internal-linking hypothesis and revealing a mega-menu that
   signalled no priority at all)
4. The **Response vs Render** report — `TECH-004`, `GEO-002`
5. The **similarity / near-duplicate** report — `ONPAGE-012`

## 6. What the crawl cannot supply

Stated so nobody expects these from the ingester:

| Gap | Source instead |
|---|---|
| `targetGeo` per location page | Extraction rule or a manual mapping. `LOCAL-016` (service-area coherence) needs it — this is the check that caught a Sherman Oaks business targeting Orange County |
| Anchor-text detail | Blocks `ONPAGE-007` (descriptive internal anchors). `CrawlPageRecord` carries no anchor text yet; adding it is a schema change, not a settings change |
| Call tracking | No data source at all today. §3 lists it as a true remaining gap, and it gates outcome reporting for home services entirely |
| Citations / directories | No data source today |

## 7. Pilot target

**Tornado HVAC** (`tornadohvacca.com`) — 206 URLs, well inside any tier. Re-running it
under this configuration is §16's blocker 5, and it turns the eval harness's
hand-built `tornado` fixture into a **record-and-replay snapshot of real station
output**, which is the plan's L2 step. That is the moment the harness stops being
scored against transcribed prose and starts being scored against the real thing.
