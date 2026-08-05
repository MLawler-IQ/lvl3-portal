-- Amberline (peptide lab) public-site waitlist signups.
--
-- NOTE: this table lives in its own Supabase project (`amberline-site`,
-- ref nkxfkvssdkdaxmiwvqlu), NOT in the lvl3-portal project. The file is kept
-- here only so the schema stays in version control alongside the others.
--
-- Written by the Next.js route handler at peptide-lab-site (app/api/waitlist).
-- The route uses the anon key and keeps it server-side only (no NEXT_PUBLIC_
-- prefix), so it never reaches the browser.
--
-- RLS is insert-only for anon: signups can be written but never read back, so
-- the email list cannot be enumerated even if the key is exposed. Reading
-- requires the service-role key.

create table if not exists public.amberline_waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  source text,
  user_agent text,
  referer text
);

-- The route lowercases before insert, so a plain unique constraint is enough
-- to make duplicate signups a no-op (surfaced as SQLSTATE 23505).
create unique index if not exists amberline_waitlist_email_key
  on public.amberline_waitlist (email);

create index if not exists amberline_waitlist_created_at_idx
  on public.amberline_waitlist (created_at desc);

alter table public.amberline_waitlist enable row level security;

-- Insert-only for anon. There is deliberately no select/update/delete policy,
-- so the signup list cannot be read or modified with this key.
drop policy if exists "amberline_anon_insert" on public.amberline_waitlist;
create policy "amberline_anon_insert"
  on public.amberline_waitlist
  for insert
  to anon
  with check (true);
