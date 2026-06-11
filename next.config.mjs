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
  async redirects() {
    if (!CANONICAL_URL || CANONICAL_URL.includes(LEGACY_HOST)) return []
    // 308-redirect old Vercel-host traffic to the custom domain, keeping path + query.
    return [
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
