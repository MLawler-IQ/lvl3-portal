import { createServiceClient } from '@/lib/supabase/server'

/**
 * Cross-request cache for slow third-party API reads (GA4 / GSC), backed by the
 * api_cache Postgres table. Returns the cached payload when fresh, otherwise
 * runs the fetcher and stores the result with a TTL. Cache read/write failures
 * never block the fetcher — they just fall through to a live fetch.
 *
 * Do NOT wrap callers of this in unstable_cache: createServiceClient reads cookies.
 */
export async function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const service = await createServiceClient()

  try {
    const { data: row } = await service
      .from('api_cache')
      .select('payload, expires_at')
      .eq('key', key)
      .maybeSingle()
    if (row && new Date((row as { expires_at: string }).expires_at).getTime() > Date.now()) {
      return (row as { payload: T }).payload
    }
  } catch {
    /* cache read failed — fall through to fetcher */
  }

  const fresh = await fetcher()

  try {
    await service.from('api_cache').upsert({
      key,
      payload: fresh as unknown as Record<string, unknown>,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    })
  } catch {
    /* cache write failed — return fresh anyway */
  }

  return fresh
}
