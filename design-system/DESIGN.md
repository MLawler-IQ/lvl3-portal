# IgniteIQ Portal — Design System

**IgniteIQ v4.2** — light canvas, single red accent, neutral ink ramp, Inter + JetBrains Mono fallback for Aeonik / Aeonik Fono. Infrastructure-native aesthetic — Vercel · Stripe · Linear.

> **Brand source of truth.** The full PDF lives in Matt's Drive (`IgniteIQ/Updated Brand/IgniteIQ_Brand_Guidelines [updated].pdf`). Canonical export referenced in the PDF: `~/Desktop/igniteiq-theme-v2/exports/latest/`. When in doubt, the export wins.

## Architecture

All design tokens live as **CSS custom properties** in `app/globals.css`. Tailwind config and component code reference these variables — change colors in one place and everything updates.

- **`app/globals.css`** — single source of truth for color, nav, sidebar, chart tokens; heading rules; `.eyebrow` and `.iiq-input` utilities
- **`tailwind.config.ts`** — references CSS variables (supports opacity modifiers); not edited during the IgniteIQ rebrand
- **`app/layout.tsx`** — `next/font/google` imports for Inter + JetBrains Mono

> **Variable names preserved.** During the IgniteIQ rebrand, `--surface-*` and `--brand-*` were repointed to new values rather than renamed. Existing code that references `surface-900`, `brand-500`, etc. continues to work — `surface-950` is still "page bg", `surface-100` is still "primary text", just on a light canvas now.

## Color scales (RGB channels in globals.css)

### Surface — IgniteIQ ink ramp

| Token | Hex | IgniteIQ name | Usage |
|-------|-----|---------------|-------|
| `--surface-950` | #FCFBF9 | Ink 50  | Page canvas |
| `--surface-900` | #F7F6F4 | Ink 100 | Sunken surface / default card |
| `--surface-850` | #F1F0ED | Ink 150 | Card hover |
| `--surface-800` | #E5E4E1 | Ink 200 | Border default / hairlines |
| `--surface-700` | #D1D0CD | Ink 300 | Strong borders / input rules |
| `--surface-600` | #A5A4A1 | Ink 400 | Disabled |
| `--surface-500` | #7C7B78 | Ink 500 | Reflective clause / captions |
| `--surface-400` | #5C5B59 | Ink 600 | Body prose (fg-secondary) |
| `--surface-300` | #3C3B39 | Ink 800 | Strong text |
| `--surface-200` | #1E1D1C | Ink 900 | Near-black |
| `--surface-100` | #0A0A0A | Ink 1000 | Primary text · CTA band |

### Brand — IgniteIQ ignite ramp

| Token | Hex | IgniteIQ name | Usage |
|-------|-----|---------------|-------|
| `--brand-100` | #FEE2E2 | Ignite 100 | Diagram pill bg |
| `--brand-400` | #F87171 | Ignite 400 | Eyebrow color on dark |
| `--brand-500` | #EF4444 | Ignite 500 | **Brand red** — CTAs, accents, eyebrow on light, KPI numbers |
| `--brand-600` | #DC2626 | Ignite 600 | Button hover |
| `--brand-700` | #B91C1C | Ignite 700 | Pressed |

> **One accent.** Red is the only brand color outside the neutral ramp. State colors (`--color-error/-warning/-success`) exist as tokens but are reserved for product UI feedback, not marketing surfaces.

## Semantic aliases

```css
--background:      rgb(var(--surface-950));     /* light page */
--foreground:      rgb(var(--surface-100));     /* near-black ink */
--color-card:      rgb(255 255 255);            /* pure white card */
--color-accent:    rgb(var(--brand-500));       /* brand red */
--color-primary:   rgb(var(--brand-500));
--color-muted:     rgb(var(--surface-500));
--color-border:    rgb(var(--surface-800));
```

## Chart tokens (light canvas)

```css
--chart-tooltip-bg:     rgb(255 255 255);
--chart-tooltip-border: rgb(var(--surface-800));
--chart-grid:           rgb(var(--surface-800));
--chart-tick:           rgb(var(--surface-500));
--chart-label:          rgb(var(--surface-400));
--chart-line:           rgb(var(--brand-500));
--chart-bar-secondary:  rgb(var(--surface-800));
```

## Active-state backgrounds

```css
--active-bg:      rgb(var(--brand-500) / 0.10);
--active-bg-bold: rgb(var(--brand-500) / 0.14);
```

## Typography

