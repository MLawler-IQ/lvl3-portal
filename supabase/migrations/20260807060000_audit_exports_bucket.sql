-- A private bucket for uploaded Sitebulb exports, so the export's bytes stop travelling
-- inside a request body.
--
-- WHAT THIS FIXES. app/api/audit/run/route.ts carried the whole export as
-- multipart/form-data. That solved a real corruption bug (a Uint8Array does not survive a
-- Server Action boundary) but inherited a hard platform ceiling: a Vercel Serverless
-- Function refuses any request body over 4.5 MB with FUNCTION_PAYLOAD_TOO_LARGE BEFORE the
-- handler runs, and no config raises it. A real Sitebulb crawl exports tens of megabytes,
-- so /tools/audit worked on a toy export and refused a real one. The browser now uploads
-- each file straight here with a signed upload URL and the run request carries only ids.
--
-- WHAT IS IN HERE. A client's crawled site data: every URL on their site, every title,
-- meta description, word count and hint hit that Sitebulb recorded. It is not aggregate and
-- it is not anonymous — an object under this prefix is a map of one client's website. Hence
-- private, admin-only, and no client-facing read policy anywhere below.
--
-- ---------------------------------------------------------------------------
-- RETENTION: THE EXPORT IS KEPT. Nothing in the run path deletes it.
-- ---------------------------------------------------------------------------
--
-- This is a decision, not an omission, and it is the opposite of what "clean up after
-- yourself" suggests. Three reasons, in order of weight:
--
-- 1. A STORED RUN IS A DERIVED FACT, AND ITS SOURCE HAS TO STILL EXIST. docs/CONTEXT-LIBRARY.md
--    §5 makes provenance the point of the library: a fact points at an artifact that still
--    exists, and re-running a better extractor over stored artifacts improves every client
--    retroactively. An audit run is exactly that shape — `kind: 'audit_run'` is `derived`,
--    our rubric's opinion of one crawl on one day — and the rubric is known-incomplete and
--    changes slice by slice (LOCAL-016 is not even built, and §3 says its current design
--    would fabricate a pass). Deleting the export makes every past run permanently
--    un-reproducible: a claim about a crawl nobody can look at again.
--
-- 2. tool_runs IS NOT A COPY OF IT. lib/orchestrator/recorder.ts writes the station
--    substrate — the PARSED page set and the GSC rows — to tool_runs, which is why
--    audit_runs.result deliberately omits `stations`. But that substrate is what the
--    CURRENT ingester chose to read. Sitebulb writes reports no registered check consumes
--    yet; those columns exist only in the export. tool_runs is also on a 365-day purge
--    (cleanup_old_tool_data, 20260807020000), so treating it as the archive of record means
--    the archive deletes itself on a schedule set for a different purpose.
--
-- 3. DELETE-ON-SUCCESS IS INVERTED. The run whose bytes anyone actually wants to re-read is
--    the one that failed or came back mostly `not_run`. A rule that deletes after a clean
--    run and keeps the rest keeps precisely the exports nobody needs.
--
-- THE COST, STATED. This bucket only grows. There is no expiry job, and a run whose upload
-- failed halfway leaves orphaned objects under a run id nothing will ever read. That is
-- accepted for now for the same reason 20260807020000 widened tool-data retention to 365
-- days rather than letting a never-fired 90-day rule delete four months in one pass:
-- retention that starts by destroying history is a purge wearing a policy's clothes. When
-- volume justifies an expiry, it is its own migration, made with the deletion in view, and
-- it MUST also decide what happens to the audit_runs rows whose source it is removing —
-- silently orphaning them recreates the exact problem reason 1 exists to avoid.

-- `do update` rather than `do nothing`: this file is the authority on the bucket's
-- settings, and `do nothing` would let a bucket created by hand (or by an earlier draft of
-- this migration) keep a stale `public` flag forever while every re-push reported success.
-- Re-asserting `public = false` on each push is the point.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audit-exports',
  'audit-exports',
  false,       -- private. Reads go through the service-role client after an admin check.
  104857600,   -- 100 MB per FILE, not per export. The backbone *_internal.csv of a large
               -- crawl is the only file that approaches this; the rest are tens of KB.
  null         -- NO MIME ALLOWLIST, deliberately. The ingester identifies a report by its
               -- filename suffix and its bytes, never by a Content-Type the browser
               -- guessed from a file extension — and a directory pick yields an empty type
               -- or application/octet-stream on several browsers. An allowlist here would
               -- refuse a valid CSV mid-upload with an opaque storage 400, which reads to
               -- the operator as "the audit is broken".
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No `comment on` anywhere in this file: storage.buckets and storage.objects are owned by
-- supabase_storage_admin, and a COMMENT requires ownership, so the statement would abort a
-- push that every other statement here survives. The description of what this bucket holds
-- lives in this header instead, which is where a reader looks anyway.

-- ---------------------------------------------------------------------------
-- RLS on storage.objects
-- ---------------------------------------------------------------------------
--
-- Same form as 20260408000001 (chat-artifacts) and 20260220000001 (client-assets):
-- `for all` to authenticated, with BOTH `using` and `with check`, keyed on
-- public.get_my_role(). Deliberately WITHOUT the `authenticated_view` companion those two
-- carry — there is no reader of an export other than the audit, and a `member`-role user
-- has no business holding a client's full URL inventory.
--
-- WHAT THIS POLICY DOES AND DOES NOT AUTHORIZE. The browser's upload is authorized by the
-- signed upload URL, not by this policy: app/actions/audit-upload.ts mints it with the
-- service-role client after requireAdmin(), and the signature is scoped to one exact object
-- key. The server's read-back is the service-role client, which bypasses RLS entirely. So
-- this policy governs the third case — anything that reaches the bucket carrying a user's
-- own JWT — and is defence-in-depth rather than the primary gate. It is still worth having:
-- it is what makes "a client user got a session token" not also mean "a client user can
-- enumerate every export we hold".
drop policy if exists admins_manage_audit_exports on storage.objects;
create policy admins_manage_audit_exports on storage.objects
  for all to authenticated
  using (bucket_id = 'audit-exports' and public.get_my_role() = 'admin')
  with check (bucket_id = 'audit-exports' and public.get_my_role() = 'admin');
