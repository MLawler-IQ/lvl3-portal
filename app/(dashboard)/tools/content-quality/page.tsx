import { requireAdmin } from '@/lib/auth'
import ContentQualityClient from './ContentQualityClient'

export default async function ContentQualityPage() {
  await requireAdmin()

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <ContentQualityClient />
    </div>
  )
}
