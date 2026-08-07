-- Pasted client context: the raw material the onboarding extractor reads.
--
-- Phase 1 of the SEO automation program, second intake path. A strategist pastes
-- a meeting transcript, an email thread, a note or a scraped page; a model reads
-- it and proposes slot values with source 'context'. Those NEVER count as
-- answered (lib/onboarding/schema.ts isFilled) — a human confirms each one in the
-- review pane before it becomes an answer. So this table holds evidence, not
-- truth, and nothing here can reach clients.* without an admin approving it.
--
-- CONFIDENTIALITY. These rows will hold client-confidential material verbatim:
-- meeting transcripts, email bodies, revenue figures said out loud on a call.
-- That is a materially more sensitive payload than anything else in this schema,
-- which mostly holds ids and metrics. Admin-only RLS is therefore the FLOOR, not
-- the answer:
--   - There is deliberately no client read policy. A client must not be able to
--     read what was said about them internally.
--   - Retention and deletion are UNDECIDED and still owed. Today a row lives
--     until its client row is deleted (on delete cascade). Before this is used at
--     Apex scale someone has to decide how long a transcript is kept, whether it
--     is purged after extraction, and what a client deletion request means for
--     material that also exists in Granola/Gmail. Flagging it here rather than
--     inventing a policy in a migration.
--
-- Written via the service-role client, like the rest of onboarding, so RLS here
-- is defence-in-depth.

create table if not exists public.client_context_items (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,

  kind       text not null
               check (kind in ('meeting_transcript', 'email', 'note', 'web_page')),

  -- Where this came from upstream: a Granola meeting URL, an RFC822 message id,
  -- a page URL. Null for a hand-typed note, which has no upstream identity.
  source_ref text,

  -- When the underlying thing happened (the meeting date, the email date), which
  -- is not when it was pasted. Nullable because a pasted note often has neither.
  occurred_at timestamptz,

  title      text,
  body       text not null,
  added_by   uuid references public.users(id),
  created_at timestamptz not null default now()
);

comment on table public.client_context_items is
  'Raw pasted/ingested client context (transcripts, emails, notes, pages) read by lib/onboarding/extract.ts. Holds client-confidential material verbatim; admin-only RLS. Retention/deletion policy still to be decided.';

comment on column public.client_context_items.source_ref is
  'Upstream identity of this item (Granola URL, email message id, page URL). Null for hand-typed notes.';

-- Idempotency key for the connectors that come next (Granola, Gmail). A
-- connector re-running over the same meeting must update or skip, not append a
-- second copy — duplicate transcripts would let the extractor "corroborate" a
-- value against what is really one source, which reads as stronger evidence than
-- it is. Partial so that hand-typed notes, which legitimately have no upstream
-- id, are not forced into a single null row per client.
create unique index if not exists uq_client_context_items_source_ref
  on public.client_context_items (client_id, source_ref)
  where source_ref is not null;

-- Listing: newest context first, per client.
create index if not exists idx_client_context_items_client_created
  on public.client_context_items (client_id, created_at desc);

alter table public.client_context_items enable row level security;

drop policy if exists admin_all_client_context_items on public.client_context_items;
create policy admin_all_client_context_items on public.client_context_items
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
