-- Cross-request cache for slow third-party API reads (GA4 / GSC). TTL-based;
-- analytics data is ~24h stale anyway, so short TTLs cut repeat API calls and
-- the 2–3s route-transition latency without serving meaningfully stale data.

create table if not exists public.api_cache (
  key        text        primary key,
  payload    jsonb       not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_cache_expires on public.api_cache (expires_at);

-- Accessed only via the service client (server-side). RLS on with no policies
-- denies anon/authenticated reads.
alter table public.api_cache enable row level security;
