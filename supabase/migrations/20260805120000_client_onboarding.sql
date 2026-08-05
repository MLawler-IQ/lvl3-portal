-- Conversational onboarding: session + transcript, and the approved context column.
--
-- Phase 1 of the SEO automation program. An admin (strategist) runs an
-- LLM-driven interview with a client; the portal captures the answers as
-- structured context that grounds every downstream LLM call in the pipeline.
--
-- Written exclusively by the route handler at app/api/onboarding/route.ts and
-- the server actions in app/actions/onboarding.ts, both via the service-role
-- client. Nothing here is client-facing.
--
-- The draft gate (CLAUDE.md convention #12): the model writes ONLY to
-- client_onboarding_sessions.answers. Those values reach clients.* — including
-- live pipeline config like ga4_property_id — only when an admin reviews an
-- editable, pre-filled form and calls approveOnboardingSession. So an
-- extraction error can never silently repoint a client's analytics.
--
-- RLS is admin-only for-all with both `using` and `with check` (the
-- review_batches form, not the client_annotations form which omits the check on
-- a writable table). There is deliberately no client read or write policy:
-- onboarding is an internal surface. All app access uses the service-role key,
-- so RLS here is defence-in-depth.

create table if not exists public.client_onboarding_sessions (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  status      text not null default 'in_progress'
                check (status in ('in_progress', 'ready_for_review', 'approved', 'abandoned')),

  -- The draft. Shape is owned by the zod schema in lib/onboarding/schema.ts and
  -- stays jsonb on purpose: the pipeline (phases 2-5) has not yet told us which
  -- fields need to be queryable, and guessing would mean a migration per guess.
  answers     jsonb not null default '{}'::jsonb,

  -- Which admin ran the interview. ask_lvl3_conversations has no equivalent
  -- column, so every admin sees every other admin's threads there; this table
  -- deliberately does not inherit that.
  started_by  uuid references public.users(id) on delete set null,

  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.client_onboarding_sessions.answers is
  'Unapproved LLM-extracted onboarding answers pending admin review. Slot map keyed by SLOTS[].id from lib/onboarding/schema.ts; each value is { value, unknown, reason, recordedAt }. Promoted to clients.* and clients.service_context only by approveOnboardingSession.';

comment on column public.client_onboarding_sessions.status is
  'in_progress -> ready_for_review (set by computeCompleteness, never by the model) -> approved. abandoned is manual.';

-- Transcript. Mirrors ask_lvl3_messages so the streaming route and the
-- client-side reader can be forked without reshaping persistence.
create table if not exists public.client_onboarding_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.client_onboarding_sessions(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_sessions_client_updated
  on public.client_onboarding_sessions (client_id, updated_at desc);

create index if not exists idx_onboarding_messages_session_created
  on public.client_onboarding_messages (session_id, created_at);

-- The approved, promoted context. Additive and nullable so every existing read
-- path is unaffected.
--
-- Deliberately NOT brand_context: that column is plain text holding a ~2.6KB
-- prose voice brief, and six content-generation paths read it as an opaque
-- string (seo-content-engine, content-refresh-finder, recommendations).
-- Overloading it would break content generation.
alter table public.clients
  add column if not exists service_context jsonb;

comment on column public.clients.service_context is
  'Approved structured onboarding context: services and average job value, real service radius, seasonality, lead handling, prior vendor work, brand constraints, approval authority, CMS/hosting. Grounds pipeline LLM calls. Distinct from brand_context, which stays prose for the content engine.';

alter table public.client_onboarding_sessions enable row level security;
alter table public.client_onboarding_messages enable row level security;

drop policy if exists admin_all_onboarding_sessions on public.client_onboarding_sessions;
create policy admin_all_onboarding_sessions on public.client_onboarding_sessions
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

drop policy if exists admin_all_onboarding_messages on public.client_onboarding_messages;
create policy admin_all_onboarding_messages on public.client_onboarding_messages
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
