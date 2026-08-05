# LVL3-BRAND-PORTAL.md

Complete branding spec for rebranding the LVL3 Portal to match lvl3.com (the v1.2
editorial system). Written August 4, 2026.

Canonical sources, in precedence order. If this file ever disagrees with them, they win:

1. `~/lvl3-site/design-tokens.css` — every token value on the marketing site
2. `~/lvl3-site/BRAND.md` — the consolidated brand system
3. `~/lvl3-site/CLAUDE.md` and `~/lvl3-site/BUILD-SPEC.md` — build and content rules

---

## 0. Read this first: three stale documents

Before touching code, know that three docs describe a portal that no longer exists.

| Document | Claims | Reality |
|---|---|---|
| `~/CLAUDE.md` (root, auto-loads every session) | "Default Brand: LVL3 Portal (Zinc + Violet Dark Theme)" with a full violet spec | `app/globals.css` says *"SINGLE SOURCE OF TRUTH — IgniteIQ palette (Brand v4.2), Light canvas · neutral ink ramp · single red accent"* |
| `~/lvl3-site/BRAND.md` §3 | "The zinc + violet system belongs to the LVL3 Portal product UI" | No violet anywhere in portal `components/` or `app/` (only two unrelated `lib/` files) |
| `~/lvl3-site/BUILD-SPEC.md` /portal spec | "the violet-on-zinc product UI reads as 'the product' inside ink; never place portal screenshots on paper sections" | Portal is a light warm canvas today, so this screenshot rule is already wrong |

**Consequence for this rebrand:** you are not going violet-to-sienna. You are going
**IgniteIQ red-on-warm-light to LVL3 sienna-on-paper.** Both are light, warm-canvas,
single-accent systems. That is a much smaller move, and most of it is one file.

**Two decisions this forces**, neither of which is a detail:

1. **`BUILD-SPEC.md`'s /portal screenshot rule dies.** Once the portal is paper-and-sienna,
   framing its screenshots in ink sections makes them look broken, not product-like. New rule
   belongs in BUILD-SPEC: portal screenshots sit on **paper or panel** sections, with a 1px
   `--rule` border and no shadow. Ink sections keep the closing CTA and footer only.
2. **The root `CLAUDE.md` default brand must be rewritten**, or every artifact, dashboard, and
   component you generate in any future session keeps coming out violet. Section 12 has the
   replacement text.

---

## 1. The actual delta

Eight differences between the portal today and lvl3.com. Everything else already matches.

| # | Dimension | Portal now (IgniteIQ v4.2) | Target (LVL3 v1.2) | Cost |
|---|---|---|---|---|
| 1 | Accent hue | Red `#EF4444` / `#DC2626` | Burnt sienna `#AC3E19` / `#8F3314` | 1 file (token values) |
| 2 | Canvas | `#FCFBF9` near-white, pure white cards | `#F5F2EA` paper, `#FBF9F4` panel | 1 file |
| 3 | Neutral ramp | Cool-neutral grey (`#5C5B59`, `#0A0A0A`) | Warm brown-grey (`#6B6353`, `#181510`) | 1 file |
| 4 | Type faces | Aeonik + Aeonik Fono (mono) | Newsreader (serif) + Archivo (sans) | fonts + 1 file |
| 5 | Heading role | Sans 600, `-0.02em`, no serif anywhere | **Serif h1-h3**, blockquote, big numbers | new role, ~20 files |
| 6 | Label style | UPPERCASE MONO, 11px, `0.18em` tracking | `(Parenthetical)` sentence case, Archivo 500 14px accent | 7 `.eyebrow` + form labels |
| 7 | Radius | `rounded-xl` (98 files), `rounded-lg` (81 files) | **2px everywhere** | 1 file (see §5) |
| 8 | Containers | Cards with borders | **Hairline rules, not cards** | genuine component work |

Items 1-4 and 7 are token swaps. Items 5, 6, and 8 need real edits. Item 8 is the only one
that cannot be faked.

---

## 2. Why this is cheap: the indirection already exists

Your `globals.css` says the quiet part out loud:

> *"Variable names preserved (surface-\*, brand-\*) so existing components track automatically."*

Whoever did the IgniteIQ rebrand kept the Tailwind token names stable and swapped only the
values. Do the same thing again and 400+ components follow with no edits:

- `brand-400` → 51 files
- `brand-500` → 43 files
- `brand-600` → 13 files
- `surface-900` → 94 files
- `surface-950` → 15 files

Only **7 files hardcode a hex value**, and one colour (`#E5484D`) accounts for 6 of the
instances. That is the entire colour debt.

