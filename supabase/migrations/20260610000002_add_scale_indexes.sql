-- Composite indexes for client-scoped, time-ordered reads that grow with the
-- client count (107+ brands). Each is the common access pattern for its table.

create index if not exists idx_deliverables_client_created
  on public.deliverables (client_id, created_at desc);

create index if not exists idx_comments_deliverable_created
  on public.comments (deliverable_id, created_at desc);

-- Speeds up threaded-comment traversal (parent_id self-reference).
create index if not exists idx_comments_parent
  on public.comments (parent_id) where parent_id is not null;

create index if not exists idx_ask_conversations_client_updated
  on public.ask_lvl3_conversations (client_id, updated_at desc);

create index if not exists idx_ask_messages_conversation_created
  on public.ask_lvl3_messages (conversation_id, created_at desc);
