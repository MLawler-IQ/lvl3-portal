-- Branded-search matchers for the branded vs non-branded split.

alter table clients
  add column if not exists brand_terms text[];

comment on column clients.brand_terms is
  'Branded-search matchers (case-insensitive substrings) for the branded vs non-branded split. Null/empty = fall back to a domain-derived token.';
