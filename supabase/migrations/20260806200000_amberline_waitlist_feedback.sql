-- Waitlist research fields, added for the pre-launch site rewrite.
-- The pre-launch form asks which testing models a visitor wants and an
-- open-ended note; both are optional, so both columns are nullable.
--
-- NOTE: this table lives in the *amberline* Supabase project
-- (nkxfkvssdkdaxmiwvqlu), not the lvl3-portal project. It is recorded here
-- only so the schema stays version-controlled alongside everything else.

alter table public.amberline_waitlist
  add column if not exists interests text[],
  add column if not exists feedback  text;

comment on column public.amberline_waitlist.interests is
  'Testing models the visitor selected. Validated server-side against an allowlist.';
comment on column public.amberline_waitlist.feedback is
  'Free-text answer to "what are you looking for in a testing provider?" Capped at 2000 chars.';
