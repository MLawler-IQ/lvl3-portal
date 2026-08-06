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
| **Check Similar** | **ON — off by default** | Genuine near-duplicate detection. NOTE, revised after the first real export: `ONPAGE-012` does NOT depend on this — `No. Content Words` / `No. Template Words` ship on every row regardless and are a better signal. See §8 |
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

## 4. Analytics detection — no custom extraction needed

**CORRECTION (2026-08-06).** An earlier version of this file told you to add two
custom regex extractions for GA4 and GTM. That was wrong: Sitebulb detects both
natively and ships them as hints. The real Tornado export contains
`url_contains_no_google_analytics_code.csv` and
`url_contains_no_google_tag_manager_code.csv` with no extra configuration.

Note the inverted logic when reading them — a URL listed in those files is one that
**lacks** the tag. On the Tornado crawl that is 202 of 202 HTML pages, which
independently confirms §9's "no GA or GTM code detected on any of 187 HTML pages".

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
4. The **Response vs Render** report — `TECH-004`, `GEO-002`. *Absent from the first
   export; those checks report `not_run` until it is enabled.*
5. The **on-page export** — carries `No. Content Words` / `No. Template Words`, which is
   what `ONPAGE-012` actually reads (not the similarity report). *Present.*

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

---

## 8. What the real Tornado export taught us (2026-08-06)

The first real export is in hand. Three things it settled.

### The backbone rule is not theoretical — it is worth 4 URLs on this export

§11 says read `summary.xlsx` (and the wide `internal.csv`), not just the hints folder,
because hints only exist for triggered issues. Measured on this export:

| Source | Pages with no H1 |
|---|---|
| `hints/..._h1_tag_is_missing.csv` | **187** |
| `internal.csv` column `No. H1s == 0` | **191** |

The four missing from the hint file are a 404, a `_wp_link_placeholder` artifact, an
old contact page and `/heating/` — Sitebulb suppresses hints for non-indexable URLs.
**§9's documented figure of 191 only reproduces from the backbone.** A hints-only
ingester would have under-reported the site's single biggest template defect by 2%
and had no way to know.

### Content vs template words beats similarity for ONPAGE-012

`No. Content Words` and `No. Template Words` are present on every row without any
extra setting, and they are a *better* signal than near-duplicate similarity: this
site carries **3,551 template words on every single page** against 333–1,782 content
words, so some pages are ~9% unique. Meanwhile `URLs with Similar Content` is **0
everywhere** because Check Similar was off — and it barely mattered.

Keep Check Similar ON anyway for genuine near-duplicate detection, but ONPAGE-012 does
not depend on it.

### What this crawl could NOT evaluate

| Missing from the export | Checks that must report `not_run` |
|---|---|
| Structured-data reports | `TECH-013`, `TECH-014`, `GEO-006` |
| Response vs Render | `TECH-004`, `GEO-002` |
| hreflang | `TECH-019` |
| **URL sources: `Crawl Source` is `Crawler` for all 206 rows** — no sitemap, GA or GSC | `TECH-008` orphan detection is impossible |

That last one is the most consequential and the easiest to fix: without GA and GSC
wired as URL sources, a page earning impressions that nothing links to cannot be
found, which is the entire orphan check.

### For the re-run, change exactly four things

1. Structured-data checks **ON**
2. Response vs Render report **ON**
3. Check Similar **ON**
4. URL sources: add **sitemaps + Google Analytics + Google Search Console**

Everything else in this crawl was configured correctly: 206 URLs, mobile-friendly
data present, indexability complete, and the content/template split intact.

