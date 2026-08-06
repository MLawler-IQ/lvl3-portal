/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

// Canonical production URL, set via Vercel env (NEXT_PUBLIC_SITE_URL). While it
// is unset or still the legacy host, no redirect is emitted — the *.vercel.app
// host keeps serving during cutover so we never forward to a not-yet-live domain.
const CANONICAL_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
const LEGACY_HOST = 'lvl3-portal.vercel.app'

const nextConfig = {
  // Let a build target a different output directory.
  //
  // `next build` and `next dev` both write .next, so running a production build
  // while a dev server is up replaces the chunk files the dev server still holds
  // references to. It then 500s on every request with "Cannot find module
  // './1234.js'" from .next/server/webpack-runtime.js — including on the CSS
  // bundle, so the page renders completely unstyled and looks like a CSS bug
  // rather than a stale-artifact one. This bit us three times in one session.
  //
  // Gate builds now run as `NEXT_DIST_DIR=.next-build npm run build`, so the two
  // never share a directory. Unset in normal use, so Vercel is unaffected.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

  async redirects() {
    // Old dashboard link folds into the single-link report shell.
    // (Redirects run before middleware, so no auth whitelist is needed.)
    const redirects = [
      {
        source: '/decision-dashboard',
        destination: '/market-eval?view=dashboard',
        permanent: false,
      },
    ]
    if (!CANONICAL_URL || CANONICAL_URL.includes(LEGACY_HOST)) return redirects
    // 308-redirect old Vercel-host traffic to the custom domain, keeping path + query.
    return [
      ...redirects,
      {
        source: '/:path*',
        has: [{ type: 'host', value: LEGACY_HOST }],
        destination: `${CANONICAL_URL}/:path*`,
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'logo.clearbit.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
}

export default nextConfig
