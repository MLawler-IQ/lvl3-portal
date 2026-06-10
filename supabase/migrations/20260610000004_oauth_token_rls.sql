-- Defense-in-depth for the admin OAuth token tables. They hold plaintext
-- Google/GBP access + refresh tokens and previously had RLS disabled, so any
-- authenticated query could read them. Enable RLS with NO policies → all
-- access via the anon/authenticated key is denied. The app only ever touches
-- these through createServiceClient() (service role bypasses RLS) behind
-- requireAdmin(), so application behavior is unchanged.

alter table public.admin_google_token enable row level security;
alter table public.admin_gbp_token enable row level security;
