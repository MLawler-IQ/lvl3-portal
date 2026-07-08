# Client Image Review — Build Spec (for Claude Code)

## 1. What this is
A client-facing **image + copy review tool** inside the LVL3 portal (Next.js 14 / TS / Supabase / Tailwind, deployed on Vercel). A client contact (e.g. Spencer at MantelMount) opens **one magic link — no login**, and for each blog post sees the hero image next to its copy. For each item they: give a **1–10 star rating**, click **Approve** or **Deny**, and leave **notes** (required if Deny). Responses **autosave** to Supabase; on submit, the account owner (Matt) is notified and sees all decisions in an admin view.

This replaces the standalone prototype (`prototype-reference.html`), which has the exact UX/branding to match but no persistence and uses `mailto`. **The prototype is the visual + interaction source of truth. Match it, then add the backend.**

## 2. Goal / why
Client feedback loops have been slow and lossy (missed email threads). This makes review a 30-second, no-login, mobile-friendly task, and captures structured results (rating + decision + note per image) the team can act on — including "barely approved / barely denied" via the rating.

## 3. Scope
### In scope (v1)
- Reviewer page at `/review/[token]` — no auth, token-gated.
- Per-item: 1–10 star rating, Approve/Deny, notes (required on Deny). Autosave.
- Submit action → lock (optional) + notify owner.
- Admin: create a review batch (title + client + items with image upload + copy), generate the shareable link, and view/export responses.
- IgniteIQ v4.2 branding on the reviewer page (light theme — see §7). Portal chrome/admin can stay in the portal's existing LVL3 styling.