---

## 3. Drop-in token block

Replace the whole `:root` block in `app/globals.css`. Channel-separated RGB is kept so
Tailwind's `<alpha-value>` opacity modifiers keep working.

```css
:root {
  /* ═══════════════════════════════════════════════════════════
     SINGLE SOURCE OF TRUTH — LVL3 editorial system (v1.2, Aug 2026)
     Mirrors ~/lvl3-site/design-tokens.css. Paper canvas · warm ink
     ramp · one accent (burnt sienna). Variable names preserved so
     existing components track automatically.
     DO NOT ADD COLORS. Violet is banned. Red is retired.
     ═══════════════════════════════════════════════════════════ */

  /* ── Surface scale → LVL3 paper/ink ramp ──────────────────
     surface-950 = lightest (page canvas), surface-100 = darkest (text).
     Names stay inverted-from-color so the codebase keeps working. */
  --surface-950: 245 242 234;   /* #F5F2EA  --paper      page canvas */
  --surface-900: 251 249 244;   /* #FBF9F4  --panel      raised panel / card */
  --surface-850: 237 232 220;   /* #EDE8DC  --paper-alt  alternate block / hover */
  --surface-800: 216 209 192;   /* #D8D1C0  --rule       DECORATIVE hairline only */
  --surface-700: 143 132 105;   /* #8F8469  --rule-strong INTERACTIVE border (3:1) */
  --surface-600: 166 155 130;   /* disabled text / control */
  --surface-500: 107 99 83;     /* #6B6353  --muted      secondary text (5.31:1) */
  --surface-400: 107 99 83;     /* #6B6353  --muted      body prose (same token) */
  --surface-300: 42 37 28;      /* #2A251C  --ink-2      strong text, deep surface */
  --surface-200: 24 21 16;      /* #181510  --ink */
  --surface-100: 24 21 16;      /* #181510  --ink        primary text (16.27:1) */

  /* ── Brand scale → burnt sienna ───────────────────────────
     Only 500 and 600 are canonical (--accent / --accent-deep). The rest are
     interpolated for tints and dark-mode use. Never invent a new accent. */
  --brand-50:  250 240 235;
  --brand-100: 247 230 223;   /* badge / active tint */
  --brand-200: 238 205 191;
  --brand-300: 217 155 128;
  --brand-400: 224 112 63;    /* #E0703F  --d-accent  accent ON INK only */
  --brand-500: 172 62 25;     /* #AC3E19  --accent      5.43:1 on paper */
  --brand-600: 143 51 20;     /* #8F3314  --accent-deep 7.08:1 on paper */
  --brand-700: 122 43 17;
  --brand-800: 99 35 14;
  --brand-900: 74 26 10;

  /* ── Semantic aliases ─────────────────────────────────── */
  --background:      rgb(var(--surface-950));
  --foreground:      rgb(var(--surface-100));
  --color-ink:       rgb(var(--surface-100));
  --color-cream:     rgb(var(--surface-950));
  --color-cream-alt: rgb(var(--surface-850));
  --color-card:      251 249 244;              /* panel, NOT pure white */
  --color-accent:    rgb(var(--brand-500));    /* AA body on paper */
  --color-primary:   rgb(var(--brand-600));    /* AAA body; use for links */
  --color-muted:     rgb(var(--surface-500));
  --color-border:    rgb(var(--surface-800));  /* decorative hairline */
  --color-border-int: rgb(var(--surface-700)); /* NEW: interactive borders, see §6 */

  /* ── Status colors — PORTAL-ONLY EXTENSION, see §6 ─────── */
  --color-error:    #9F1239;   /* 7.17:1 on paper */
  --color-warning:  #6B5416;   /* 6.46:1 */
  --color-success:  #265E3B;   /* 6.83:1 */
  --color-info:     #1F4E5F;   /* 8.11:1 */
  --tint-error:     #F7E4E8;
  --tint-warning:   #F2EBD9;
  --tint-success:   #E2EDE4;
  --tint-info:      #E2ECEF;
  --tint-accent:    #F7E6DF;

  /* ── Nav tokens ───────────────────────────────────────── */
  --nav-bg:          rgb(var(--surface-950));  /* paper, matches site nav */
  --nav-hover:       rgb(var(--surface-900));
  --nav-text:        rgb(var(--surface-500));
  --nav-text-bright: rgb(var(--surface-100));
  --nav-active:      rgb(var(--brand-500));
  --nav-border:      rgb(var(--surface-800));

  /* ── Sidebar tokens ───────────────────────────────────── */
  --sidebar-bg:          rgb(var(--surface-950));
  --sidebar-hover:       rgb(var(--surface-900));
  --sidebar-text:        rgb(var(--surface-500));
  --sidebar-text-bright: rgb(var(--surface-100));
  --sidebar-active:      rgb(var(--brand-500));
  --sidebar-border:      rgb(var(--surface-800));

  /* ── Chart tokens (light canvas) ───────────────────────── */
  --chart-tooltip-bg:     rgb(var(--surface-100));  /* ink tooltip, paper text */
  --chart-tooltip-fg:     rgb(var(--surface-950));
  --chart-tooltip-border: rgb(var(--surface-100));
  --chart-grid:           rgb(var(--surface-800));
  --chart-tick:           rgb(var(--surface-500));
  --chart-label:          rgb(var(--surface-500));
  --chart-line:           rgb(var(--brand-500));
  --chart-line-secondary: rgb(var(--surface-500));
  --chart-bar-secondary:  rgb(var(--surface-850));

  /* ── Active-state backgrounds ─────────────────────────── */
  --active-bg:      rgb(var(--brand-500) / 0.08);
  --active-bg-bold: rgb(var(--brand-500) / 0.12);

  /* ── Type ─────────────────────────────────────────────── */
  --serif: var(--font-serif), Georgia, 'Times New Roman', serif;
  --sans:  var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --radius: 2px;
}
```

