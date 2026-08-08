# A World-Class SEO Audit for Local Home Services, and a Hard Critique of Your 80-Check Rubric

## TL;DR

- Your framing is half-right and half-dangerous: the rubric is a competent item-inspection checklist, but a checklist is not an audit, and for a phone-driven local business your single biggest blind spot is not a missing check, it is that the whole instrument measures site properties instead of measuring visibility (geo-grid rank), demand capture, and booked-call outcome. Fix the instrument before adding checks.
- The three highest-value additions are not more technical checks: they are (1) a geo-grid / share-of-local-voice visibility baseline per location, (2) a competitor-relative gap layer (you audit the site in a vacuum), and (3) a diagnostic layer that reads findings together. Your 20-technical-to-9-conversion ratio is inverted for a business whose revenue is a phone call.
- Delete or merge roughly 12 to 15 checks that no decision hangs on, fix at least six that will fire false positives (TECH-017, GEO-007, ONPAGE-002 severity, GEO-002’s premise, and the SAB-address one you already found), and stop treating tool-reported items as evidence. Several checks encode signals Google has explicitly said it does not use.

-----

## Part Zero: Your framing is wrong in three specific ways, and right in one important one

You asked to be told first if the framing is wrong. It is, in three ways that matter more than any individual check.

**1. You are auditing a website. The business does not sell websites.** The rubric is organized around what a crawler can see on a domain. But for HVAC, plumbing, electrical, and duct cleaning, the dominant discovery surface is the Google local pack and Maps, not the organic ten blue links, and the revenue event is a phone call. Whitespark’s 2026 Local Search Ranking Factors report, the industry’s most-cited survey (47 experts scoring 187 factors, run by Darren Shaw), concludes that local visibility in 2026 is “built on engagement, credibility, and connection, not just keyword optimization,” with behavioral and engagement signals (calls, direction requests, review cadence, photos) climbing in importance. Almost none of that lives on the website. A world-class audit for this vertical treats the website as one input to local visibility, not the object of study. Your rubric has 20 technical website checks and 16 local checks, but the local checks are mostly GBP field-completeness, not visibility measurement. That is backwards.

**2. You are treating “the site has property X” as equivalent to “changing X will change an outcome.”** This is the deepest problem and it is epistemic. Most audit checks, yours included, are correlational assertions dressed as diagnoses: “money pages should have unique meta descriptions,” “URLs should be keyword-descriptive.” The honest question for every check is: if I fixed this, would a ranking, a local-pack position, an AI citation, or a booked call change? For a large fraction of conventional checks the answer is no, or unknown. Will Critchlow’s SearchPilot has spent a decade demonstrating that SEO changes which “obviously” should work frequently produce flat or negative results when split-tested, and that before-and-after analysis “can tell you that something has changed but not whether your actions caused the change in traffic, rankings, or revenue.” You cannot split-test a single local business (SearchPilot itself requires many pages on one template to run a test), so for your single-location clients you are permanently in the realm of judgment and priors, not proof. A world-class audit is honest about which recommendations are evidence-based and which are convention. Your rubric presents all 80 with equal epistemic confidence.

**3. “Repeatable by a system” is being used to justify inspecting what is easy rather than what matters.** Audit theater is not just running too many checks; it is running the checks that automate cleanly (title tags, H1 counts, alt text) at the expense of the analyses that actually change decisions (is this location rankable at all given proximity? is the site differentiated from the three competitors who outrank it? are the location pages doorway pages under Google’s spam policy?). The easy-to-automate checks cluster in technical and on-page. The decision-changing analyses cluster in local visibility, competitive gap, and content differentiation, which are exactly where your rubric is thin or absent.

**What you got right:** deliberately diverging severity from tool-reported severity, weighting by revenue impact, flagging (not auto-disavowing) toxic links, refusing to treat llms.txt as proven, and building a GEO category at all. These are more sophisticated than most agency rubrics. The problem is not the sophistication of individual judgments; it is the shape of the whole.

-----

## Part One: What a world-class audit actually contains, ordered by how much it changes a decision

The complete landscape, ordered by decision-impact for local home services, not by tradition.

### Tier 1: The analyses that change the strategy itself

**1. Visibility baseline: geo-grid rank and share of local voice (SoLV), per location.** This is the single most important thing missing from your rubric and it is not a check, it is a measurement. Google local results are proximity-weighted: a business can rank #1 at its own pin and be invisible three miles away. A single rank number lies. A geo-grid runs the query from a matrix of points (a 7x7 grid is 49 origin points) and colors each by position, producing SoLV, the percentage of points where the business hits the three-pack. This is the ground truth against which every other finding is prioritized, because it tells you where the business already wins (do not touch) and where it loses (where the work goes). Data source: you do not have this. Local Falcon is the category standard (credit-based, roughly $25 to $200/month by volume, with SAB support and Apple Maps tracking); BrightLocal’s Local Search Grid bundles it with citation and review data; Places Scout is the enterprise option. This is established method, not vendor marketing, because it measures an outcome (map position) rather than selling a proxy. Question it answers: “where can this business actually be seen, and where is the opportunity?” How it misleads: SoLV can look bad simply because of proximity (a business genuinely cannot rank 60 miles away), so it must be read against a realistic rankable radius, not a wish.

