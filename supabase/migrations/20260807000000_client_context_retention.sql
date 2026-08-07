-- Retention for pasted client context.
--
-- The policy, as decided: a transcript is kept 60 days; anything important is
-- kept for the life of the client. "Important" is an explicit human act, not
-- something inferred from `kind` — a strategist marks an item Keep and it stops
-- expiring. Inferring it would mean guessing, and guessing about what to delete
-- is worse than guessing about what to answer.
--
-- What is NOT lost when an item expires: the answers extracted from it. Those
-- live in clients.service_context.answers, each carrying its own quoted evidence
-- string, so the record of what was said and why we believed it survives the
-- purge of the full transcript. Expiry removes the bulk confidential payload and
-- keeps the decision trail. That asymmetry is the reason 60 days is safe.
--
-- Deleting the client still cascades everything immediately, pinned included.

alter table public.client_context_items
  add column if not exists pinned boolean not null default false;

comment on column public.client_context_items.pinned is
  'Marked important by an admin: exempt from the 60-day purge and kept for the life of the client. Cleared by unpinning.';

-- The purge scans by age and skips pinned rows, so index that shape directly.
create index if not exists idx_client_context_items_purge
  on public.client_context_items (created_at)
  where pinned = false;

/**
 * Delete unpinned context older than 60 days.
 *
 * security definer so a scheduled run is not subject to the admin-only RLS
 * policy on the table, matching public.cleanup_old_tool_data.
 */
create or replace function public.cleanup_expired_client_context()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.client_context_items
   where pinned = false
     and created_at < now() - interval '60 days';
$$;

-- Maintenance function for pg_cron / service role only — not an API endpoint.
revoke all on function public.cleanup_expired_client_context() from anon, authenticated, public;

-- Schedule only if pg_cron is present. NOTE: as of this migration it is NOT
-- enabled on this project, which also means public.cleanup_old_tool_data has
-- never actually run since 20260610000003 created it. Enabling the extension is
-- a deliberate decision, not a side effect of this migration, because switching
-- it on makes real deletions start happening.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'cleanup-expired-client-context',
      '0 4 * * *',
      'select public.cleanup_expired_client_context()'
    );
  end if;
end $$;