### Ink mode (dark sections and any future dark theme)

The site has only five ink tokens, which is not enough for an app. These extend them
without inventing new hues. Verified ratios in §7.

```css
[data-theme="ink"], .ink-section {
  --surface-950: 23 20 16;      /* #171410  --d-bg */
  --surface-900: 30 26 20;      /* #1E1A14  --d-panel */
  --surface-850: 38 33 26;      /* derived: panel hover */
  --surface-800: 58 52 40;      /* #3A3428  --d-rule  decorative */
  --surface-700: 114 104 82;    /* #726852  derived: interactive border, 3.15:1 */
  --surface-600: 128 119 100;   /* derived: disabled */
  --surface-500: 167 158 140;   /* #A79E8C  --d-muted  6.92:1 */
  --surface-400: 167 158 140;
  --surface-300: 220 214 202;
  --surface-200: 240 236 228;
  --surface-100: 245 242 234;   /* #F5F2EA  paper text on ink, 16.41:1 */

  --color-accent:  rgb(var(--brand-400));  /* #E0703F, 5.73:1 on d-bg */
  --color-primary: rgb(var(--brand-400));  /* sienna-500 is too dark on ink */
  --color-border:  rgb(var(--surface-800));
  --color-card:    30 26 20;

  --color-error:   #F2748C;   /* 6.31:1 on d-panel */
  --color-warning: #D9B25C;   /* 8.63:1 */
  --color-success: #78C48A;   /* 8.29:1 */
  --color-info:    #7FB0C4;   /* 7.34:1 */

  --chart-tooltip-bg: rgb(var(--surface-100));
  --chart-tooltip-fg: rgb(var(--surface-950));
  --chart-line:       rgb(var(--brand-400));
}
```

**Note the accent flip.** On ink you must use `brand-400` (`#E0703F`), not `brand-500`.
Sienna `#AC3E19` on `#171410` is roughly 2.2:1 and fails outright. This is the single most
common mistake when porting this palette to a dark surface.

---

## 4. Typography

The portal loads Aeonik via `localFont` but names the CSS variables `--font-inter` and
`--font-jetbrains-mono`. Both names are lies already. Fix the names while you swap the faces.

```ts
// app/layout.tsx
import { Archivo, Newsreader } from 'next/font/google'

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
})

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],   // italic is required: headline emphasis
  weight: ['400', '500'],
  variable: '--font-serif',
  display: 'swap',
})

// <html className={`${archivo.variable} ${newsreader.variable}`}>
```

Matches the site exactly (`~/lvl3-site/app/layout.jsx`): build-time download, self-hosted,
zero runtime Google Fonts requests. You can delete the eight Aeonik `.otf` files from
`public/fonts/`.

### Role assignment

| Element | Face | Spec |
|---|---|---|
| h1, h2, **h3** | Newsreader | weight 500, `-0.01em`, line-height 1.12 |
| blockquote | Newsreader | 500 |
| KPI values, big numbers, ledger values | Newsreader | 500, `tabular-nums` |
| h4, h5, h6 | Archivo | 600 |
| Body, UI, buttons, table cells, forms | Archivo | 400/500/600 |
| Data and metrics anywhere | Archivo or Newsreader | **always `tabular-nums`** |