**2. Competitor-relative gap analysis.** Your rubric audits the site in a vacuum. Aleyda Solis, whose SP2 audit framework is among the most respected, is explicit that you should not start an audit by inspecting your own site: you first establish how the top players already rank and what SERP opportunities exist, “to put your SEO actions into context to be competitive.” A world-class audit answers, for each core service-plus-city: who occupies the three-pack and top organic results, how many reviews they have, what their content does that ours does not, and how many referring domains separate us. Without this, severity is unknowable. “Only 22 reviews” is critical if competitors have 300 and irrelevant if they have 15. Data: Semrush (you have it), review counts visible in the pack, links via Semrush. Assisted, not auto, and where the best auditors spend their judgment.

**3. Rankable-radius and proximity coherence.** You already have LOCAL-016 and you discovered the 45-to-65-mile failure on a real client. This belongs in Tier 1, not buried as one high-severity local check. Google’s own guidance states a service-area profile “shouldn’t extend farther than about 2 hours of driving time from where your business is based,” and in home services the practical rankable radius is far tighter than the serviceable radius. The analysis: overlay the geo-grid rankable zone against the cities the location pages target and the GBP service area. Where they diverge, the pages are either doorway pages (a spam-policy problem, see Tier 2) or simply wasted. This is the highest-leverage analysis you have already half-built.

**4. Demand and intent model: what people actually search, and what the SERP rewards.** Before inspecting pages, map the query space (emergency vs maintenance vs installation, service-plus-city, “near me,” brand) and classify which queries return a local pack, which return AI Overviews, and which return organic. This decides what pages should even exist. Your ONPAGE-005 gestures at intent match per page but there is no portfolio-level demand model above it. Data: GSC, Keywords Everywhere, Semrush (SERP-feature classification is where DataForSEO would earn its integration). This is where the audit connects to strategy.

### Tier 2: The analyses that prevent catastrophic loss

**5. Indexability and rendering of money content.** Your TECH-002, TECH-003, TECH-004 cover this and it is correctly rated. One refinement: the raw-HTML-versus-rendered-DOM diff (TECH-004) has become more important, not less, and the evidence is now decisive. A joint Vercel and MERJ analysis (documented in “The rise of the AI crawler,” 500M+ GPTBot fetches) found “zero evidence of JavaScript execution”; GPTBot downloaded .js files about 11.5% of the time and ClaudeBot 23.84%, but neither executed them, and all major AI crawlers (GPTBot, ClaudeBot, PerplexityBot) read only raw HTML. GPTBot alone made roughly 569M requests/month in that dataset. The one meaningful exception is Google’s Gemini crawler, which inherits Googlebot’s rendering. So your GEO-002 premise (“AI crawlers do not execute JavaScript”) is correct for the major AI engines but should name the Gemini exception, or it will produce a confidently wrong recommendation for a client whose only AI concern is Google’s AI Overviews.

**6. Scaled-content and doorway-page exposure.** This is a named Google spam violation and your rubric treats it only obliquely (ONPAGE-011, LOCAL-012). Google’s spam policies define doorway abuse to include “having multiple domain names or pages targeted at specific regions or cities that funnel users to one page,”  and define scaled content abuse as “when many pages are generated for the primary purpose of manipulating search rankings and not helping users,” explicitly including “using generative AI tools or other similar tools to generate many pages without adding value for users.” Enforcement: “Sites that violate our policies may rank lower in results or not appear in results at all.” For a portfolio of near-identical city pages this is existential, not a quality nit. A world-class multi-location audit explicitly tests whether the location-page program would survive a manual reviewer reading five pages side by side.

**7. Google Business Profile integrity and suspension risk.** GBP is the revenue engine, and the catastrophic failure is suspension, not sub-optimization. Sterling Sky (Joy Hawkins) documents that frequent profile edits, keyword-stuffed names, and address mishandling are common suspension triggers, and that a hard suspension removes the profile entirely from Search and Maps. Your LOCAL-002 covers name spam but you have no suspension-risk composite. Your stated data gap here is severe: an eight-field GBP export cannot audit hours, reviews, services, or photos, so LOCAL-003, 004, 007, 008, 009, 010, 013, 014 currently cannot run as written. That is a data problem, not a rubric problem, and it is your most urgent one because GBP is where the money is.

### Tier 3: Conventional site hygiene (real, but rarely decision-changing)

Most of your technical and on-page categories live here. These matter as thresholds (a site that fails badly loses) but past a floor they stop changing outcomes: HTTPS, crawlability, sitemaps, canonical hygiene, redirect chains, mobile rendering. Fixing them prevents loss; polishing them past “good” does nothing. This is where audit theater concentrates.

### Tier 4: The handoff (the part most audits skip)

