-- Admin annotations: dated "what we changed" notes surfaced on the client
-- dashboard. Admins/members manage; client-role users read their own only.

create table if not exists client_annotations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  annotation_date date not null default current_date,
  title text not null,
  body text,
  module text,                 -- optional DashboardModuleId the note relates to
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_client_annotations_client
  on client_annotations(client_id, annotation_date desc);

alter table client_annotations enable row level security;

-- Admin + member manage all annotations (the app scopes by selected client).
create policy "Admin/member manage annotations"
  on client_annotations for all to authenticated
  using (
    exists (select 1 from users where users.id = auth.uid() and users.role in ('admin', 'member'))
  );

-- Client-role users may read annotations for their own client only.
create policy "Client read own annotations"
  on client_annotations for select to authenticated
  using (
    exists (
      select 1 from users
      where users.id = auth.uid()
        and users.role = 'client'
        and users.client_id = client_annotations.client_id
    )
  );

comment on table client_annotations is
  'Dated admin notes ("what we changed") surfaced on the client dashboard timeline.';
