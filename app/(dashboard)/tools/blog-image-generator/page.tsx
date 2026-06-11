import { requireAdmin } from '@/lib/auth'
import BlogImageGeneratorClient from './BlogImageGeneratorClient'

export default async function BlogImageGeneratorPage() {
  await requireAdmin()

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6 pb-8">
      <BlogImageGeneratorClient />
    </div>
  )
}
