# Infrastructure & Deployment

Operational reference for hosting, DNS, auth, and the `portal.igniteiq.com` cutover. Read when touching deploys, domains, env vars, or auth.

## Domains & DNS
- **Registrar:** NameBright (`igniteiq.com`) — **registrar only**. Its DNS records panel is **inert**; do NOT edit DNS there.
- **Authoritative DNS:** **Cloudflare** (nameservers `patrick.ns.cloudflare.com` / `sonia.ns.cloudflare.com`). All DNS edits happen in Cloudflare.
- **Access:** **Ryan** set up Vercel + Cloudflare and holds access; Matt is being added. Registrant: Scott Rayden.
- **Portal:** `portal.igniteiq.com` → Vercel. Cloudflare record `CNAME portal → cname.vercel-dns.com`, **DNS-only (grey cloud)** so Vercel can issue SSL. Intended Primary Domain.
- **Legacy:** `lvl3-portal.vercel.app` 308-redirects to portal — in `next.config.mjs`, **gated on `NEXT_PUBLIC_SITE_URL`** (inert until that env var is set to the portal URL).
- **Other `igniteiq.com` records (all in Cloudflare):** apex + `www` → Webflow (`141.193.213.x`); `studio` → Vercel (`76.76.21.21`, grey-cloud — existing precedent for a Vercel subdomain); `api` / `mcp` → `ghs.googlehosted.com`.

## Vercel
- Team `matts-projects-008e6073` (`team_Zgzwn30892JZLWpammF5nBvv`); project `lvl3-portal`.
- Production **auto-deploys from `main`** via GitHub integration.
- Env-var changes need a **redeploy** to take effect — especially `NEXT_PUBLIC_*`, which are inlined at build time.
- No MCP tool exists for adding domains or env vars — those are manual (dashboard / `vercel` CLI).

## Supabase
- Project `zoeaifsxnaenlcdkavzf` ("lvl3-portal", `us-west-2`).
- Auth: magic-link (**PKCE**) + password. Site URL + redirect allowlist include `https://portal.igniteiq.com`.
- Login builds `emailRedirectTo` from `window.location.origin` (not an env var) so the link returns to the same host the user signed in from.
- **Email is still on the built-in mailer** (`noreply@mail.app.supabase.io`) → ~a handful/hour, project-wide → **429 `over_email_send_rate_limit`** is the real cause of "magic link not working." **Fix: custom SMTP + raise the auth email rate limit. OUTSTANDING.**

## Google OAuth (GA4 / GSC / GBP)
- One **Web** OAuth client (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`), **Internal** user type → no verification required.
- Registered: redirect URI `https://portal.igniteiq.com/auth/google-callback`, JS origin `https://portal.igniteiq.com`; authorized domains include `igniteiq.com`. The callback route derives its redirect from the request origin.

## App theme
- Portal UI = IgniteIQ **light** theme (`app/globals.css`, "Brand v4.2"). CLAUDE.md's brand-guidelines section describes LVL3 dark-violet for **generated artifacts** — that's separate from the app's own theme.
- Some components still carry hardcoded inline colors from the old dark theme (the login page was one — fixed in PR #13). When touching UI, watch for stale `color: var(--background)` (near-white now) and leftover violet (`#8B5CF6` / `#9D7AE8`).

## Sandbox limitation (Claude Code remote sessions)
- Outbound network is allowlisted. Reachable: `github.com`, `lvl3-portal.vercel.app`. Blocked (`403 host_not_allowed`): `portal.igniteiq.com`, `studio.igniteiq.com`, arbitrary hosts, `dns.google`.
- **The live site cannot be fetched from the sandbox** — visual/live verification must be done by Matt in a browser. (DNS resolution via the local resolver does work.)

## `portal.igniteiq.com` cutover — status
- [x] Cloudflare `CNAME portal` → Vercel (grey-cloud)
- [x] Vercel domain added (live, valid cert)
- [x] Supabase Site URL + redirect allowlist
- [x] Google OAuth redirect URI + JS origin + authorized domain
- [x] Login fixes + dormant redirect/metadata merged & deployed (PR #13, commit `83bed03`)
- [ ] Vercel: set `NEXT_PUBLIC_SITE_URL=https://portal.igniteiq.com` (Production) + redeploy → activates the legacy redirect and points invite emails at portal
- [ ] Vercel: set `portal.igniteiq.com` as **Primary Domain**
- [ ] Supabase: configure **custom SMTP** + raise auth email rate limit (fixes magic-link 429)
- [ ] Sweep remaining components for stale dark-theme inline colors
