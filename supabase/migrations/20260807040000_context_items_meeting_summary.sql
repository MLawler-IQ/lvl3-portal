-- Add a 'meeting_summary' kind to public.client_context_items.
--
-- WHY. A Zoom AI Companion summary is not a transcript. It is third-person prose
-- written by a note-taker model: "The meeting began with introductions, where
-- Matt shared his background." Nobody said those words. Until now the connector
-- had nowhere else to put one, so summaries were stored as 'meeting_transcript'
-- and the extractor was told a machine's retelling was a record of what people
-- said. lib/onboarding/extract.ts already wanted to weigh the two differently —
-- its prompt tells the model a summary is weaker evidence — and it could not,
-- because both arrived under the same label.
--
-- What this does NOT change: a suggestion sourced from a summary still has to
-- quote its item verbatim. The quote is checked against the stored summary text,
-- which is a document like any other and can be copied exactly, so nothing about
-- a summary makes honest quotation hard. A summary changes how much the quote
-- proves, not whether it has to exist — so extract.ts caps a summary-sourced
-- suggestion at 'medium' confidence and leaves the evidence check alone.
--
-- Idempotent: the constraint is dropped if present and re-added, so re-running
-- `supabase db push --include-all` is safe.
--
-- BACKFILL: see the commented block at the bottom. Not run automatically.

alter table public.client_context_items
  drop constraint if exists client_context_items_kind_check;

alter table public.client_context_items
  add constraint client_context_items_kind_check
    check (kind in ('meeting_transcript', 'meeting_summary', 'email', 'note', 'web_page'));

comment on column public.client_context_items.kind is
  'What this material is. meeting_transcript = verbatim record of a call; meeting_summary = AI-written paraphrase of a call (weaker evidence, capped at medium confidence by lib/onboarding/extract.ts); email/note/web_page = written by a person or scraped.';

-- BACKFILL, DELIBERATELY NOT RUN HERE.
--
-- Every row stored before this migration is a 'meeting_transcript', and
-- lib/connectors/zoom.ts (summaryToText) prefixes every AI Companion summary it
-- flattens with the literal marker below. So the rows that are really summaries
-- are identifiable exactly, not heuristically — this is a string the connector
-- writes, not a guess about prose style.
--
-- It is left commented because relabelling stored client material is a data
-- edit, not a schema change, and it should be run by a human who has looked at
-- what it will touch. Check first:
--
--   select id, kind, title, left(body, 80)
--   from public.client_context_items
--   where body like '[AI COMPANION SUMMARY]%';
--
-- Then, if that is the expected set:
--
--   update public.client_context_items
--      set kind = 'meeting_summary'
--    where kind = 'meeting_transcript'
--      and body like '[AI COMPANION SUMMARY]%';
--
-- Rows NOT carrying the marker must be left alone: a real recorded transcript is
-- stronger evidence, and mislabelling one as a summary would silently cap every
-- suggestion drawn from it.

-- APPLIED 2026-08-07, together with the backfill below.
--
-- Both rows that existed were AI Companion summaries stored as
-- meeting_transcript, including a 4,187-character one that looked like a real
-- transcript until its opening line was read. The marker is the literal string
-- lib/connectors/zoom.ts summaryToText writes, so this matched on something we
-- emit rather than on a guess about the prose. Rows without it were left alone:
-- calling a real transcript a summary would silently cap every suggestion drawn
-- from it, which is the same error in the other direction.
--
--   update public.client_context_items
--      set kind = 'meeting_summary'
--    where kind = 'meeting_transcript'
--      and body like '[AI COMPANION SUMMARY]%';
--
-- Result: 2 rows updated, 0 left mislabelled.
