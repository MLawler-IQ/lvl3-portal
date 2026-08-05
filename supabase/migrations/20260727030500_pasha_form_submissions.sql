-- Pasha Health public-site form submissions (assessment quiz, contact form).
-- Written by the static site at pasha-site-v4 via PostgREST with the anon key.
-- Insert-only for anon; read/manage via service role only.

create table if not exists public.pasha_form_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  form_type text not null check (form_type in ('assessment', 'contact', 'callback')),
  name text,
  phone text,
  email text,
  notes text,
  payload jsonb,
  source_page text,
  user_agent text
);

alter table public.pasha_form_submissions enable row level security;

drop policy if exists "pasha_anon_insert" on public.pasha_form_submissions;
create policy "pasha_anon_insert"
  on public.pasha_form_submissions
  for insert
  to anon
  with check (true);
