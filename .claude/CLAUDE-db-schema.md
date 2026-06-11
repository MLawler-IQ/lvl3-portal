# Database Schema (key tables)

```sql
clients
  id uuid PK
  name text
  slug text UNIQUE
  logo_url text
  hero_image_url text
  google_sheet_id text        -- Google Sheets ID or URL
  sheet_header_row int        -- which row has column headers (default 1)
  sheet_column_map jsonb      -- { month, category, task, status, fee, note } → column header names
  looker_embed_url text
  ga4_property_id text        -- numeric property ID (not "properties/XXX")
  gsc_site_url text           -- e.g. "https://example.com/" or "sc-domain:example.com"
  analytics_summary text      -- AI-generated narrative (updated by generateAnalyticsInsights)
  analytics_summary_updated_at timestamptz
  snapshot_insights jsonb     -- { takeaways, anomalies, opportunities } + structured { headline, cards: InsightCard[] } (Phase B)
  ai_summary text             -- project AI summary (updated by generateClientSummary)
  -- Dashboard metadata (additive, nullable; null client_type = generic dashboard):
  client_type text            -- local_service | multi_location | ecommerce | lead_gen
  gbp_account_id text         -- GBP account resource name "accounts/123" for dashboard insights
  gbp_location_group text     -- optional GBP location-group / label filter
  key_event_names text[]      -- GA4 key-event (conversion) names (lead-gen)
  competitors text[]          -- competitor domains for the competitive module
  brand_terms text[]          -- branded-query matchers for the branded split (null = domain-derived)
  brand_match_mode text        -- 'contains' (substring, default) | 'exact' (full-query equality)
  targets jsonb               -- monthly goals: { "<metricId>": { value, period: "YYYY-MM" } }
  semrush_project_id text     -- Semrush Site Audit project id

users
  id uuid PK (= auth.users.id)
  email text
  role text  ('admin' | 'member' | 'client')
  client_id uuid FK → clients  (null for admin/member)

deliverables
  id, client_id, title, type, status, file_url, created_at, updated_at, is_read

comments
  id, deliverable_id, user_id, body, resolved, created_at

client_annotations          -- dated "what we changed" notes shown on the dashboard
  id uuid PK, client_id uuid FK → clients (on delete cascade)
  annotation_date date, title text, body text, module text (optional DashboardModuleId)
  created_by uuid → auth.users, created_at timestamptz
  -- RLS: admin/member manage all rows; client-role reads its own client only

admin_google_token          -- single row (id=1)
  id int PK CHECK (id = 1)
  access_token text
  refresh_token text
  expiry_date bigint
  email text

user_client_access          -- member ↔ client many-to-many
  user_id, client_id

ask_lvl3_conversations      -- chat threads per client
  id uuid PK, client_id FK, title, created_at, updated_at

ask_lvl3_messages           -- messages within a thread
  id uuid PK, conversation_id FK, role, content, created_at

semrush_reports             -- persisted gap analysis results
  id uuid PK, client_id FK, client_domain, competitors, database,
  page_section, filters, keywords jsonb, client_keyword_count, keyword_count, created_at
```