- **Body / display**: Inter (`var(--font-inter)`) — placeholder for Aeonik. Weights 300–700.
- **Headings (h1–h6)**: Inter 600, `letter-spacing: -0.02em`. Set globally in `globals.css`.
- **Eyebrows / mono labels / code**: JetBrains Mono (`var(--font-jetbrains-mono)`) — placeholder for Aeonik Fono.

### Type scale (IgniteIQ v4.2)

| Role | Weight | Tracking | Notes |
|------|--------|----------|-------|
| H1 hero | 600 | -0.04em / 0.95 lh | "Own Your Intelligence." |
| H2 section | 600 | -0.035em / 1.0 lh | Two-tone declarative |
| H3 pillar | 600 | -0.02em / 1.15 lh | "The product is the infrastructure." |
| H4 timeline | 600 | -0.015em | Compact label |
| Lead body | 400 | 19px / 1.45 lh | |
| Body | 400 | 15px / 1.5 lh | |
| Eyebrow | 500 mono | 11px / 0.18em / uppercase | `.eyebrow` utility |

### Headline accents

- **Two-tone declarative**: primary clause in `--foreground` + reflective clause in `--color-muted`. Use `.headline-reflective` on the second `<span>`.
- **Statement red**: a single 140px sentence in `--brand-500`. Reserved as a once-per-page event — never normal body type.

## Component conventions

| Element | Spec |
|---------|------|
| Card | `bg-white border border-surface-800 rounded-[10px]` — no drop shadows on cards. Hover lift only when interactive. |
| Card hover | optional subtle lift `hover:-translate-y-1` with shadow ≤ 0.08 alpha |
| Input (IgniteIQ pattern) | Use `.iiq-input` (underline-only, no fill, no rounded corners) with `.iiq-label` above |
| Required field | Add `.iiq-required` to the label (red asterisk) |
| Primary button | `bg-brand-500 hover:bg-brand-600 text-white rounded-md px-4 py-2` (radius 6px max) |
| Secondary button | `bg-surface-100 text-white rounded-md px-4 py-2` (ink-1000 fill) |
| Tertiary button | underline only, color `--color-primary` |
| KPI number | `color: var(--color-accent)` + JetBrains Mono bold |
| Eyebrow | `.eyebrow` utility, prefixed with a 10×10px `--brand-500` square per IgniteIQ section-marker pattern |
| Border radii | Cards 10px · Buttons 6px · **never > 16px** |

## Chart conventions

All chart components reference CSS variables — no hardcoded hex values:

```tsx
<CartesianGrid stroke="var(--chart-grid)" />
<XAxis tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
<Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)' }} />
<Line stroke="var(--chart-line)" />
```

## Don'ts (from IgniteIQ Brand Guidelines v4.2)

**Visual**
- No icons in body prose
- No drop shadows on cards (CTA red glow / product image lift only)
- No gradients on type
- No rounded radii > 16px
- No second accent color
- No stock imagery

**Motion & copy**
- No bouncy easing — easing is `cubic-bezier(0.2, 0.0, 0.0, 1.0)`. Durations 80 / 140 / 220 / 360ms.
- No body text in red except the once-per-page Statement
- No fallback fonts as the design baseline (currently Inter is a documented placeholder until Aeonik is licensed for the portal)
- No dark text on dark sections — use `--surface-950` (`--ink-50`) on dark CTA bands

## How to change the palette

1. Edit `app/globals.css` — change RGB channel values in the `:root` block
2. Update this file (DESIGN.md) to document the new values
3. That's it — Tailwind classes, charts, nav, and sidebar all update automatically

## Known follow-ups (Phase 2)

- **Tool clients** — DONE. `app/(dashboard)/tools/*` is clean of inline violet hex (`#A78BFA`, `#8B5CF6`, `#7C3AED`); the sweep has shipped.
- **Aeonik fonts** — currently Inter + JetBrains Mono fallback. Self-host Aeonik Light/Regular/Medium/Bold + Aeonik Fono Light/Medium via `next/font/local` once the .otf files and licensing are sorted (`exports/latest/fonts/` in the IgniteIQ theme repo).
- **IgniteIQ Q-mark logo** — the brand square is currently a CSS-rendered red square placeholder in `components/nav/TopBar.tsx`. Drop `assets/logo-black.png` (or SVG) into `/public/` and replace the placeholder.
- **Email signature** in `app/actions/deliverables.ts` still reads `LVL3 Portal <portal@lvl3.com>` — left untouched because it affects sending infrastructure (DNS/SPF/DKIM). Coordinate with deliverability before swapping.
- **Form components** — apply `.iiq-input` + `.iiq-label` progressively to existing forms (login, modals, settings).
