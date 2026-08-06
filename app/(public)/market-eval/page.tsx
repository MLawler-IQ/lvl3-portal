import type { Metadata } from 'next'
import { ReportShell } from '@/components/report-shell'

// `absolute` opts out of the root layout's `%s | LVL3 Portal` template. This page is
// an IgniteIQ client deliverable, not portal chrome — without this it would render as
// "Market Evaluation · IgniteIQ | LVL3 Portal", branding an IgniteIQ artifact with the
// portal's product name. See REBRAND-NOTES.md.
export const metadata: Metadata = {
  title: { absolute: 'Market Evaluation · IgniteIQ' },
  description: 'Decision-grade market evaluation.',
  robots: { index: false, follow: false },
}

export default async function MarketEvalPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view } = await searchParams
  return <ReportShell initialView={view === 'dashboard' ? 'dashboard' : 'report'} />
}