A world-class audit ends as a prioritized roadmap with expected impact, effort, owner, and a measurement plan, not a document. Solis’s central point: “the goal of an SEO audit is not to deliver a document with all of the SEO issues; the actual goal is to be the source and driver of the SEO process to achieve the desired results.” Her SP2 principles: Strategic, Prioritized, Solutions-focused, Proactive/Preventive. Each finding gets a cause, the steps to fix, the resources required, the expected business impact, and a preventive measure so it does not recur. This is the difference between a report and a decision.

-----

## Part Two: How findings become a diagnosis

A list of flagged items is not an audit, and this is the part your rubric structurally cannot do because it is entirely item-level. The method:

1. **Anchor on the outcome gap first.** Start from the geo-grid and GSC/GA4: where is visibility or conversion below where it should be, relative to competitors? Everything else is explanation for that gap.
1. **Separate root cause from symptom by asking “why” down the chain.** Low booked calls (symptom) may trace to low local-pack visibility (symptom) which traces to thin reviews plus a mis-set primary category (cause). You fix the cause. Item-level checks flag all three at once with no hierarchy, which is why a raw checklist buries the one thing that matters under 40 that do not.
1. **Read findings in combination.** The finding that only appears when several checks are read together is the diagnosis (your accidental discoveries are exactly this; see Part Nine section 16).
1. **Arrive at one or two binding constraints.** For most local home-services sites the binding constraint is one of: not enough reviews/velocity versus competitors, a GBP category or proximity problem, a technically fine but undifferentiated site, or no conversion path on mobile. A world-class audit names the one or two and subordinates everything else.

The failure mode: an audit that reports 80 findings of varying severity is telling the client you did not do the diagnostic work. The output should read “here are the two things holding you back, here is the evidence from six checks that proves it, here is everything else in an appendix.”

-----

## Part Three: How the best practitioners actually work, and where they disagree

**Sequence (consensus).** Solis and enterprise practice generally: context and goals first, then competitor and SERP landscape, then demand, and only then your own site’s technical, content, and link status, filtered to the areas already identified as opportunities. The site inspection comes late, deliberately.

**What they refuse to do.** Refuse to disavow links by default (you got this right in AUTH-003), refuse to chase a perfect CWV or Lighthouse score for its own sake, refuse to report tool severity as business severity, and refuse to ship a findings dump without prioritization.

**Where they disagree, and why.**

- **Testing versus judgment.** SearchPilot/Critchlow: if you did not test it, you do not know it, and most beliefs are wrong. The local-SEO camp (Hawkins, Shaw) relies more on pattern recognition across many clients because single local businesses cannot be split-tested. Both are right within their domains; the disagreement is really about what is testable.
- **How much GBP versus website.** Some argue the website barely matters next to GBP and reviews; others (post-AI-Overviews) argue the site’s content is now what feeds AI answers. The 2025 to 2026 evidence supports a split: the website matters more for AI Overviews and informational queries, GBP matters more for the pack.
- **Content volume for location pages.** Genuine disagreement on whether many city pages help or trigger doorway/scaled-content penalties. The honest answer: it depends on whether each page has genuine local specificity, and nobody can give you a safe page count.

-----

## Part Four: What separates a world-class audit from a mediocre one, concretely

Same site, same data. The mediocre auditor runs the crawl, exports the flagged items, sorts by tool severity, and hands over a document. The world-class auditor:

- Starts from the outcome gap and competitor set, so severity is business-relative, not tool-relative.
- Reads findings in combination to find the one binding constraint (the near-duplicate-but-boilerplate trap; the proximity mismatch).
- Distinguishes “this is broken” from “this differs from best practice but costs nothing.”
- States confidence honestly: “established,” “my judgment,” “unknowable without a test.”
- Produces two or three decisions, not eighty findings.
- Ties every recommendation to rankings, pack, AI citations, or calls, and deletes anything that cannot be tied to one.

The gap is not knowledge of more checks. It is judgment about which findings matter and the discipline to subordinate the rest.

-----

## Part Five: Scoping, prioritization, and avoiding audit theater

**Decide what to inspect by starting from the outcome.** If the geo-grid shows the business already dominates its rankable radius, a technical crawl is low-value; the opportunity is expansion or conversion. If visibility is poor, diagnose why before inspecting title tags. Scope follows the gap.

**Statistical sampling for portfolios.** For 250+ locations you do not inspect every URL. Enterprise practice is template-level and cohort analysis: crawl a representative sample of each page template, identify issues that cluster by template, region, or cohort, and fix at the template level so one change propagates. A finding on one page is a page problem; a finding on 80% of a template is a systemic problem worth real effort. This is the correct unit of analysis for a rollup and it is entirely absent from your rubric, which is implicitly single-site.

**Rank findings so the output is a decision.** Impact-times-effort prioritization (Solis publishes a Google Sheets template for exactly this), with impact defined as revenue impact for this business, which you are already trying to do. The discipline is to force every finding onto that grid and to put “do now” (high impact, low effort) at the top and “do not do” (low impact, high effort) explicitly in a not-doing list.

-----

## Part Six: What is commonly included but should not be

Practices still taught or shipped in tools that are wrong, obsolete, or misleading. Several appear in your rubric.