**Serif runs to h3.** `BRAND.md` §4 records this as a correction: an earlier draft gave h3 to
the sans, the approved prototype sets Newsreader on every `h3`, and the prototype wins.

```css
/* replaces the current h1-h6 rule */
h1, h2, h3, blockquote {
  font-family:    var(--serif);
  font-weight:    500;
  line-height:    1.12;
  letter-spacing: -0.01em;
  color:          var(--foreground);
}
h4, h5, h6 {
  font-family: var(--sans);
  font-weight: 600;
  color:       var(--foreground);
}
/* Headline emphasis is italic AND accent. Never bold, never underline, never a size change. */
h1 em, h2 em, h3 em, blockquote em {
  font-style: italic;
  color:      var(--color-accent);
}
```

Type scale from the site: h1 `clamp(36px,4.8vw,60px)`, section h2 `clamp(30px,4vw,44px)`,
h3 20-26px, body 15-16px, small 13-14px.

### Mono is banned

`font-mono` appears in 18 files. `BRAND.md` §8 bans mono fonts outright. Mono in the portal is
doing one legitimate job: aligning digits. Archivo with `tabular-nums` does that job.

- **Option A (zero-touch):** point `fontFamily.mono` at the Archivo stack in
  `tailwind.config.ts`. `font-mono` silently stops being mono. Fastest, but leaves 18 files
  with a class name that lies, and does not add `tabular-nums`.
- **Option B (recommended):** point `mono` at Archivo *and* sweep the 18 files,
  `font-mono` → `font-sans tabular-nums`. Then delete `mono` from the config so it can't
  come back.

---

## 5. `tailwind.config.ts` changes

```ts
theme: {
  extend: {
    // 2px everywhere. Redefining the scale means the 98 files using rounded-xl
    // and 81 using rounded-lg need NO edits. rounded-full is preserved on purpose,
    // for avatars and status dots only.
    borderRadius: {
      none: '0',
      sm: '2px', DEFAULT: '2px', md: '2px', lg: '2px',
      xl: '2px', '2xl': '2px', '3xl': '2px',
      full: '9999px',
    },
    fontFamily: {
      serif: ['var(--font-serif)', 'Georgia', 'Times New Roman', 'serif'],
      sans:  ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      // mono deleted; see §4
    },
    colors: {
      // ... surface/brand scales unchanged, they read the CSS vars ...
      error: 'var(--color-error)',
      warning: 'var(--color-warning)',
      success: 'var(--color-success)',
      info: 'var(--color-info)',
    },
    boxShadow: {
      // Shadows do not exist in this system. Neutralize the scale so a stray
      // shadow-lg cannot reintroduce depth.
      none: 'none', sm: 'none', DEFAULT: 'none', md: 'none',
      lg: 'none', xl: 'none', '2xl': 'none', inner: 'none',
    },
    animation: {
      // fade-in stays. slide-in-up is a translateY lift and is banned (BRAND.md §5).
      'fade-in': 'fadeIn 0.15s ease-out',
      'slide-in-right': 'slideInRight 0.2s ease-out',  // drawers only
    },
  },
}
```

The radius trick is the single highest-leverage change in this document: 179 files inherit
2px without being touched.

Also delete the `accent` colour block. It aliases `brand` with an off-by-one shift
(`accent-400` → `brand-500`), which is exactly how a second accent gets born.

---

## 6. Two gaps the site palette does not cover

The marketing site is five pages of prose. A dashboard needs two things it does not have.
Both are documented here as **portal-only extensions**, and neither may appear on lvl3.com.

### 6.1 Interactive borders fail WCAG at `--rule`

`--rule` `#D8D1C0` is **1.36:1 on paper**. That is correct and intentional for a decorative
hairline (WCAG 1.4.11 exempts pure decoration), but form inputs, select controls, checkboxes,
and toggle borders are **UI components** and need **3:1**. Your `.iiq-input` currently uses
`var(--color-border)` for its underline, so a straight mapping would ship an accessibility
regression across every form in the app.

**Resolution:** add `--rule-strong` = `#8F8469` (**3.31:1 on paper, 3.52:1 on panel**), exposed
as `surface-700` and `--color-border-int`.

- Decorative dividers, table row rules, section separators → `--color-border` (`#D8D1C0`)
- Input borders, control outlines, anything the user can operate → `--color-border-int` (`#8F8469`)

### 6.2 Status colours

