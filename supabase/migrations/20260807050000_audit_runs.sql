-- Stored audit runs: the record an audit produced, per client.
--
-- Slice 4 of the SEO automation program (AUTOMATION-PLAN.md), narrowed. The plan
-- sketched two tables (`audit_runs` + `audit_findings`); this is one. The findings
-- and the score trace ride in `result` as jsonb because nothing queries across
-- findings yet, and a normalised `audit_findings` table designed before its first
-- query is a schema guess per column. When a screen needs "every client failing
-- ONPAGE-003", that is the migration that adds it — with a known query to shape it.
--
-- WHAT `result` HOLDS, AND WHAT IT DELIBERATELY DOES NOT.
--
-- It holds the whole AuditRunResult MINUS `stations`. The station bundle is the raw
-- substrate — the entire crawled page set and every raw GSC row — and it is already
-- written per station to `tool_runs` by lib/orchestrator/recorder.ts. Copying it here
-- would duplicate the largest payload in the system into a second table for no reader:
-- lib/orchestrator/report-text.ts, which is what renders a stored run, reads
-- stationStatus / coverage / findings / scoring / notes and never touches `stations`.
--
-- `stationStatus` IS stored, in full, for all four slots. That is the honesty-carrying
-- half: it is what says a station was `unconfigured` rather than clean, and dropping it
-- to save bytes would leave a stored run unable to explain its own not_run rows.
--
-- STATUS IS THE RUN'S OWN VERDICT, not a lifecycle. There is no 'running' value because
-- a run is written once, after it finished, by app/actions/audit.ts. A row exists only
-- for a run that completed the pipeline — including one whose crawl station failed,
-- which is stored as 'failed' rather than discarded. A failed run is evidence that an
-- export was unusable, and deleting it is how the same bad export gets uploaded twice.
--
-- RLS: admin-only, `for all`, with BOTH `using` and `with check` — the same form as
-- 20260805222653_client_onboarding.sql. There is deliberately no client read policy.
-- A stored run holds unreviewed automated findings about a client's site; slice 7's
-- review gate is what would make any of it client-facing, and it does not exist yet.
-- All writes go through the service-role client, so RLS here is defence-in-depth.

create table if not exists public.audit_runs (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,

  -- Mirrors AuditRunResult.status exactly (lib/orchestrator/types.ts).
  status         text not null
                   check (status in ('complete', 'partial', 'failed')),

  -- The scoring config this run was scored under, or the literal 'unavailable' when
  -- scoring itself failed. Stored as text rather than a fk so a run recorded under a
  -- config version that was later deleted still says which one it was.
  config_version text not null,

  started_at     timestamptz not null,
  completed_at   timestamptz,
  duration_ms    integer,

  -- AuditRunResult minus `stations`, plus the export attribution described above.
  -- Shape is owned by lib/audit/store.ts (StoredAuditResult) and versioned inside the
  -- document, so a reader that meets an envelope it does not understand can say so
  -- instead of reporting zero findings.
  result         jsonb not null default '{}'::jsonb,

  -- Degradations of the RUN itself. Duplicated out of `result.run.notes` because this
  -- is the column a list view reads, and it also carries the intake notes that describe
  -- the upload rather than the run (duplicate entry names, a context-library write that
  -- failed after the run was already stored).
  notes          text[] not null default '{}'::text[],

  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table public.audit_runs is
  'One completed audit run per row, written by app/actions/audit.ts after runAudit returns. `result` holds AuditRunResult minus the station bundle (that substrate lives in tool_runs). Admin-only: findings here are unreviewed.';

comment on column public.audit_runs.result is
  'StoredAuditResult from lib/audit/store.ts: { version, run: AuditRunResult minus stations, export: attribution }. Versioned in-document so an unknown shape reads as unreadable rather than as zero findings.';

comment on column public.audit_runs.status is
  'The run''s own verdict, mirroring AuditRunResult.status. Not a lifecycle — a row is written once, after the run finished. failed = the crawl station produced nothing, and is stored rather than discarded.';

-- Listing: newest run first, per client. The only query the list view makes.
create index if not exists idx_audit_runs_client_created
  on public.audit_runs (client_id, created_at desc);

alter table public.audit_runs enable row level security;

drop policy if exists admin_all_audit_runs on public.audit_runs;
create policy admin_all_audit_runs on public.audit_runs
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- ---------------------------------------------------------------------------
-- A stored audit run is also a context-library item.
-- ---------------------------------------------------------------------------
--
-- The run row is the record; the library item is a DERIVED READ of it, written second
-- and keyed on the run id (source_ref), so re-storing the same run updates one row
-- rather than appending a second copy under the existing partial unique index.
--
-- `audit_run` joins the three epistemic kinds CONTEXT-LIBRARY.md §5 names: `said`
-- (transcripts, emails, notes), `observed` (measurements) and `derived`. An audit run
-- is `derived` — our own reading of an export, only as good as the export and the
-- rubric behind it. It is NOT testimony and must never be quoted back as though a
-- client said it. It is also not a paraphrase, so it stays out of
-- PARAPHRASE_CONTEXT_ITEM_KINDS: the cap that list applies is about a note-taker model
-- retelling what a person said, which is a different failure from a detector being
-- wrong about a site.
--
-- Idempotent: the constraint is dropped if present and re-added, matching
-- 20260807040000_context_items_meeting_summary.sql, so `supabase db push --include-all`
-- stays safe.

alter table public.client_context_items
  drop constraint if exists client_context_items_kind_check;

alter table public.client_context_items
  add constraint client_context_items_kind_check
    check (kind in ('meeting_transcript', 'meeting_summary', 'email', 'note', 'web_page', 'audit_run'));

comment on column public.client_context_items.kind is
  'What this material is. meeting_transcript = verbatim record of a call; meeting_summary = AI-written paraphrase of a call (weaker evidence, capped at medium confidence by lib/onboarding/extract.ts); email/note/web_page = written by a person or scraped; audit_run = our own derived reading of a crawl export, source_ref = audit_runs.id.';

-- NO BACKFILL. No row can already be an audit_run: nothing wrote one before this
-- migration, because there was no audit_runs table for source_ref to point at.
