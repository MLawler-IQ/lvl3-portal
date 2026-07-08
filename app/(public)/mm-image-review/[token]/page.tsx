import { getReviewBundle } from '@/lib/review/queries'
import { TOKEN_RE } from '@/lib/review/schemas'
import { createServiceClient } from '@/lib/supabase/server'
import { InvalidLink } from './invalid-link'
import { ReviewClient } from './review-client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!TOKEN_RE.test(token)) return <InvalidLink />

  const service = await createServiceClient()
  const bundle = await getReviewBundle(service, token)
  if (!bundle || bundle.batch.status === 'archived') return <InvalidLink />

  const { id, client, title, status, submitted_at } = bundle.batch
  return (
    <ReviewClient
      token={token}
      batch={{ id, client, title, status, submitted_at }}
      items={bundle.items}
      initialResponses={bundle.responses}
      readOnly={bundle.batch.status === 'submitted'}
    />
  )
}