`BRAND.md` §3 says: *"There is no success green, no warning yellow. State is communicated in
accent or muted."* That works for marketing copy. It does not work for a dashboard that has to
show a failed sync, an expiring token, and a metric moving the wrong way.

**Resolution:** a four-colour state set, deliberately desaturated and darkened into the warm
register so it reads as part of the system rather than bootstrap defaults. All AA on paper.
Restricted to **state semantics only** — never decoration, never charts, never a second accent.

| Role | Light | On paper | Dark | On d-panel | Tint (light) |
|---|---|---|---|---|---|
| Error / danger | `#9F1239` | 7.17:1 | `#F2748C` | 6.31:1 | `#F7E4E8` |
| Warning | `#6B5416` | 6.46:1 | `#D9B25C` | 8.63:1 | `#F2EBD9` |
| Success | `#265E3B` | 6.83:1 | `#78C48A` | 8.29:1 | `#E2EDE4` |
| Info | `#1F4E5F` | 8.11:1 | `#7FB0C4` | 7.34:1 | `#E2ECEF` |

Error is a cool crimson on purpose. A warmer red would collide with sienna: measured against
`#AC3E19` directly, `#9F1239` gives 1.32 and a conventional `#DC2626` gives about 1.1, meaning
an error chip would be nearly indistinguishable from an accent element. Warning is pushed
toward olive for the same reason.

**Metric deltas are the exception and should NOT use these.** Follow the site's ledger: the
sign carries the direction, the number is `tabular-nums`, right-aligned.

- Positive: `--accent-deep` `#8F3314` (7.08:1)
- Negative: `--color-error` `#9F1239`
- Flat: `--color-muted`

Never a green up-arrow. The site's ledger renders `+18% MoM` in accent with no glyph.

---

## 7. Verified contrast matrix

Computed, not estimated. WCAG 2.1: 4.5:1 body text, 3:1 large text and UI components.

| Foreground on background | Ratio | Verdict |
|---|---|---|
| ink `#181510` on paper `#F5F2EA` | **16.27** | AAA |
| ink on panel `#FBF9F4` | **17.30** | AAA |
| ink on paper-alt `#EDE8DC` | **14.89** | AAA |
| muted `#6B6353` on paper | **5.31** | AA body |
| muted on panel | **5.65** | AA body |
| muted on paper-alt | **4.86** | AA body (thin margin) |
| accent `#AC3E19` on paper | **5.43** | AA body |
| accent on panel | **5.77** | AA body |
| accent on paper-alt | **4.97** | AA body (thin margin) |
| accent-deep `#8F3314` on paper | **7.08** | AAA |
| paper on ink (primary button) | **16.27** | AAA |
| paper on accent-deep (button hover) | **7.08** | AAA |
| rule-strong `#8F8469` on paper | **3.31** | PASS 3:1 UI |
| d-muted `#A79E8C` on d-bg | **6.92** | AA body |
| d-accent `#E0703F` on d-bg | **5.73** | AA body |
| d-accent on d-panel | **5.41** | AA body |
| paper on d-bg | **16.41** | AAA |
| rule `#D8D1C0` on paper | 1.36 | decorative only, never a control border |
| d-rule `#3A3428` on d-bg | 1.49 | decorative only |

Two watch items: `muted` and `accent` on `paper-alt` land at 4.86 and 4.97. Both pass, with
little headroom. Do not use `paper-alt` behind small muted text; use `paper` or `panel`.

---

## 8. Component specs

### Buttons

```
Primary   bg --ink / text --paper / 2px radius / Archivo 600 15px / padding 15px 28px
          hover: bg --accent-deep
Primary   (on ink sections) bg --paper / text --ink; hover bg --paper-alt
Secondary text link treatment, not an outlined button (see Text links)
Destructive bg --color-error / text --paper
Disabled  bg surface-850 / text surface-600 / cursor not-allowed / no opacity trick
```

No shadow, no lift, no scale. Hover changes background only.

### Text links

1.5px accent `border-bottom`, **not** `text-decoration: underline`.

```css
.tlink { font-weight: 600; border-bottom: 1.5px solid var(--color-accent); padding-bottom: 2px; }
.tlink:hover { color: var(--color-accent); }
```

For body-size links prefer `--color-primary` (`#8F3314`, AAA) over `--color-accent`.

### Inputs and labels

The IgniteIQ underline-only pattern (`.iiq-input`) is replaced by the site's bordered field.
Rename these `.lvl3-input` / `.lvl3-label` and delete the `iiq-` names.

