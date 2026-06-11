-- Dashboard metadata: client typing, GBP mapping, and module-config inputs.
-- All additive and nullable; existing clients default to the generic dashboard
-- (client_type IS NULL → core modules only, see lib/dashboard/registry.ts).

alter table clients
  add column if not exists client_type text
    check (client_type in ('local_service', 'multi_location', 'ecommerce', 'lead_gen')),
  add column if not exists gbp_account_id text,
  add column if not exists gbp_location_group text,
  add column if not exists key_event_names text[],
  add column if not exists competitors text[],
  add column if not exists targets jsonb;

comment on column clients.client_type is
  'Dashboard archetype driving the default module set (null = generic). See lib/dashboard/registry.ts.';
comment on column clients.gbp_account_id is
  'Google Business Profile account resource name ("accounts/123456") this client maps to, for dashboard GBP insights.';
comment on column clients.gbp_location_group is
  'Optional GBP location-group / label filter scoping which locations belong to this client.';
comment on column clients.key_event_names is
  'GA4 key-event (conversion) names that count as this client''s north-star leads (lead_gen).';
comment on column clients.competitors is
  'Competitor domains tracked in the competitive module.';
comment on column clients.targets is
  'Per-metric monthly goals for vs-target chips and pacing: { "<metricId>": { "value": number, "period": "YYYY-MM" } }.';
