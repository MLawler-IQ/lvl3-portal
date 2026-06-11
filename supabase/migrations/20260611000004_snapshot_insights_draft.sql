-- Draft layer for LLM-generated analytics insights.
-- generateAnalyticsInsights now writes the unapproved Claude output here ONLY;
-- the published columns (analytics_summary, snapshot_insights) are written
-- exclusively by approveSnapshotInsightsDraft after an admin reviews the draft.
-- Additive and nullable so existing clients (and the client-facing read paths,
-- which never select this column) are unaffected.

alter table clients
  add column if not exists snapshot_insights_draft jsonb;

comment on column clients.snapshot_insights_draft is
  'Unapproved LLM analytics draft pending admin review: { summary, takeaways, anomalies, opportunities, headline, cards, generatedAt }. Never visible to client-role users — published to snapshot_insights/analytics_summary only by approveSnapshotInsightsDraft.';
