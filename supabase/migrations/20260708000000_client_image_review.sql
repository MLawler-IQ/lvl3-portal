-- Client image review: token-gated reviewer + admin CRUD.
-- Guest access is service-role-only via /api/review/[token] handlers (no anon
-- policies, no RPCs) — same model as public_reports. Admin via get_my_role().

create table if not exists review_batches (
  id           uuid primary key default gen_random_uuid(),
  client       text not null,
  title        text not null,
  token        text not null unique default encode(gen_random_bytes(16), 'hex'),
  status       text not null default 'draft'
               check (status in ('draft','open','submitted','archived')),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists review_items (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references review_batches(id) on delete cascade,
  sort_order     int not null default 0,
  title          text not null,
  copy           text,
  copy_url       text,
  image_url      text not null,
  shopify_handle text
);
create index if not exists review_items_batch_idx on review_items(batch_id, sort_order);

create table if not exists review_responses (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references review_batches(id) on delete cascade,
  item_id       uuid not null references review_items(id) on delete cascade,
  reviewer_name text not null default 'guest',
  rating        int check (rating between 1 and 10),
  decision      text check (decision in ('approve','deny')),
  note          text,
  updated_at    timestamptz not null default now(),
  unique (item_id, reviewer_name),
  constraint deny_requires_note
    check (decision is distinct from 'deny' or (note is not null and length(btrim(note)) > 0))
);
create index if not exists review_responses_batch_idx on review_responses(batch_id);

alter table review_batches   enable row level security;
alter table review_items     enable row level security;
alter table review_responses enable row level security;

drop policy if exists admin_all_review_batches on review_batches;
create policy admin_all_review_batches on review_batches
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop policy if exists admin_all_review_items on review_items;
create policy admin_all_review_items on review_items
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop policy if exists admin_all_review_responses on review_responses;
create policy admin_all_review_responses on review_responses
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- Storage: public bucket for review hero images (12MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', true, 12582912,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists admins_manage_review_images on storage.objects;
create policy admins_manage_review_images on storage.objects
  for all to authenticated
  using (bucket_id = 'review-images' and public.get_my_role() = 'admin')
  with check (bucket_id = 'review-images' and public.get_my_role() = 'admin');
