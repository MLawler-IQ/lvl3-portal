# REBRAND-NOTES.md

Log for the August 2026 rebrand of the LVL3 Portal onto the lvl3.com editorial
system (`PORTAL-REBRAND-SPEC.md`). Records every user-visible string change and
every deliberate exception, per the spec's stage 6 gate.

Branch: `rebrand/editorial` · rollback tag: `pre-rebrand-violet`

---

## The rollback tag is misnamed

The tag is `pre-rebrand-violet` as instructed, but the state it captures is **not**
violet/zinc. It is the IgniteIQ light palette (Brand v4.2, March 2026): warm-cream
canvas, `#EF4444` red accent, Aeonik + Aeonik Fono loaded locally. The violet/zinc
theme the spec describes was superseded by an earlier rebrand that is already in
`main`'s history.

Practical consequence: this pass is **light → dark**, not violet → sienna. The spec's
stage-6 grep gates for violet hexes and `zinc` were nearly satisfied before work
started (2 violet hexes, both in `lib/`; 1 `zinc`, a stale comment).

That earlier rebrand was also a *partial* retint of an originally-dark theme, so a
large amount of the codebase was still written for a dark surface — roughly 371
`-400`-level Tailwind palette classes on `/10`–`/15` tinted fills, `rgba(255,255,255,
0.05)` row tints, a `#10131A` hero gradient, `#020617` button text. Going back to dark
**fixes** most of those rather than breaking them.

---

## Superseded documents

| File | Status |
|---|---|
| `LVL3-Portal-Brand-Guide-SUPERSEDED-2026-03.pdf` | Renamed, not deleted. The March 2026 violet/zinc guide. |
| `design-system/DESIGN.md` | Still describes the pre-rebrand palette. Not yet updated. |
| `design-system/LVL3-BRAND-PORTAL.md` | Same. Also references a `--chart-tooltip-fg` token that did not exist until this rebrand added it. |
| `design-system/lvl3-portal/MASTER.md` | Same. |

---

## String changes

| Where | Before | After | Stage |
|---|---|---|---|
| `components/nav/TopBar.tsx` wordmark | `logo-black.png` + `IgniteIQ` + `Portal` | `LVL3.` + `Portal` | 3a |
| `components/nav/TopBar.tsx` aria-label | `IgniteIQ Portal — home` | `LVL3 Portal — home` | 3a |
| `app/(auth)/login/page.tsx` brand mark | `logo-black.png` (alt `IgniteIQ`) | `LVL3.` text mark | 3a |
| `components/nav/MobileNavDrawer.tsx` | `LVL3` | `LVL3.` (accent period) | 3a |

The desktop top bar said "IgniteIQ" while the mobile drawer already said
"LVL3" — that pre-existing inconsistency is resolved by the same change.

Still IgniteIQ, deliberately, until stage 6: `app/layout.tsx` metadata
(`IgniteIQ Portal · Own Your Intelligence`), `app/(public)/market-eval`
title, `components/report-shell.tsx` (`IgniteIQ`, `Ask IgniteIQ`), and the
`mm-image-review` surfaces. Those are copy/metadata, not chrome.

---

## Deliberate exceptions

### Deferred to stage 6 (not yet actioned)

| Item | Reason |
|---|---|
| `lib/review/email.ts:28` — sender `IgniteIQ Reviews <reviews@send.igniteiq.com>` | A real, DNS-verified Resend sending domain. Cannot move to an lvl3.com address until that domain is configured and verified in Resend. Changing the display name alone while the address stays `@send.igniteiq.com` would read worse, not better. |
| `lib/seo-content-engine/docx-writer.ts:27` — `COLOR_ACCENT = '8B5CF6'`, `FONT_BODY = 'Inter'` | Violet, and one of only two real violet hexes left in the repo. Affects generated client `.docx` deliverables, not portal UI. Belongs with the stage 6 asset pass. |
| `lib/tfk/preview.ts:97` — `#a78bfa` preview banner | The second real violet hex. Generated-HTML preview string, not portal UI. |
| `app/actions/seo-content-engine.ts:353` — `'IgniteIQ'` as .docx author metadata | Document metadata on generated deliverables; stage 6. |