- **Keyword density, LSI keywords, TF-IDF tooling.** John Mueller: “There’s no such thing as LSI keywords, anyone who’s telling you otherwise is mistaken.” Keyword density is not a ranking factor. Any check counting these measures a myth.
- **Word-count thresholds.** Mueller: “the number of words on a page is not a quality factor, not a ranking factor.” Do not audit for minimum word counts.
- **“Domain Authority” as a Google signal.** Mueller: “Google doesn’t use Domain Authority at all when it comes to Search crawling, indexing, or ranking.” DA/DR/Authority Score are third-party metrics, useful only as rough competitive proxies, never as a finding.
- **Meta keywords tag.** Dead for over a decade.
- **Exact-match-anchor ratios and disavow-by-default.** Disavow is now rarely needed; Google largely ignores spammy links. You handle this correctly (AUTH-003).
- **Single-H1 as a hard requirement.** Google has said multiple H1s are fine. Your ONPAGE-003 rates this “high,” which is miscalibrated (Part Nine).
- **Meta descriptions as a ranking factor.** They are not; they affect CTR at best, and Google rewrites them most of the time. Fine as a minor CTR item, wrong to weight for rankings.
- **Chasing a perfect PageSpeed/Lighthouse score.** Lab score is not the ranking input; field CrUX at the 75th percentile is, and even that is lightweight (Part Seven).
- **llms.txt as an AI-visibility tactic.** See Part Seven; the evidence is now strong that no major engine consumes it.

Why these persist: tools ship them because they are cheap to compute and make a report look thorough, and clients equate a longer report with more value. That is audit theater with a vendor incentive behind it.

-----

## Part Seven: What AI search and 2025 to 2026 changes broke

**AI Overviews are now the dominant surface for exactly the informational queries home-services customers start with.** A Whitespark study of local queries (Q2 2025, 540 queries across six US cities) found AI Overviews appearing for 68% of local searches overall, while local packs appeared for only 39%; for simple local intent (“tacos San Francisco”) AI Overviews appeared for just 15% while packs appeared for 90%+, but for informational-intent queries (“how long does an eye exam take near me”) AI Overviews appeared for 92%, and for hybrid queries (“average cost of dental implants in Phoenix”), 97%. WebFX’s study, titled “AI Overviews in Home Services: A Study of 237K+ Queries” (237,990 home-services queries), found AI Overviews on 17.7% of them, lower than healthcare but concentrated on early-journey cost and process questions; WebFX’s companion 2.37M-query study puts the US baseline AIO rate at 25.8% and notes it “can reach up to 65%.” The strategic implication: informational content on the site (costs, process, timelines, “what to expect”) now feeds AI answers, and adding a city or brand modifier measurably reduces AI Overview appearance, which is why local-pack and branded strategies remain the defense.

**The click cost is real and large.** Ahrefs’ April 2025 study (Ryan Law/Xibeijia Guan, 300,000 keywords) found “the presence of an AI Overview in the search results correlated with a 34.5% lower average clickthrough rate for the top-ranking page” (top-result CTR fell from 7.3% to 2.6%); a December 2025 re-run put the decline at 58%. Seer Interactive (per Search Engine Land, November 2025; 3,119 informational queries across 42 organizations, 25.1M organic and 1.1M paid impressions, June 2024 to September 2025) found “organic click-through rates for informational queries featuring Google AI Overviews fell 61%, while paid CTRs on those same queries plunged 68%,” with even non-AIO queries down 41%. For a local business the mitigating truth is that calls can hold steady even as clicks fall, so the audit should measure the outcome (calls) not just the intermediate (clicks).

**What this changes about the audit itself, per Google’s own documentation.** Google states that “our generative AI features on Google Search are rooted in our core Search ranking and quality systems,” and that “to be eligible to be shown in generative AI features on Google Search, a page must be indexed and eligible to be shown in Google Search with a snippet.” Translation: there is no separate “AI SEO” ranking system to audit. The new audit questions are narrower and concrete: is the content extractable in raw HTML (AI crawlers do not render JS), does it answer fan-out sub-questions in self-contained passages, and is the brand present across the third-party sources (Reddit, Yelp, review platforms) AI answers cite. Your GEO category already targets most of this, which is ahead of the field. Query fan-out (Google decomposing one query into “a multitude of queries simultaneously,” confirmed in Google’s AI Mode launch) is the real mechanism, and it argues for topical completeness over single-keyword pages.

**llms.txt is, on current evidence, not worth more than zero-cost auto-generation.** Google states directly: “You don’t need to create new machine readable files, AI text files, markup, or Markdown to appear in Google Search (including its generative AI capabilities), as Google Search itself doesn’t use them,” and that maintaining llms.txt “will neither harm nor help your site’s visibility or rankings in Google Search, as Google Search ignores them.” SE Ranking’s study of ~300,000 domains found exactly 10.13% adoption and no correlation: “Both statistical analysis and machine learning showed no effect of LLMs.txt on how often a domain is cited by LLMs. Removing this variable from our XGBoost model actually improved its accuracy,” and among the 50 most AI-cited domains only one had the file. Your GEO-007 already flags it as experimental and unproven with outcome “none,” which is the correct call. The only refinement: rate it delete-or-trivial, not a check worth a line item.

