import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — can be ignored if
            // middleware is refreshing sessions
          }
        },
      },
    }
  )
}

export async function createServiceClient() {
  // Service-role client for admin/server-side operations that must bypass RLS.
  //
  // IMPORTANT: do NOT build this on @supabase/ssr's createServerClient wired to
  // the request cookies. supabase-js derives the PostgREST Authorization header
  // from the auth session, so when a user is logged in it sends that user's
  // `authenticated` JWT instead of the service-role key — silently running as
  // `authenticated` and failing to bypass RLS (e.g. the deny-all policies on
  // admin_google_token / admin_gbp_token, which made the Google connect upsert
  // fail with "new row violates row-level security policy"). Using the base
  // client with the service-role key and no session guarantees `service_role`,
  // which has bypassrls.
  //
  // The custom fetch opts every PostgREST request out of Next's Data Cache:
  // without it, GET reads on force-dynamic pages/route handlers are served
  // from the first render's cached response (observed: review page never
  // seeing new review_responses rows).
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    }
  )
}