```css
.lvl3-input {
  width: 100%; padding: 13px 14px; font-family: var(--sans); font-size: 15px;
  background: var(--color-card);
  border: 1px solid var(--color-border-int);   /* 3:1, see §6.1 */
  border-radius: 2px; color: var(--foreground);
}
.lvl3-input::placeholder { color: var(--color-muted); }
.lvl3-input:focus { outline: 2px solid var(--color-accent); outline-offset: 0; }

/* Sentence case, NOT uppercase mono. This is the biggest visual break from IgniteIQ. */
.lvl3-label { font-size: 13.5px; font-weight: 600; display: block; margin-bottom: 6px; }
.lvl3-required::after { content: ' *'; color: var(--color-accent); }
```

Select chevrons must be an **inline SVG data URI**, never a gradient. The site's exact path,
with the stroke hex hand-matched to `--muted` because `url()` cannot read a CSS variable:

```css
background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%236B6353' stroke-width='1.5'/%3E%3C/svg%3E");
```

### Labels and eyebrows

Replace all 7 `.eyebrow` usages.

```css
/* was: uppercase, 11px, 0.18em tracking, mono */
.sec-label {
  display: block; font-family: var(--sans); font-size: 14px; font-weight: 500;
  color: var(--color-accent); margin-bottom: 20px;
}
```

Content is **parenthetical and sentence case**: `(Overview)`, `(This month)`, `(Needs attention)`.
`BRAND.md` §4: *"Never uppercase tracked eyebrows."*

### Cards become rules

The one change tokens cannot do for you. `BRAND.md` §5: *"Rules, not cards. Card borders with
shadows do not exist."*

Three honest migration tiers, in ascending cost:

1. **Neutralize** (1 file): shadows already dead via the config in §5; set card borders to 1px
   `--color-border` and radius to 2px. Cards become flat outlined boxes. Not the editorial
   system, but not wrong either.
2. **Panel** (per component): `background: var(--color-card)` with a 1px `--color-border`, 2px
   radius. This is legitimate — the site does exactly this for `.sys-panel` and `.chart-card`.
   **Use this for genuinely panel-shaped things: charts, forms, modals.**
3. **Rule** (per component): delete the container. Content separates with `border-top: 1px solid
   var(--color-border)` per row. **Use this for lists, ledgers, tables, KPI groups, settings
   rows** — anything currently a grid of small cards.

Tier 3 is what makes it look like lvl3.com. Reference implementations to copy from
`~/lvl3-site/app/globals.css`: `.row`, `.case`, `.point`, `.pillar-row`, `.post-row`, `.ledger`.

### Ledger table (the signature component)

`FIX-PLAN.md` protected-list item 1 calls this out as load-bearing and forbids degrading it:
*"hairline-ruled tables, Newsreader tabular numerals, right-aligned accent deltas. Never cards,
badges, or smaller numbers."*

```css
.ledger { width: 100%; border-collapse: collapse; }
.ledger tr { border-top: 1px solid var(--color-border); }
.ledger tr:last-child { border-bottom: 1px solid var(--color-border); }
.ledger td { padding: 16px 8px 16px 0; font-size: 14.5px; }
.ledger .l-label { color: var(--color-muted); width: 44%; }
.ledger .l-value { font-family: var(--serif); font-size: 22px; font-weight: 500;
                   font-variant-numeric: tabular-nums; }
.ledger .l-delta { text-align: right; font-weight: 600; font-size: 13.5px;
                   font-variant-numeric: tabular-nums; }
```

### KPI tiles

Currently violet-era numbers in mono. Target: Newsreader 500, `tabular-nums`, `clamp(30px,3.6vw,40px)`,
in `--foreground` — **not** in accent. Caption 13px `--muted`. Group separated by a top hairline,
no per-tile card. Copy `.stats` from the site.

### Badges and pills

2px radius, not `rounded-full`. Tinted background from §6.2 with the matching text colour
(all clear 6:1 on their tint). Archivo 600, 12.5px. No icon required; the label carries it.

### Nav and sidebar

- Height 64px, `background: var(--nav-bg)` (paper), `border-bottom: 1px solid var(--nav-border)`.
  **No blur, no transparency, no shadow** — `BUILD-SPEC.md` is explicit.
- Item: Archivo 500 14px `--nav-text`; hover `--nav-text-bright`.
- Active: `--nav-text-bright` plus a **1.5px accent `border-bottom`**, and `aria-current="page"`.
  Do not use a filled pill.
- Sidebar active: 3px accent `border-left` plus `--active-bg` background. Matches the site's
  `.sys-tab.active`.
- Logo lockup: `LVL3` in Archivo 800, 20px, `-0.02em`, with the period in `--color-accent`.
  On ink surfaces the period takes `brand-400`.