**GBP is being reshaped too.** There is emerging reporting (Rosh Media, On Purpose Media, mid-2026) that an AI-generated local pack is beginning to replace the classic three-pack for some queries, with some businesses reporting large visibility swings. This is early, partly vendor-sourced, and should be treated as “watch,” not “act,” but it reinforces that the audit must measure the actual pack via geo-grid rather than assume the three-pack exists.

-----

## Part Eight: What is genuinely hard, unsolved, or judgment-dependent

Be honest about what not to automate:

- **Content quality as a score.** LLM-as-judge is seductive and unreliable for fine-grained scoring. The research literature documents position bias, verbosity bias (favoring longer text), self-enhancement bias, and low self-consistency: same-verdict rates fall from above 95% at temperature 0 to as low as 70% at temperature 1, and reliability degrades as the scoring scale gets finer. Use an LLM to extract features (does the page state a price? name a technician? cite a response time?), which is reliable; do not use it to output a 1-to-10 “quality score,” which is not. Your ONPAGE-004 and ONPAGE-012 are correctly marked assisted; keep a human in that loop.
- **Whether many location pages help or trigger a penalty.** No safe page count exists. Judgment.
- **Causal attribution for a single local business.** You cannot split-test one site. Recommendations for single-location clients are informed priors, not proof, and should be labeled as such.
- **Review sentiment and response quality.** Machine-extractable in volume, but the judgment of what a bad review pattern means is human.
- **Prioritization itself.** Impact estimation for a specific business is judgment; a system can propose, a human should ratify for high-stakes clients.

What you would be fooling yourself to automate: any content-quality gate outputting a pass/fail on writing quality, and any “this will rank if you do X” promise. A system can reliably check presence, absence, structure, and thresholds. It cannot reliably judge quality or predict causation.

-----

## Part Nine: The critique of your rubric

### 10. WHAT IS MISSING (highest-impact first)

- **Geo-grid / SoLV visibility baseline.** Catches the entire question of where the business is actually visible, which nothing in your list measures. Critical for this vertical. Needs Local Falcon or equivalent (you lack it).
- **Competitor-relative gap layer.** Nothing compares the client to the businesses beating it. Without it, every severity is a guess. Critical.
- **Portfolio template/cohort analysis and sampling method.** Nothing addresses auditing 250 sites without auditing 250 sites. Critical for your largest clients.
- **GBP suspension-risk composite.** You check name spam but not the combined triggers (frequent edits, address, categories, reviews-on-hold). Catastrophic-loss prevention.
- **Reddit/forum/third-party citation presence for AI answers.** AI Overviews cite third parties heavily; you check your own site (GEO) and earned media (GEO-008, AUTH-004) but not presence on the specific platforms AI pulls from. Medium-high for AI citations.
- **Booked-call outcome and call-quality layer.** You have measurement-readiness checks but no analysis of call volume, source, or quality as the actual KPI. This is the point of the business and is under-weighted (Part Ten).
- **Seasonality model for HVAC.** Demand swings hard by season; an audit run in shoulder season misreads everything. No check accounts for it.
- **Portfolio query-to-page mapping via GSC.** ONPAGE-005/006 touch this per page; there is no portfolio-level mapping of which page owns which query.

### 11. WHAT IS WRONG OR WEAK (false positives and bad definitions)

- **The SAB no-address check you already found.** Confirmed: Google explicitly says “if you’re a service-area business, you should hide your business address from customers.” Faulting this is a false positive. Correct.
- **TECH-017 (keyword-descriptive URLs).** Mueller: “the SEO effect of keywords in the URL is minimal once the content is indexed.”  Fires false positives on fine URLs and no ranking decision hangs on it. Weak as written.
- **ONPAGE-003 (one H1, “high” severity).** The single-H1 requirement is outdated; Google accepts multiple H1s. Heading hierarchy has minor value; “high” is wrong. Downgrade.
- **GEO-002 premise.** “AI crawlers do not execute JavaScript” is true for GPTBot/ClaudeBot/PerplexityBot but false for Google’s Gemini. As written it misleads on Google AI Overview cases. Add the exception.
- **GEO-006 and TECH-013 structured-data-for-rankings framing.** Google’s position: structured data makes you eligible for rich results and “isn’t required for generative AI search, and there’s no special schema.org markup you need to add.” If a check implies schema lifts rankings or AI citations directly, it encodes a myth. Keep for rich-result eligibility and NAP consistency; drop any ranking/citation claim.
- **CRO-005 and TECH-010 both charging PageSpeed.** Lab PageSpeed is not the ranking input; field CrUX is, and it is a lightweight tiebreaker (Mueller: “more than a tiebreaker” but “not a giant factor” that “doesn’t replace relevance”). Two checks leaning on the quota-limited PageSpeed API for a signal that rarely changes rankings double-counts a weak signal. Consolidate and move to CrUX (Part Twelve).
- **ONPAGE-002 (meta descriptions) outcome “booked calls.”** Google rewrites descriptions most of the time; the causal link to booked calls is weak. Keep as a trivial CTR item, do not imply it moves revenue.
- **LOCAL-005 NAP consistency severity.** Real but routinely overstated; it is one factor, not a top lever. Defensible to keep, wrong to rate above reviews.

