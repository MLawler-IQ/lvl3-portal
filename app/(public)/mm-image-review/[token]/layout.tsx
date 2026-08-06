import type { Metadata } from 'next'
import './review.css'

// `absolute` opts out of the root layout's `%s | LVL3 Portal` template. This page is
// an IgniteIQ client deliverable, not portal chrome — without this it would render as
// "IgniteIQ · Content Review | LVL3 Portal", branding an IgniteIQ artifact with the
// portal's product name. See REBRAND-NOTES.md.
export const metadata: Metadata = {
  title: { absolute: 'IgniteIQ · Content Review' },
  robots: { index: false, follow: false },
}

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <div className="rv">{children}</div>
}
