-- Persist the client's website.
--
-- The new-client modal has always collected a website and then thrown it away —
-- it was used only to fetch a logo (components/clients/new-client-modal.tsx).
-- Everything else in the codebase derives the client's domain from
-- `gsc_site_url` via normalizeDomain.
--
-- That is a chicken-and-egg for onboarding: the domain we need in order to
-- auto-match GA4 / GSC / GBP is derived from the very field we are trying to
-- auto-fill. So the website becomes a first-class column, captured at creation
-- and used as the match key.
--
-- Additive and nullable: every existing read path is unaffected, and the four
-- existing clients simply have it null until someone fills it in.

alter table public.clients
  add column if not exists website_url text;

comment on column public.clients.website_url is
  'The client website as entered at creation, e.g. "https://tornadohvacca.com". The match key for onboarding auto-discovery of GA4/GSC/GBP. Distinct from gsc_site_url, which is the verified Search Console property and may be an sc-domain: form.';
