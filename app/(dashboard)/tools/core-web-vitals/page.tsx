import { requireAdmin } from '@/lib/auth'
import CoreWebVitalsClient from './CoreWebVitalsClient'

export default async function CoreWebVitalsPage() {
  await requireAdmin()

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <CoreWebVitalsClient />
    </div>
  )
}