### Out of scope (v1)
- Threaded comments / pin-to-image annotations.
- Multiple simultaneous reviewers with conflict resolution (schema supports multiple reviewers, but UI targets one guest reviewer per link).
- Auto-publishing approved images to Shopify (future; keep `shopify_handle` on items so it's easy later).

## 4. Stack & repo
- Repo: `lvl3-portal` (existing). App Router, TypeScript, Tailwind, Supabase (`@supabase/supabase-js` + SSR helpers), Recharts already present.
- Add routes under `app/(review)/review/[token]/` (public) and admin under the existing authed dashboard, e.g. `app/(dashboard)/reviews/`.
- Email: use whatever the portal already uses; if none, Resend. Optional Slack webhook.

## 5. Data model (Supabase / Postgres)
See `supabase-migration.sql` for the full DDL + RLS. Summary:

- **review_batches** — `id uuid pk`, `client text`, `title text`, `token text unique` (random, unguessable), `status text` (`draft|open|submitted|archived`), `created_by uuid`, `created_at`, `submitted_at`.
- **review_items** — `id uuid pk`, `batch_id fk`, `sort_order int`, `title text`, `copy text`, `image_url text`, `shopify_handle text null`.
- **review_responses** — `id uuid pk`, `batch_id fk`, `item_id fk`, `reviewer_name text null`, `rating int check 1..10 null`, `decision text check (approve|deny) null`, `note text null`, `updated_at`. Unique on `(item_id, reviewer_name)` (one row per reviewer per item; single-guest link uses a constant reviewer key).

## 6. Access model
- **Reviewer (guest):** the `[token]` in the URL is the credential. A Postgres RPC / route handler using the **service role** (server-side only) looks up the batch by token and returns items + existing responses. Writes (`upsertResponse`, `submitBatch`) are also server-side, scoped to that token. **Never expose the service key client-side.** Client calls your own route handlers/server actions, which validate the token.
- **Owner (admin):** behind existing portal Supabase auth (`role = admin`, matching the portal's current pattern). Full CRUD on batches/items, read all responses.
- RLS: deny-all by default; all guest access flows through server-side token validation (service role bypasses RLS in route handlers). Admin policies via authed role. Details in the SQL file.

## 7. Branding — IgniteIQ v4.2 (reviewer page)
The reviewer page must render in IgniteIQ's light system (NOT the portal's LVL3 dark). Tokens (from `IgniteIQ_Brand_Guidelines_v4.2` / `exports/latest/css/tokens.css` — prefer the real token file if available in `~/Desktop/igniteiq-theme-v2/exports/latest/`):

```
--canvas:#FAFAFA;  --surface:#FFFFFF;  --sunken:#F4F4F5;
--border:#E4E4E7;  --border-strong:#D4D4D8;
--ink-1000:#0A0A0A (primary text/CTA-band);  --ink-600:#52525B (body);  --ink-500:#71717A (tertiary/reflective);
--ignite-500:#EF4444 (accent/CTA/eyebrow; the doc's statement red rgb(239,68,68));
```
Rules to honor: one accent (red) only; solid colors, **no gradients**; **no drop shadows on cards** (shadow only on the primary red CTA); card radius **10px**, button radius **6px**; declarative-period section titles; **two-tone headlines** (primary clause `--ink-1000` + reflective clause `--ink-500`); **eyebrow** = mono, 11px, 0.18em, uppercase, red.

**Fonts (do this properly — prototype used Inter as a placeholder):** `@font-face` the real **Aeonik** (display/sans/wordmark) and **Aeonik Fono** (eyebrows/mono labels) from `exports/latest/fonts/` (Aeonik-Regular/Medium/Bold, AeonikFono-Medium). Font stack: `'Aeonik', system-ui, sans-serif` and `'Aeonik Fono', ui-monospace, monospace`. The guide is explicit: Aeonik or nothing.

**Logo:** replace the prototype's placeholder SVG mark with the real `assets/logo-black.png` (Q mark) + live "IgniteIQ" wordmark set in Aeonik 600, −0.02em (never as an image).

## 8. UI / interaction spec (match prototype exactly)
Per card (see `prototype-reference.html`):
- Image (left / stacked on mobile ≤720px) with a status pill overlay (`Pending` → `Approved`/`Denied`).
- Title, short copy, a "View full copy" link (wire to the post's Google Doc / CMS URL — add a `copy_url` field if needed).
- **Rating:** 10 clickable stars, hover preview, shows `N / 10`. Persists.
- Divider + padding, then **Approve** (black bg, white bold when selected) and **Deny** (ignite red when selected). Selecting toggles; card border reflects state (black = approved, red = denied).
- **Notes:** bordered panel (prominent). Label shows "(required)" in red when Deny is selected; box highlights red until filled.
- Header: live progress counts (approved / denied / pending). Sticky footer: **Copy summary** + **Submit / Send**.

### Behavior changes vs prototype (because it's now backed by a DB)
- **Autosave** every rating/decision/note change (debounce ~500ms) via `upsertResponse`. No data loss on refresh — replaces the `mailto` dependency.
- **Submit** validates: every Denied item must have a note (server-enforced too). On success set `batch.status='submitted'`, stamp `submitted_at`, notify owner. Keep a "Copy summary" fallback.
- Owner notification email contains the per-item rating/decision/note table (same format as prototype's `buildText()`), plus a link to the admin view.

## 9. Server actions / route handlers (suggested)
- `GET  /api/review/[token]` → `{batch, items[], responses[]}` (service role, token-scoped).
- `POST /api/review/[token]/response` → upsert `{item_id, rating?, decision?, note?}`.
- `POST /api/review/[token]/submit` → validate deny-notes, set submitted, send notification.
- Admin (authed): `createBatch`, `addItems` (with Supabase Storage upload to bucket `review-images`), `getBatchResponses`, `archiveBatch`. Prefer server actions in the dashboard.

## 10. Seed / sample content
`review-seed.json` = the current MantelMount batch (23 items: order, handle, title, copy, image filename). `images/` holds the 23 files named by handle. Use these to seed the first real batch (upload images to Storage, create items). `handle` doubles as the Shopify article handle for future publishing (keep it on the row as `shopify_handle`).

## 11. Env vars
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), plus email provider key (e.g. `RESEND_API_KEY`) and `REVIEW_NOTIFY_EMAIL=matt@igniteiq.com`. Optional `SLACK_WEBHOOK_URL`.

## 12. Build order (milestones)
1. Migration + RLS (`supabase-migration.sql`), Storage bucket, TS types (`supabase gen types`).
2. `/review/[token]` read-only render from DB, IgniteIQ theme + Aeonik fonts + real logo. Match prototype layout.
3. Autosave responses (rating/decision/note) + validation.
4. Submit + owner email notification.
5. Admin: create batch, upload images, generate link, responses table + export (CSV).
6. Seed the MantelMount batch from `review-seed.json` and do a live end-to-end test.

## 13. Acceptance criteria
- Guest opens `/review/[token]` on mobile with no login and sees all items.
- Rating 1–10 works and persists; Approve/Deny persists; refresh keeps state.
- Deny without a note is blocked client + server; error points to the offending item.
- Progress counts update; Submit sets status + emails Matt the full rating/decision/note breakdown.
- Reviewer page visually matches the prototype and passes IgniteIQ brand rules (Aeonik, one accent, no gradients, no card shadows, 10px/6px radii).
- Admin can create a new batch, upload images, get a link, and view/export responses.

## 14. Reference files in this bundle
- `prototype-reference.html` — the approved UX/visual reference (open it).
- `review-seed.json` — 23-item MantelMount batch (title/copy/image/handle).
- `images/` — the 23 hero images, named by handle.
- `IgniteIQ_Brand_Guidelines_v4.2.pdf` — brand system (Matt has it; token/font paths in §7).
