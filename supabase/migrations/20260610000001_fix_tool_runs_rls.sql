-- Fix tool_runs member SELECT policy.
--
-- The previous "Members can view own and client runs" policy had two flaws:
--   1. `user_id = auth.uid()` let a member read ANY run they triggered, even
--      for a client they aren't assigned to (cross-client leak).
--   2. `users.client_id = tool_runs.client_id` never matches members, whose
--      client_id is null (they're scoped via user_client_access), so it both
--      leaked and under-granted.
--
-- New policy: a user may read a run if it is an unscoped run they created
-- (client_id is null — e.g. URL audits), OR it belongs to a client they can
-- access (client-role pinned client, or member via user_client_access).
-- Admins keep their existing "Admins can view all tool runs" policy.

drop policy if exists "Members can view own and client runs" on public.tool_runs;

create policy "Users can view runs for accessible clients"
  on public.tool_runs for select
  to authenticated
  using (
    (tool_runs.client_id is null and tool_runs.user_id = auth.uid())
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'client'
        and u.client_id = tool_runs.client_id
    )
    or exists (
      select 1 from public.user_client_access uca
      where uca.user_id = auth.uid()
        and uca.client_id = tool_runs.client_id
    )
  );
