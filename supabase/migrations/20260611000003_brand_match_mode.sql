-- Branded-split matching mode for the branded vs non-branded split.

alter table clients
  add column if not exists brand_match_mode text not null default 'contains'
    check (brand_match_mode in ('contains', 'exact'));

comment on column clients.brand_match_mode is
  'How brand_terms match GSC queries for the branded split: contains (substring, default) or exact (full-query equality).';
