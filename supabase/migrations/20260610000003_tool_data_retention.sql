-- Retention for unbounded tool tables. Deletes finished tool_runs and SEO
-- content-engine runs older than 90 days (engine topics cascade via FK).
-- Scheduling uses pg_cron when available; if the extension isn't enabled,
-- the function is still created and can be run manually or scheduled later.

create or replace function public.cleanup_old_tool_data()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tool_runs
   where created_at < now() - interval '90 days'
     and status in ('complete', 'failed', 'partial');

  delete from public.seo_content_engine_runs
   where created_at < now() - interval '90 days';
$$;

-- Maintenance function for pg_cron / service role only — not an API endpoint.
revoke all on function public.cleanup_old_tool_data() from anon, authenticated, public;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'cleanup-old-tool-data',
      '0 3 * * *',
      'select public.cleanup_old_tool_data()'
    );
  end if;
end $$;