### 12. WHAT SHOULD BE DELETED (be aggressive)

You said you would rather run 50 that matter. Candidates:

- **TECH-014 (only currently-supported structured data types).** Near-zero decision value; an unsupported type simply produces no rich result. Merge into TECH-013.
- **TECH-017 (keyword-descriptive URLs).** Delete as a ranking check; at most a trivial readability note.
- **TECH-019 (hreflang).** For US-only home services this almost never applies. Conditional-only, not standing.
- **TECH-020 (custom 404).** Real but trivial; merge into a generic hygiene bucket.
- **ONPAGE-002 (meta descriptions).** Demote from a scored check to an attribute logged.
- **ONPAGE-008 (alt text) as a ranking item.** Keep for accessibility/image search, drop the ranking weight.
- **GEO-007 (llms.txt).** Delete as a line item or make it a zero-cost auto-generate.
- **GEO-006 (structured data for extractability).** Merge into TECH-013; it duplicates.
- **TECH-018 (faceted/parameter URLs).** Home-services sites rarely have faceted navigation; conditional, not standing.
- **AUTH-004 (brand mentions) and AUTH-003 (toxic links).** Both low-severity monitoring, not audit decisions; merge into one off-site monitoring line.
- **MEAS-006 (GSC generative AI performance).** Keep as monitoring, not a scored check.

That is roughly 8 to 12 deletions or merges, moving you toward your 50-that-matter target while freeing attention for the Tier 1 additions.

### 13. SEVERITY AND EFFORT CALIBRATION

**Defensible weightings:** CRO-001 (tap-to-call) critical, LOCAL-001 (primary category) critical, MEAS-002 (call tracking) critical, TECH-011 (mobile) critical. Correctly revenue-weighted for a phone-driven business; your divergence from tool severity is right.

**Wrong weightings:**

- ONPAGE-003 (single H1) high: should be low.
- LOCAL-005 (NAP) implicitly high: should be medium; over-weighted relative to reviews.
- TECH-010/CRO-005 (page speed) high: field CWV is lightweight; medium at most, and the conversion angle (CRO-005) is more defensible than the ranking angle (TECH-010).
- LOCAL-007/008/010 (reviews) high: for this vertical, given Whitespark 2026 elevating review velocity and engagement, review volume/velocity versus competitors arguably deserves critical. You are under-weighting your single best lever after category and calls.
- GEO checks generally medium: reasonable given uncertainty, but brand presence on AI-cited third-party sources deserves elevation as AI Overviews grow.

**Effort tiers:** mostly reasonable. TECH-004 (raw vs rendered diff) at high effort is right; ONPAGE-012 (content-to-template ratio) marked auto/high is optimistic; distinguishing boilerplate from unique content at scale is assisted, not auto, because it needs a judgment threshold (section 16).

### 14. STRUCTURE

**Seven categories: mostly the right cut, with one structural error.** Local and CRO are correctly separated. The error: **Measurement Readiness should come first, not last**, because if GA4/GSC/call-tracking are not capturing outcomes, the rest of the audit has no ground truth. Reorder conceptually: measurement, then visibility (new), then local, then conversion, then content, then technical, then off-site.

**Missing category: a Visibility/Competitive layer** (geo-grid, SoLV, competitor gap). It does not fit cleanly in any of the seven and is the most important, which is itself evidence the taxonomy is website-centric.

**Automation-tier errors:**

- ONPAGE-012: should be assisted, not auto.
- TECH-015 (schema matches content): parts are auto (does markup reference entities absent from rendered text?).
- LOCAL-002 (name spam): largely auto (compare GBP name to legal/brand string), human only on edge cases.
- GEO-005 (AI citation tracking): auto if you buy a tool, impossible if you do not; a data-acquisition question, not a judgment one.

### 15. COVERAGE

**Over-indexed:** Technical (20) for a business whose revenue is a phone call; several are Tier 3 hygiene. **Thin:** Conversion (9) and the entire outcome side (calls, visibility, competitor gap). The 20-to-9 ratio is inverted. A defensible shape for local home services: measurement 6, visibility/competitive 6, local/GBP 14, conversion 12, content 10, technical 10, off-site 5. Do not hit those numbers exactly, but move weight from technical hygiene toward conversion, local visibility, and outcome measurement.

The deeper problem: **conversion is under-built for a phone business.** Nine CRO checks, but no analysis of whether the phone number matches across pack/site/ads, no call-answer-rate consideration, no after-hours call handling (critical for HVAC emergency intent), no form-to-call fallback logic. CRO-001 and CRO-009 are good; the category needs depth, taken from the technical category.

### 16. THE DIAGNOSTIC LAYER (composites that sit on top of item checks)

