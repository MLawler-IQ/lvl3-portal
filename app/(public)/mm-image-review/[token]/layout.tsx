import type { Metadata } from 'next'
import './review.css'

export const metadata: Metadata = {
  title: 'IgniteIQ · Content Review',
  robots: { index: false, follow: false },
}

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <div className="rv">{children}</div>
}
