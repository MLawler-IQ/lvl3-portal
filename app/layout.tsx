import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const aeonik = localFont({
  variable: '--font-inter',
  display: 'swap',
  src: [
    { path: '../public/fonts/Aeonik-Light.otf',   weight: '300', style: 'normal' },
    { path: '../public/fonts/Aeonik-Regular.otf', weight: '400', style: 'normal' },
    { path: '../public/fonts/Aeonik-Medium.otf',  weight: '500', style: 'normal' },
    { path: '../public/fonts/Aeonik-Medium.otf',  weight: '600', style: 'normal' },
    { path: '../public/fonts/Aeonik-Bold.otf',    weight: '700', style: 'normal' },
  ],
})

const aeonikFono = localFont({
  variable: '--font-jetbrains-mono',
  display: 'swap',
  src: [
    { path: '../public/fonts/AeonikFono-Light.otf',  weight: '300', style: 'normal' },
    { path: '../public/fonts/AeonikFono-Medium.otf', weight: '500', style: 'normal' },
    { path: '../public/fonts/AeonikFono-Medium.otf', weight: '600', style: 'normal' },
    { path: '../public/fonts/AeonikFono-Medium.otf', weight: '700', style: 'normal' },
  ],
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
      <body className={`${aeonik.variable} ${aeonikFono.variable} antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}