This layer turns your checklist into an audit. Each composite combines item-level inputs to surface a finding no single check sees. Your two accidental discoveries generalize into a whole class.

1. **Boilerplate-dominant despite passing near-duplicate (your discovery).** Inputs: near-duplicate check (pass) + content-to-template ratio (ONPAGE-012) + raw-HTML main-content extraction (TECH-004). Finding: pages are unique enough to dodge duplicate detection but 70%+ template, so they carry no differentiating content and will lose to competitors and be ignored by AI extraction. This is a scaled-content-abuse risk under Google’s policy.
1. **Proximity-radius mismatch (your discovery).** Inputs: geo-grid rankable radius (new) + location-page target cities (LOCAL-012) + GBP service area (LOCAL-016). Finding: pages and service areas target geography outside the rankable radius; either doorway pages or wasted effort.
1. **Doorway-page composite.** Inputs: location-page count + content-to-template ratio + internal-link pattern + thin-content flag (ONPAGE-011). Finding: the city-page program collectively meets Google’s doorway definition (“multiple pages targeted at specific regions that funnel users to one page”), a portfolio-level penalty risk invisible page-by-page.
1. **Visibility-without-conversion.** Inputs: geo-grid SoLV (good) + GA4 calls/forms + CRO checks. Finding: the business ranks but does not convert; the problem is the page, not visibility. Redirect effort from more SEO to CRO.
1. **Conversion-without-visibility.** Inputs: strong CRO + poor SoLV/rankings. Finding: the site converts what little it gets; the constraint is upstream visibility. Opposite prescription.
1. **Reviews-versus-competitor gap.** Inputs: your review count/velocity (LOCAL-007/008) + competitor review counts (new competitive layer). Finding: reviews are “fine” absolutely but losing relative to the pack, which given Whitespark 2026 is likely the binding local constraint.
1. **AI-invisible-but-Google-visible.** Inputs: raw-HTML content presence (TECH-004/GEO-002) + rendering dependence + AI citation tracking (GEO-005). Finding: the site ranks on Google (which renders JS) but is a blank shell to AI crawlers (which do not), so it is absent from AI answers despite ranking.
1. **Category-to-service-page-to-demand coherence.** Inputs: GBP primary category (LOCAL-001) + matching service page (LOCAL-011) + actual query demand (GSC/Keywords Everywhere). Finding: the profit-aligned category has no supporting page, or pages target services with no demand.
1. **NAP-versus-call-tracking integrity.** Inputs: NAP consistency (LOCAL-005) + call-tracking implementation (MEAS-002). Finding: whether call tracking uses DNI (safe) or static-number replacement (breaks NAP). This resolves your own stated worry: DNI keeps the real number in the raw HTML and swaps the display via JavaScript, so crawlers still read the canonical number; Sterling Sky and CallRail both confirm DNI does not harm NAP, and the failure mode is only static replacement on the GBP or in crawlable HTML. So the check is not “is call tracking present” but “is it DNI or static.”
1. **Seasonality-adjusted performance.** Inputs: GSC/GA4 trend + season + content-freshness (ONPAGE-010). Finding: a traffic drop is seasonal, not a problem, or a seasonal page was not refreshed pre-season.

-----

## Part Ten: The measurement and data-gap reckoning (your stated constraints)

Straight answers, no working around them:

- **Call tracking is your most important missing data, not a nice-to-have.** For a phone-driven business, an audit that cannot attribute booked calls is measuring inputs and guessing the outcome. MEAS-002, MEAS-005, MEAS-007 cannot run without it. Cheapest sufficient fix: CallRail (category standard, DNI built in), CallTrackingMetrics, or WhatConverts. Implement via DNI to preserve NAP. Until then, be explicit in every deliverable that booked-call attribution is unavailable and that GA4 “calls” (tel: clicks) undercount and misattribute badly. Do not let the rest of the audit’s precision imply an outcome measurement you do not have.
- **GBP eight-field export is a critical gap because GBP is the revenue engine.** Fix before anything technical. The GBP API or a tool (BrightLocal, Whitespark, Local Viking) gives hours, reviews, services, photos, categories. Eight of your local checks are theater until this is fixed.
- **Citation/directory data has no source.** Cheapest sufficient: BrightLocal (best value for agencies), Whitespark (citation specialists), Yext (most expensive, sync model), Moz Local. For your scale BrightLocal likely wins.
- **PageSpeed API daily quota at scale: solved by switching signal source.** Use the CrUX History API or the CrUX BigQuery dataset for field data at origin and (where available) URL level, which is what actually feeds the ranking signal anyway. BigQuery gives origin-level, device-segmented, historical data with only a free-tier billing setup; the CrUX API is easier and rate-limited far above PageSpeed’s ~25,000/day. Reserve PageSpeed/Lighthouse for the handful of pages needing lab diagnostics, not portfolio scanning. This also fixes the TECH-010/CRO-005 double-charge.
- **DataForSEO (not yet integrated).** Worth it for SERP-feature detection at scale (which queries show AI Overviews versus packs versus organic), competitor rank data, and keyword data cheaper per call than Semrush. This is the integration that would power the demand/intent model and the competitive layer, both Tier 1 gaps.

