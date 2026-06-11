import { requireAdmin } from '@/lib/auth'
import PageSeoClient from './PageSeoClient'

export default async function PageSeoAuditPage() {
  await requireAdmin()

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <PageSeoClient />
    </div>
  )
}