### Standing exceptions (recommend keeping IgniteIQ)

| Item | Reason |
|---|---|
| `app/(public)/mm-image-review/**` — the public client image-review page | Externally shared, token-gated, `noindex` client surface with its own self-contained light theme scoped under `.rv` (`review.css`, own hex palette, zero Tailwind). It is immune to the token swap by construction. It is IgniteIQ-branded client-facing collateral rather than internal LVL3 tooling, so it should arguably stay on IgniteIQ paper. Needs a call before stage 6. Includes `/logo-black.png`, which stays correct there. |

---

## Notable divergences from the spec

### Delta colours keep green/red instead of sienna (stage 4)

**Spec §4 says** a positive delta is `brand-400` sienna, a neutral one
`surface-400`, and a regression `--color-error`. lvl3.com's ledger renders both
`+28%` and `−23%` in sienna.

**We render** positive as `--color-success` (#7FB069) and negative as
`--color-error` (#F2555A) — the token pair, not the emerald-500/rose-500 the app
had before.

**Why:** a client-facing dashboard is scanned by people who read green-good/red-bad
without thinking, and dropping that costs more comprehension than the editorial
consistency gains. Matt made this call explicitly. The compromise is that the
convention stays while the *colours* move onto the palette — no new colours, and
`brand-400` remains reserved for accents, links and active states.

Direction never depends on colour alone: every delta also renders an arrow, and
where there's room a word ("Up 9%").

Owned by `lib/delta-tone.ts`, which is the only place those three classes are
chosen. Anyone wanting to return to the letter of the spec changes
`DELTA_TONE_TEXT` and nothing else.

### The exec band is ledger rows; the analytics strips stay tiles (stage 4)

Spec §4 allows either, and both are used deliberately. The exec band became
`components/ui/LedgerRow.tsx`. The three analytics KPI strips are genuine 3- and
8-up grids, so they keep `KpiCard` with the spec's internal treatment applied
(value in `surface-100`, hairline border, 2px radius) per "Where a grid of tiles
must stay a grid".

### `--surface-500` (stage 1b)

The token block labels `--surface-500` (`#6B6353`) as *muted on light* — a paper-mode
token, and paper is explicitly out of scope. But the app used it as its second muted
text tier: 350 `text-surface-500` + 29 `placeholder-surface-500` across ~101 files. On
`#171410` that is **3.2:1, failing AA for body text**.

Reassigned `text-` and `placeholder-` uses to `surface-400` (`#A79E8C`, the site's
`--d-muted`). The 33 `border-`, 13 `ring-`, and 3 `bg-surface-500` uses were left alone
— no contrast floor applies.

This collapses two muted tiers into one, which matches the system rather than losing
information: the ink end of the editorial system has exactly one muted tone. The second
tier only existed because the theme was paper.

### `accent-*` alias de-skewed (stage 1e)

The `accent` scale in `tailwind.config.ts` was deliberately offset one step
(`accent-400` → `--brand-500`) so accents landed on the paper accent `#AC3E19`. On ink
the validated anchor is `brand-400` (`#E0703F`, 5.7:1), so the alias is now 1:1 with
`brand`. One config edit instead of auditing 46 call sites; every accent moves one step
brighter, which is the direction the spec wants.

### Token families the spec did not anticipate (stage 1c)

`--nav-*`, `--sidebar-*`, and `--chart-*` are three whole families outside the spec's
"swap `surface-*`/`brand-*`" model, and three values were hardcoded white
(`--color-card`, `--nav-bg`, `--chart-tooltip-bg`) so they would not have flipped at
all. All re-pointed.

`--nav-bg` was pure white while `--sidebar-bg` was cream — the top bar had never
matched the sidebar. Both are now `surface-950`, separated by the `surface-800`
hairline, per the site's language.

Added `--chart-tooltip-fg` (`#181510`). `--chart-tooltip-bg` had 5 consumers and no
foreground token, so tooltip text fell through to a recharts default and `labelStyle`
resolved to `--chart-label` — 2.3:1 on the paper tooltip. A latent bug, not a
regression from this work.

### Dead tokens re-pointed, not deleted

`--color-card`, `--color-ink`, and `--color-cream-alt` have zero consumers. Left in
place with ink values rather than deleted, so wiring them up later cannot silently
reintroduce a light surface.

The `.iiq-input` / `.iiq-label` / `.iiq-required` utility block in `app/globals.css`
also has zero consumers, while `app/(auth)/login/page.tsx` hand-rolls exactly the
inputs those utilities were written for. Left in place; flagged for stage 4.

---

### No shared Button primitive (stage 3b)

The app has no Button/Input/Card primitive at all — no `cva`, no shadcn, no
`clsx` — so buttons are ad-hoc across ~40 sites in six flavours, including two
*opposite* hover directions shipping simultaneously (`hover:bg-brand-600`
darker in most files, `hover:bg-brand-400` lighter in the two admin connection
panels).

I normalised the colour/hover/focus triple **in place** rather than
introducing shared `.btn-*` classes and rewriting 40 call sites. Each site
keeps its own geometry (`flex-1`, `w-full`, `text-xs px-3 py-1.5`, …), which a
blind restructure would have disturbed — and at this point in the rebrand
there are no screenshots yet to catch a layout regression.

Extracting a real `<Button>` primitive is the right follow-up and belongs in
stage 4, where the component pass is already opening these files.

### Latent bugs found and fixed in passing (stage 3b)

- **`--color-interactive` was never defined anywhere.** Two TFK generator
  buttons used `background: var(--color-interactive)`, so they rendered with
  no background at all — white text on nothing. Repointed to `--color-accent`.
  (`app/(dashboard)/tools/tfk-generator/TfkGeneratorClient.tsx:281,382`)
- **Three login text links hovered `surface-400 → surface-400`** after stage
  1b collapsed the muted tiers — a no-op hover. Now `→ surface-100`.
- **`DashboardTabs` hardcoded `ring-offset-surface-900`**, correct only when
  the tab strip sits on a card. Switched to an inset ring, which needs no
  offset colour.

## Exception: /login is paper (Aug 2026, after stages 1–3)

The spec says *"No light mode in this pass."* The login page is now a deliberate
exception, at Matt's request. **It is the only light surface in the app** —
everything behind auth stays ink.

This needed no new colours. The token block already ships the paper end of the
scale for future use, and this is that future: `--surface-500`, which stage 1b had
to route *around* because it is labelled paper-only, finally does the job it was
designed for.

| Role | Ink | Paper | Source |
|---|---|---|---|
| Page background | `surface-950` | `surface-100` #F5F2EA | site `--paper` |
| Primary text | `surface-100` | `surface-950` #171410 | site `--ink` |
| Muted text | `surface-400` | `surface-500` #6B6353 | site `--muted` |
| Hairline | `surface-800` | `surface-200` #D8D1C0 | site `--rule` |
| Accent | `brand-400` | `brand-600` #AC3E19 | site `--accent` |
| Accent hover | `brand-300` | `brand-700` #8F3314 | site `--accent-deep` |

Measured live in the browser, and the numbers reproduce the design tokens' own
documented figures exactly:

| Pair | Measured |
|---|---|
| Ink text on paper | **16.41:1** |
| Accent on paper | **5.43:1** (tokens document 5.4:1) |
| Muted on paper | **5.31:1** (tokens document 5.3:1) |
| Paper text on the accent fill | **5.43:1** |

**The status colours do not survive the flip, and that is the one real catch.**
`--color-error` #F2555A is validated on ink only. Measured: **3.02:1 on paper — it
fails**, against 5.13:1 on `surface-900`. So the error blocks render as a small
**ink chip on the paper page** (`surface-950` background, error token on it) —
measured **5.44:1**. That keeps the validated pair and needs no paper-tuned red,
which the "no new colours" rule would have objected to. Pairing ink against paper
is the system's core move anyway.

One mechanism worth knowing: `body`'s className is fixed in the root layout and
cannot vary per route, so the page marks itself with `data-surface="paper"` and
`app/globals.css` carries a `body:has([data-surface='paper'])` rule. Without it,
overscroll flashes ink behind the paper page. Any future paper surface opts in the
same way.

The spec's caveat that the chart palette is not validated for paper still stands —
there are no charts on the login page, and this does not license one.

## Verification outcome (stages 1–3)

A fresh verification pass (no implementation) checked every stage 1–3 item
against the spec. It found real defects, since fixed — see the commit
"fix defects found by the verification pass". The pattern worth remembering:

**A Tailwind `hover:` class on the same element as an inline `style` for that
property never fires.** Inline style wins. This silently killed hover on the
TopBar brand link, the TopBar hamburger, three login inputs, and three sidebar
mobile items. Two more hovers were no-ops because both sides resolved to the
same value — most importantly the login magic-link button, which swapped
`--color-accent` for `--color-primary` after stage 1 had made them identical.

`MobileNavDrawer` had no hover state at all on 11 elements. It was never
touched by the earlier chrome work because nothing in it matched the greps
(no shadows, no gradients, no light-tuned palette classes) — a reminder that
the hover rule needs a per-file read, not a grep.

Measured live in the browser after the fixes:

| Check | Value |
|---|---|
| Body background / text | `rgb(23 20 16)` / `rgb(245 242 234)` — 16.4:1 |
| Primary button | `rgb(224 112 63)` bg, `rgb(23 20 16)` text — 5.7:1 |
| Primary button hover | → `rgb(229 155 112)` (brand-300, lighter) |
| Input border hover | `rgb(58 52 40)` → `rgb(92 84 67)` |
| Focus ring | `rgb(224 112 63) 0 0 0 2px` |
| Radius | 2px |
| Hover rules touching transform/box-shadow | 0 |
| Distinct focus indicators | 1 (112 elements) |

## Pre-existing issues found and not fixed in this pass

- `tests/e2e/smoke.spec.ts` looks broken independent of the rebrand: it fills
  `input[type="password"]` without first clicking the login page's "Sign in with
  password instead →" toggle, and the page defaults to magic-link. It `test.skip`s
  without `E2E_EMAIL`/`E2E_PASSWORD`, so it never fails visibly. Not fixed here —
  fixing it is a test change, not a visual one.
- `app/(public)/mm-image-review/[token]/review.css` uses the Tailwind **zinc** ramp by
  hex value (`#FAFAFA`, `#F4F4F5`, `#E4E4E7`, `#71717A`) while the portal used warm
  cream, so that page was already a different light theme from the rest of the app.
- `components/report-shell.tsx` hardcoded `#e5484d` six times — a different red from
  the brand token. Retokened in stage 3a.
- **`npm run build` runs out of V8 heap on this machine** during page-data
  collection. It reproduces at the `pre-rebrand-violet` tag, so it predates
  this work and is not a rebrand regression. Workaround used for every gate in
  this pass: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`. Worth
  either raising the limit in the `build` script or finding what is retaining
  memory — CI may be passing only because GitHub runners have more headroom.
- `DashboardTabs` renders its tabs as bare `<button>`s with no `role="tab"` or
  `aria-selected`. Untouched — an a11y fix, not a visual one.
- Two custom (non-Recharts-token) tooltips never adopted the paper tooltip and
  remain dark-on-panel — legible, but inconsistent with the other five:
  `components/analytics/seo/searchconsole/SerpDistributionChart.tsx:36` and
  `components/dashboard/modules/BrandedSplit.tsx:44`. Stage 5 work.
- **`public/market-eval.html` (646 KB) and `public/decision-dashboard.html`
  (479 KB) are static HTML deliverables with their own inline palettes** —
  black background, `#e5484d`-family red, the IgniteIQ Q-mark. The token swap
  cannot reach them; only the `report-shell` chrome overlaid on top of them
  retokened. So `/market-eval` is *not* a representative sample of the app's
  chart screens. Re-generating those two files is its own pass, and they carry
  IgniteIQ branding a client has already been sent — needs a call in stage 6.
- **Playwright could not run at all before this pass**: `@playwright/test`
  1.60.0 wants chromium build 1223 and only 1217 was on disk, so
  `npm run test:e2e` would have failed to launch a browser even with
  credentials set. Installed the matching chromium (browser binary for an
  already-declared devDependency; no package.json change).