-----

## Part Eleven: Established versus plausible versus vendor marketing

**Established, well-evidenced:**

- AI crawlers (GPTBot, ClaudeBot, PerplexityBot) do not render JavaScript; Gemini does (Vercel/MERJ, 500M+ fetches). 
- Reviews (volume, velocity, recency) are a top local lever (Whitespark 2026; BrightLocal 2025).
- Proximity is a dominant local ranking factor; geo-grid is the correct measurement (industry consensus).
- DA/DR, keyword density, LSI, word count, meta keywords are not Google ranking factors (Mueller/Illyes, repeatedly).
- Structured data drives rich-result eligibility, not direct rankings (Google docs).
- CWV is a real but lightweight tiebreaker at the 75th-percentile field level (Mueller; Google page-experience docs). 
- llms.txt is not consumed by Google or, on current evidence, by other major engines (Google docs; SE Ranking study).
- DNI call tracking does not harm NAP (Sterling Sky, CallRail).

**Plausible but unproven:**

- Specific GEO tactics (“answer-first passages,” “fact density”) improving AI citation rates. Directionally sensible, not causally proven; much of the “citation lift” data is vendor correlation (the Surfer study carried its own correlation-not-causation caveat).
- AI-generated local pack replacing the three-pack at scale (early, partly vendor-sourced).
- That many location pages help rather than risk a penalty.

**Vendor marketing to distrust:**

- AI-visibility tracking tools (Profound, Peec, Otterly, Semrush/Ahrefs modules) as a necessity. The category raised $300M+ in a year, is young, and the tools measure but do not improve visibility; honest reviews note buyers “watch flat dashboards for six months and churn.” Useful for larger clients who will act on the data, over-sold for single-location. Buy only if a content engine will act on it.
- Any tool selling “LSI keywords,” TF-IDF optimization, or a “domain authority” to raise.
- “llms.txt for AI visibility” as a paid service.

-----

## Part Twelve: Recommendations, staged

**Stage 1 (fix the instrument, weeks 1 to 4).** Fix the GBP data export (the revenue engine is currently un-audited). Switch CWV to CrUX API/BigQuery and consolidate TECH-010/CRO-005. Correct the confirmed false positives: the SAB address check, TECH-017, ONPAGE-003 severity, the GEO-002 Gemini exception. Add the DNI-versus-static distinction to MEAS-002. Execute the deletions in section 12. Benchmark to change this stage: none, these are known-good.

**Stage 2 (add the Tier 1 outcome layer, weeks 4 to 10).** Integrate geo-grid/SoLV (Local Falcon or BrightLocal). Build the competitor-gap layer (Semrush + pack scraping + DataForSEO). Build the demand/intent model with SERP-feature classification. Stand up the first four diagnostic composites. Benchmark: if a pilot on 10 clients shows the geo-grid plus competitor layer changes the top recommendation versus your current output more than ~30% of the time, it is proving its worth; if it rarely changes the call, you are over-investing.

**Stage 3 (attribution and portfolio, weeks 8 to 16).** Integrate call tracking via DNI for clients who will pay for it; make booked-call attribution the headline KPI. Build template/cohort sampling for the 250+ portfolios so you audit templates, not URLs. Add the remaining diagnostic composites. Benchmark: once call attribution is live, re-weight severities against actual call data, not assumed revenue impact, and let real data overrule your priors where they conflict.

**Stage 4 (AI surface, ongoing).** Add third-party-citation presence checks (Reddit, Yelp, review platforms). Monitor AI Overview / AI-pack prevalence per client vertical and geography. Treat AI-visibility tools as optional and only for clients with a content engine. Benchmark to escalate spend: buy a tracking tool only when a client is losing measurable booked calls to AI surfaces and has committed content resource to respond.

Thresholds that would change the whole approach: if the geo-grid shows a client already at 70%+ SoLV in its rankable radius, stop doing SEO and do CRO and reviews. If call attribution shows calls flat while clicks fall, ignore the AI-Overview click panic. If a location-page cohort trips the doorway composite, the recommendation is consolidation, not more pages.

-----

## Caveats

- You cannot causally prove SEO recommendations for a single local business; single-site work is informed judgment, and the report should label it as such rather than implying certainty.
- Several 2025 to 2026 AI-search figures come from vendor or single-study sources (Seer, Ahrefs, Whitespark, WebFX, Surfer) and measure correlation, not causation; the direction is reliable, the precise numbers are not.
- The AI-local-pack-replacing-the-three-pack claim is early and partly vendor-sourced; treat as watch, not act.
- Tool pricing and AI-visibility tool capabilities change monthly; verify before buying.
- Your own data gaps (call tracking, GBP export, citations) mean parts of the current rubric cannot run today; fixing the instrument precedes trusting any output it produces.
- LLM-as-judge should extract features, not score quality; any content-quality automation you build will be unreliable for fine-grained judgments and should keep a human in the loop.