### Charts (Recharts)

The site hand-rolls inline SVG; you have Recharts. The tokens in §3 map cleanly. Rules from
`BRAND.md` §5: single series, accent line, recessive grid, sample data always labelled as sample.

```tsx
<CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />
<XAxis tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
       axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} />
<YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
       axisLine={false} tickLine={false} />
<Tooltip
  contentStyle={{ background: 'var(--chart-tooltip-bg)', color: 'var(--chart-tooltip-fg)',
                  border: 'none', borderRadius: 2, fontSize: 12.5, fontWeight: 600 }}
  itemStyle={{ color: 'var(--chart-tooltip-fg)' }} />
<Line type="monotone" dataKey="v" stroke="var(--chart-line)" strokeWidth={2} dot={false}
      activeDot={{ r: 3, fill: 'var(--chart-line)' }} />
```

- **Horizontal gridlines only.** Vertical grid reads as a table, not an editorial chart.
- No `strokeDasharray`, no area fills, no gradients (`<linearGradient>` under an Area chart is
  the most common way this system gets violated).
- Multi-series is a **last resort**. When unavoidable: accent, then `--chart-line-secondary`
  (muted), then `--surface-300`. Differentiate by label, never by adding hues.
- Every axis and tick uses `tabular-nums`.
- Any sample or illustrative data carries a visible `sample data` label. This is a content rule,
  not a style preference.

### Modals, drawers, toasts

- Panel treatment: `--color-card`, 1px `--color-border`, 2px radius, no shadow.
- Scrim: `rgb(24 21 16 / 0.4)`. **No `backdrop-filter`** — banned outright.
- Enter: `fade-in` only. `slide-in-up` is a translateY lift; delete it. `slide-in-right` is
  acceptable for a drawer, since that is the drawer's actual direction of travel.
- Toast: 2px radius, 1px border, status tint background, status text colour.

### Focus

One rule, sitewide, matching the site exactly:

```css
a:focus-visible, button:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

Accent on paper is 5.43:1, so the ring clears 3:1 comfortably. On ink surfaces the ring must
switch to `brand-400`.

### Selection

```css
::selection { background: var(--color-accent); color: var(--surface-950); }
```

---

## 9. Migration checklist

Ordered by leverage. Steps 1-4 are most of the visual change.

- [ ] **1.** Replace the `:root` block in `app/globals.css` (§3). Add the ink block.
- [ ] **2.** `tailwind.config.ts`: radius scale, `boxShadow` neutralized, `fontFamily`,
      `accent` block deleted, `info` added, `slide-in-up` removed (§5).
- [ ] **3.** Fonts: Newsreader + Archivo via `next/font/google`; rename `--font-inter` →
      `--font-sans` and `--font-jetbrains-mono` → `--font-serif`; delete 8 Aeonik `.otf` files (§4).
- [ ] **4.** Heading rule: serif on h1-h3 + blockquote, `em` = italic + accent (§4).
- [ ] **5.** 7 files with hardcoded hex. `#E5484D` (6 instances) → `var(--color-error)`.
      Also `#FCFBF9`, `#EF4444`, `#DC2626`, `#F87171`, `#9CA3AF`, `#5C5B59`, `#60A5FA`,
      `#4ADE80`, `#2DD4BF`, `#10131A`, `#0A0A0A`, `#020617`.
- [ ] **6.** Forms: `.iiq-input`/`.iiq-label`/`.iiq-required` → `.lvl3-*`, bordered field,
      `--color-border-int`, sentence-case labels (§8). **Verify no control keeps a 1.36:1 border.**
- [ ] **7.** 7 files using `.eyebrow` → `.sec-label`, parenthetical sentence case (§8).
- [ ] **8.** 18 files using `font-mono` → `font-sans tabular-nums`; delete `mono` from config (§4).
- [ ] **9.** Cards → rules, tier by tier (§8). Highest-value targets: KPI grids, list views,
      settings rows, project tracker, deliverables.
- [ ] **10.** Recharts theming pass; strip any gradient fills and vertical grids (§8).
- [ ] **11.** Nav and sidebar active states: accent border, not filled pill (§8).
- [ ] **12.** Print styles reference `.rounded-xl` (`break-inside: avoid`). The class still
      exists, now at 2px, so this keeps working. Re-check the print view anyway — it hardcodes
      `background: #fff`, which should become `--surface-950`.
- [ ] **13.** Update the three stale docs (§0, §12).
- [ ] **14.** Contrast audit against §7. Watch small muted text on `paper-alt` (4.86).

