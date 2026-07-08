-- Client Image Review — schema + RLS
-- Run in Supabase SQL editor (or as a migration). Adjust the admin role check
-- to match the portal's existing auth (e.g. a users table with role='admin').

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists review_batches (
  id           uuid primary key default gen_random_uuid(),
  client       text not null,
  title        text not null,
  token        text not null unique default encode(gen_random_bytes(16),'hex'),
  status       text not null default 'draft' check (status in ('draft','open','submitted','archived')),
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
  unique (item_id, reviewer_name)
);
create index if not exists review_responses_batch_idx on review_responses(batch_id);

-- server-side guard: a denied item must carry a note (defense in depth; also enforce in app)
alter table review_responses
  add constraint deny_requires_note
  check (decision is distinct from 'deny' or (note is not null and length(btrim(note)) > 0));

-- ---------- RLS ----------
alter table review_batches   enable row level security;
alter table review_items     enable row level security;
alter table review_responses enable row level security;

-- Default: no anon access. Guest (token) traffic goes through server-side route
-- handlers using the SERVICE ROLE key, which bypasses RLS. Do NOT add broad anon
-- policies. Below are policies for authenticated admins only.

-- helper: is the current user an admin (adapt to portal's users table)
create or replace function is_admin() returns boolean
language sql stable as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  );
$$;

create policy admin_all_batches   on review_batches   for all using (is_admin()) with check (is_admin());
create policy admin_all_items     on review_items     for all using (is_admin()) with check (is_admin());
create policy admin_all_responses on review_responses for all using (is_admin()) with check (is_admin());

-- ---------- optional: token-scoped RPCs (if you prefer RPC over route handlers) ----------
-- Fetch a batch bundle by token (SECURITY DEFINER so it can read past RLS,
-- but only returns rows for the matching token).
create or replace function get_review_bundle(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare b review_batches;
begin
  select * into b from review_batches where token = p_token;
  if not found then return null; end if;
  return json_build_object(
    'batch', to_json(b),
    'items', (select coalesce(json_agg(i order by i.sort_order),'[]') from review_items i where i.batch_id = b.id),
    'responses', (select coalesce(json_agg(r),'[]') from review_responses r where r.batch_id = b.id)
  );
end $$;

-- Upsert a response by token (validates the item belongs to the token's batch).
create or replace function upsert_review_response(
  p_token text, p_item uuid, p_reviewer text,
  p_rating int, p_decision text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare v_batch uuid;
begin
  select b.id into v_batch
  from review_batches b join review_items i on i.batch_id=b.id
  where b.token=p_token and i.id=p_item and b.status in ('draft','open');
  if v_batch is null then raise exception 'invalid token/item or batch closed'; end if;
  insert into review_responses(batch_id,item_id,reviewer_name,rating,decision,note,updated_at)
  values (v_batch,p_item,coalesce(p_reviewer,'guest'),p_rating,p_decision,p_note,now())
  on conflict (item_id,reviewer_name) do update
    set rating=excluded.rating, decision=excluded.decision, note=excluded.note, updated_at=now();
end $$;

-- Grant execute to anon only if calling RPCs directly from the client with the
-- token as the guard. Safer default: call these from server route handlers with
-- the service role and DO NOT grant anon. Uncomment if using direct RPC:
-- grant execute on function get_review_bundle(text) to anon;
-- grant execute on function upsert_review_response(text,uuid,text,int,text,text) to anon;
