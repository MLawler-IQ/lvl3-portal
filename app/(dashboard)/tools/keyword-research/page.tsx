import { requireAdmin } from '@/lib/auth'
import KeywordResearchClient from './KeywordResearchClient'

export default async function KeywordResearchPage() {
  await requireAdmin()

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <KeywordResearchClient />
    </div>
  )
}
