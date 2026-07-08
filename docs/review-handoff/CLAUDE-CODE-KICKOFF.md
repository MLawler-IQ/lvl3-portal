# Paste this to Claude Code to start the build

Run from the root of the `lvl3-portal` repo with this bundle's files available (drop `BUILD-SPEC.md`, `supabase-migration.sql`, `review-seed.json`, `prototype-reference.html`, and `images/` somewhere in the repo, e.g. `docs/review-handoff/`).

---

**Prompt:**

You're adding a client-facing **image review** feature to this portal (Next.js 14 App Router, TypeScript, Tailwind, Supabase, Vercel).

Read these first, in order:
1. `docs/review-handoff/BUILD-SPEC.md` — full spec. Follow it.
2. `docs/review-handoff/prototype-reference.html` — the approved UX and visual design. The built reviewer page must match this layout and interactions.
3. `docs/review-handoff/supabase-migration.sql` — the schema + RLS to apply.
4. `docs/review-handoff/review-seed.json` + `images/` — seed content for the first batch.

Constraints:
- Reviewer page `/review/[token]` is **public, no auth** — token in the URL is the credential, validated **server-side** with the service role. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.
- Reviewer page uses **IgniteIQ v4.2 branding (light theme)**, not the portal's LVL3 dark theme. `@font-face` the real Aeonik + Aeonik Fono from `~/Desktop/igniteiq-theme-v2/exports/latest/fonts/` and use the real logo from `.../assets/logo-black.png`. Honor: one red accent, no gradients, no card shadows, 10px card / 6px button radii, two-tone headlines, mono red eyebrows.
- Per item: 1–10 star rating, Approve (black) / Deny (red), notes required on Deny (enforce client **and** server — the DB has a `deny_requires_note` check). Autosave every change; no data loss on refresh. Submit validates, sets `status='submitted'`, and emails `REVIEW_NOTIFY_EMAIL` the per-item rating/decision/note breakdown.
- Admin (behind existing portal auth): create batch, upload images to a `review-images` Storage bucket, generate the share link, view + CSV-export responses.

Do this in the milestone order in §12 of the spec. Start by (a) applying the migration and generating Supabase types, (b) building the read-only `/review/[token]` page that matches the prototype with real Aeonik/logo, then (c) autosave, (d) submit + notify, (e) admin. After each milestone, run the app and verify against §13 acceptance criteria. Ask me before introducing any new dependency beyond what's already in package.json + an email provider (Resend is fine).

When ready, seed the MantelMount batch from `review-seed.json` (upload the 23 images, create the items) and give me the share link to test end to end.
