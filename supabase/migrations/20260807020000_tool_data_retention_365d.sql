-- Widen tool-data retention from 90 days to 365, before scheduling ever runs.
--
-- 20260610000003 created cleanup_old_tool_data with a 90-day window and tried to
-- schedule it, but the schedule was conditional on pg_cron being present and it
-- was not. The function has therefore never run once. Data kept accumulating
-- against a limit nothing enforced.
--
-- That makes enabling pg_cron a destructive act rather than a maintenance one:
-- the first scheduled run would not trim one day's worth, it would apply four
-- months of deferred deletion in a single pass — 19 of 22 content-engine runs and
-- 110 of 157 topics, everything before 2026-04-08.
--
-- 90 days was never a decision tested against real data; it was a default that
-- never fired. 365 is chosen so that switching the scheduler on deletes NOTHING
-- today (verified: 0 rows match at 365 days, oldest data is 2026-04-02) and the
-- policy begins governing from here forward. Retention that starts by destroying
-- history is not retention, it is a one-off purge wearing a policy's clothes.
--
-- Narrow this later if the volume warrants it — but then it is a decision made
-- with the deletion in view, which is the only way it should be made.

create or replace function public.cleanup_old_tool_data()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tool_runs
   where created_at < now() - interval '365 days'
     and status in ('complete', 'failed', 'partial');

  delete from public.seo_content_engine_runs
   where created_at < now() - interval '365 days';
$$;

revoke all on function public.cleanup_old_tool_data() from anon, authenticated, public;
