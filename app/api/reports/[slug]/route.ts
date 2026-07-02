import { createServiceClient } from '@/lib/supabase/server'
import { isPublicReportSlug } from '@/lib/public-reports'

// Public, login-free report HTML served from the DB so chat updates are live.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  if (!isPublicReportSlug(slug)) {
    return new Response('Not found', { status: 404 })
  }

  const service = await createServiceClient()
  const { data } = await service
    .from('public_reports')
    .select('html')
    .eq('slug', slug)
    .single()

  if (!data) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(data.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
