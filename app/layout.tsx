import type { Metadata } from 'next'
import { Archivo, JetBrains_Mono, Newsreader } from 'next/font/google'
import './globals.css'

// LVL3 editorial system. Archivo carries all UI and body text; Newsreader
// carries page titles and ledger/KPI numerals (with tabular-nums); JetBrains
// Mono is retained ONLY for code, IDs, API keys, and log output.
// The Aeonik faces this replaced remain in public/fonts/, unbound.
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
})

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  // Next 14's font-metrics table has no entry for Newsreader, so its automatic
  // fallback adjustment logs an error on every render. Declare the fallback
  // explicitly instead.
  adjustFontFallback: false,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '700'],
})

// Product name is "LVL3 Portal". `%s | LVL3 Portal` gives every page that sets its
// own title the suffix for free, and `default` covers the ones that don't.
//
// metadataBase deliberately stays on portal.igniteiq.com: that is the live host until
// the stage-7 domain flip, and pointing it at portal.lvl3.com early would emit
// absolute OG URLs for a host that does not resolve yet.
export const metadata: Metadata = {
  metadataBase: new URL('https://portal.igniteiq.com'),
  title: {
    default: 'LVL3 Portal',
    template: '%s | LVL3 Portal',
  },
  description: 'Search, analytics and delivery for the work we do together.',
  openGraph: {
    title: 'LVL3 Portal',
    description: 'Search, analytics and delivery for the work we do together.',
    url: 'https://portal.igniteiq.com',
    siteName: 'LVL3 Portal',
    type: 'website',
  },
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${newsreader.variable} ${jetbrainsMono.variable} antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-brand-400 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-surface-950"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}
