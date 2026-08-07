-- Archiving for clients.
--
-- Deleting a client is destructive in a way the schema makes easy to
-- underestimate: nine tables cascade off clients.id — deliverables, tool_runs,
-- semrush_reports, seo_content_engine_runs, ask_lvl3_conversations,
-- client_annotations, client_context_items, client_onboarding_sessions,
-- user_client_access — and none of it comes back. Storage does not cascade at
-- all, so files outlive the row entirely unless something deletes them.
--
-- So archiving is the everyday action and deletion is the exception. An archived
-- client disappears from every list, picker and report, but the row and its
-- history are untouched and restoring is one click. Deletion stays available for
-- a genuine removal request, gated behind typing the client's name.
--
-- Deliberately a nullable timestamp rather than a boolean: "when" is strictly
-- more information than "whether", and the pair with archived_by answers who
-- did it — which is the first question anyone asks about a client that vanished.

alter table public.clients
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id);

comment on column public.clients.archived_at is
  'When this client was archived. Null means active. Archived clients are hidden from every list, picker and report but are fully restorable; see archiveClient/restoreClient in app/actions/clients.ts.';

comment on column public.clients.archived_by is
  'Admin who archived this client.';

-- Every list query filters on `archived_at is null`, so index exactly that
-- predicate rather than the whole column.
create index if not exists idx_clients_active
  on public.clients (name)
  where archived_at is null;
