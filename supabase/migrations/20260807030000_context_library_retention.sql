-- Context is kept for the life of the client. Reverses the 60-day purge.
--
-- 20260807000000 set a 60-day expiry on unpinned context, and justified it as
-- safe because "the answers extracted from it live in
-- clients.service_context.answers" — that is, the extracted projection is
-- durable and the raw material is disposable.
--
-- That premise is now inverted. The library is authoritative and facts are a
-- derived view over it, for three reasons documented in docs/CONTEXT-LIBRARY.md:
-- the extractor is known to be miscalibrated for transcripts and will be re-run,
-- a fact's provenance has to point at something that still exists, and the
-- library is meant to serve tools and Ask LVL3 over a year-long engagement
-- rather than one onboarding interview.
--
-- Under the old rule, day 61 would delete a transcript while leaving every fact
-- derived from it in place, still claiming "from the kickoff call". That is not
-- data loss, it is a fact whose justification silently stops existing. Auto-
-- import would have made it routine: every call starting a 60-day timer nobody
-- was watching.
--
-- Deletion does not go away — it moves from a timer to a decision. An admin can
-- delete any item immediately (deleteContextItem in app/actions/onboarding.ts),
-- which is the honest answer to a client asking for removal, and everything
-- still cascades when the client row is deleted. What is removed is the
-- automatic, unattended deletion of material nobody chose to lose.
--
-- Reversal cost was zero: pg_cron is not installed, so the purge never ran once.

drop function if exists public.cleanup_expired_client_context();

drop index if exists public.idx_client_context_items_purge;

-- `pinned` survives with a new job. It no longer exempts a row from anything —
-- nothing expires — so it becomes what it was really being used for: marking the
-- items that matter most, to rank them ahead of the rest at retrieval time.
comment on column public.client_context_items.pinned is
  'Marked as high-signal by an admin. Retrieval and summarisation prefer pinned items. No longer affects retention: context is kept for the life of the client and removed only by explicit deletion.';

comment on table public.client_context_items is
  'Durable client context library — transcripts, emails, notes, pages. Append-only and authoritative; extracted facts are a derived view over it, so rows are kept for the life of the client and deleted only deliberately. Holds client-confidential material verbatim; admin-only RLS. See docs/CONTEXT-LIBRARY.md.';
