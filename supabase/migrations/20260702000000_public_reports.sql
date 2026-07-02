-- Public, login-free client reports served from the DB so chat can update them.
-- Full revision history is kept — every update snapshots the prior version.

create table public_reports (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  html text not null,
  content_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table report_revisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public_reports(id) on delete cascade,
  html text not null,
  content_text text not null default '',
  note text,
  created_at timestamptz not null default now()
);

create index report_revisions_report_id_idx on report_revisions (report_id, created_at desc);

-- Service-role access only (no policies): the public API routes go through
-- createServiceClient(), and nothing here should be readable via the anon key.
alter table public_reports enable row level security;
alter table report_revisions enable row level security;
