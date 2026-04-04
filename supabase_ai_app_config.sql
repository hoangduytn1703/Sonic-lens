-- Run this in Supabase Dashboard → SQL Editor (once per project).
-- Stores shared AI settings (model, keys, priority) so all devices stay in sync.

CREATE TABLE IF NOT EXISTS ai_app_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Do not seed an empty row: first "Lưu cài đặt" in Admin will upsert id = 'default'.
-- (An empty row would overwrite local keys on first sync.)

ALTER TABLE ai_app_config ENABLE ROW LEVEL SECURITY;

-- Anonymous access (same pattern as many Vite + anon-key demos).
-- Tighten later: restrict to authenticated users or use Edge Functions + Vault for keys.
CREATE POLICY "ai_app_config_select"
  ON ai_app_config FOR SELECT
  USING (true);

CREATE POLICY "ai_app_config_insert"
  ON ai_app_config FOR INSERT
  WITH CHECK (true);

CREATE POLICY "ai_app_config_update"
  ON ai_app_config FOR UPDATE
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE ai_app_config IS 'Sonic Lens: shared AI provider config (synced from Admin UI)';
