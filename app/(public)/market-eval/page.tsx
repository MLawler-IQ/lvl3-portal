import type { Metadata } from 'next'
import { ReportShell } from '@/components/report-shell'

export const metadata: Metadata = {
  title: 'Market Evaluation · IgniteIQ',
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
