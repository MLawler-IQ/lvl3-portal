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
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '700'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://portal.igniteiq.com'),
  title: 'IgniteIQ Portal · Own Your Intelligence',
  description: 'The Decision Engine for Modern Trades.',
  openGraph: {
    title: 'IgniteIQ Portal',
    description: 'The Decision Engine for Modern Trades.',
    url: 'https://portal.igniteiq.com',
    siteName: 'IgniteIQ Portal',
    type: 'website',
  },
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