---

## 10. Banned, with the reason

From `BRAND.md` §5 and `CLAUDE.md`. These fail review, they are not preferences.

| Banned | Why it matters here |
|---|---|
| Violet, any shade | The old portal identity. Its absence is the point. |
| Red `#EF4444` | The IgniteIQ identity. Retired by this rebrand. |
| Any second accent | One accent. `accent-*` aliasing `brand-*` is how a second one appears. |
| Gradients | Includes Recharts `<linearGradient>` area fills. |
| Shadows, glassmorphism, `backdrop-filter` | Neutralized in the config so it can't creep back. |
| Hover `translateY` lifts, scale transforms | `FIX-PLAN` protected item 6: colour, underline, background only. |
| Count-up number animations | KPI values render at final value immediately. |
| Scroll-reveal | Content is present on load. |
| Radius > 2px | Except `rounded-full` for avatars and status dots. |
| Mono fonts, Inter, any third face | Newsreader + Archivo only. |
| Emoji | In UI, empty states, and toasts alike. |
| UPPERCASE TRACKED EYEBROWS | Parenthetical sentence case instead. |
| Stock imagery | No decorative illustration. |
| Unlabelled sample data | Sample or illustrative numbers carry a visible label. |

---

## 11. Voice for app UI

The site's writing rules apply, with one addition: marketing voice persuades, app voice
instructs. Keep the constraints, drop the argument.

Hard rules (identical to the site): **never an em dash** (commas, parentheses, or two
sentences), never the ellipsis character `…` (write three periods or none), active voice,
contractions, one idea per sentence, lead with the point, say it once.

Banned words: leverage, utilize, seamless, unlock, elevate, empower, "in order to",
"deep dive", "circle back", "reach out", "going forward", "it's important to note".

App-specific patterns:

| Surface | Pattern | Example |
|---|---|---|
| Empty state | What goes here, then the one action | "No projects yet. Add your first project to start tracking." |
| Error | What failed, then what to do | "That sync failed. Check the connection and try again." |
| Loading | Present participle, no ellipsis character | "Loading" / "Saving" |
| Success | Past tense, no exclamation | "Saved." |
| Destructive confirm | Name the consequence, name the object | "Delete the Q3 report? This can't be undone." |
| Button | Verb + object, sentence case | "Add project", not "ADD PROJECT" or "Submit" |
| Metric caption | Metric, then window | "Revenue attributed to organic, 28 days" |

Both content rules carry into the portal: no pricing figure in client-facing UI, and any
illustrative metric stays labelled as sample data.

---

## 12. Replacement text for the stale docs

### `~/CLAUDE.md` — replace the "Default Brand" section

The current section is the violet spec and is the reason generated output keeps coming out
violet. Replace the colour and typography lists with:

```
## Default Brand: LVL3 (Paper + Burnt Sienna Editorial)

Apply to ALL generated documents, artifacts, dashboards, presentations, HTML, and
React components unless IgniteIQ brand is explicitly requested.

Colors:  paper #F5F2EA, panel #FBF9F4, paper-alt #EDE8DC, ink #181510,
         ink-2 #2A251C, muted #6B6353, rule #D8D1C0 (decorative) /
         #8F8469 (interactive), accent #AC3E19, accent-deep #8F3314.
         Ink sections: #171410 bg, #1E1A14 panel, #3A3428 rule,
         #A79E8C muted, #E0703F accent.
Type:    Newsreader (serif) for h1-h3, blockquote, big numbers.
         Archivo for everything else. No mono, no Inter.
Labels:  parenthetical sentence case, "(The problem)". Never uppercase tracked.
Shape:   2px radius. Hairline rules, not cards. No shadows, no gradients.
Accent:  one only. Violet and red both fail review.
Data:    font-variant-numeric: tabular-nums.

Full spec: ~/lvl3-portal/design-system/LVL3-BRAND-PORTAL.md
```

### `~/lvl3-site/BRAND.md` §3 — amend the violet paragraph

The current text explains violet's absence by pointing at the portal. After this rebrand that
reasoning is stale. Amend to record that the portal moved onto this same system, and that no
violet exists in either product.

### `~/lvl3-site/BUILD-SPEC.md` /portal spec — retire the screenshot rule

Replace *"real screenshots framed inside ink sections (the violet-on-zinc product UI reads as
'the product' inside ink; never place portal screenshots on paper sections)"* with: portal
screenshots sit on paper or panel sections with a 1px `--rule` border and no shadow, because
the product UI now shares the site's palette. Ink sections keep the closing CTA and footer.
