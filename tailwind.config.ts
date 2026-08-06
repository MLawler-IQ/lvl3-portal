import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // lib/ holds class strings too — the token maps (lib/grade-tone.ts,
    // lib/delta-tone.ts) and some generated CSS. Without this Tailwind never sees
    // them, so classes defined ONLY in lib/ are silently never generated and the
    // element renders untinted. That is exactly what happened to the C/D grade
    // chips: bg-warning/10 and border-warning/40 live nowhere else.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Warm ink/paper neutral scale — references CSS variables in globals.css
        surface: {
          950: 'rgb(var(--surface-950) / <alpha-value>)',
          900: 'rgb(var(--surface-900) / <alpha-value>)',
          850: 'rgb(var(--surface-850) / <alpha-value>)',
          800: 'rgb(var(--surface-800) / <alpha-value>)',
          700: 'rgb(var(--surface-700) / <alpha-value>)',
          600: 'rgb(var(--surface-600) / <alpha-value>)',
          500: 'rgb(var(--surface-500) / <alpha-value>)',
          400: 'rgb(var(--surface-400) / <alpha-value>)',
          300: 'rgb(var(--surface-300) / <alpha-value>)',
          200: 'rgb(var(--surface-200) / <alpha-value>)',
          100: 'rgb(var(--surface-100) / <alpha-value>)',
        },
        // Burnt-sienna accent scale — references CSS variables in globals.css
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        // Accent mirrors brand 1:1. The old map was deliberately skewed one
        // step (accent-400 → brand-500) so accents landed on the paper accent;
        // on ink the anchor is brand-400, so the skew is retired.
        accent: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        // Status colors — semantic tokens.
        // Triplet form so alpha modifiers work: `bg-error/15`, `border-error/20`.
        // A bare var() here drops the slash silently and renders opaque.
        error:   'rgb(var(--status-error) / <alpha-value>)',
        warning: 'rgb(var(--status-warning) / <alpha-value>)',
        success: 'rgb(var(--status-success) / <alpha-value>)',
      },
      // The editorial system is 2px everywhere; nothing rounder. Overriding the
      // whole scale re-shapes all 127 files of rounded-* utilities without a
      // class audit. rounded-full survives for avatars, dots, and pills.
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '2px',
        md: '2px',
        lg: '2px',
        xl: '2px',
        '2xl': '2px',
        '3xl': '2px',
        full: '9999px',
      },
      fontFamily: {
        // Archivo: all UI and body text. Newsreader: page titles, section
        // headings, and ledger/KPI numerals (pair with tabular-nums).
        // JetBrains Mono: code, IDs, API keys, and log output only.
        sans:  ['var(--font-archivo)', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['var(--font-newsreader)', 'Georgia', 'serif'],
        mono:  ['var(--font-jetbrains-mono)', 'monospace'],
      },
      animation: {
        "fade-in":        "fadeIn 0.15s ease-out",
        "slide-in-right": "slideInRight 0.2s ease-out",
        "slide-in-up":    "slideInUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideInRight: {
          "0%":   { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        slideInUp: {
          "0%":   { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
