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
