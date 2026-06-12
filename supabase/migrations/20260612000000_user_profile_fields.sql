-- ============================================================
-- User profile fields: display name + first-class deactivation
--
-- Adds to public.users:
--   name           — optional display name (captured at invite, editable)
--   status         — 'active' | 'deactivated'; the source of truth for
--                    deactivation (replaces parsing auth.users.banned_until
--                    for status, which v1 relied on)
--   deactivated_at — when the account was deactivated (null while active)
--
-- Enforcement: lib/auth.ts requireAuth() blocks status='deactivated' app-side,
-- and the deactivate action also sets a Supabase Auth ban as defense-in-depth
-- (covers non-requireAuth paths and stops token refresh).
--
-- Idempotent (IF NOT EXISTS / guarded ADD CONSTRAINT) so `supabase db push
-- --include-all` stays safe to re-run.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name           TEXT,
  ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Constrain status to the known set (guarded so re-runs don't error).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'deactivated'));
  END IF;
END $$;

-- Extend the signup trigger to also capture an optional display name from the
-- invite metadata (raw_user_meta_data->>'name'). Role + client_id behaviour is
-- unchanged from 20240101000006_add_member_role_objects.sql.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, role, client_id, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::public.user_role,
      'client'
    ),
    (NEW.raw_user_meta_data->>'client_id')::uuid,
    NEW.raw_user_meta_data->>'name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
