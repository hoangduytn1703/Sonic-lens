-- Create recordings table
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  title TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  transcript JSONB NOT NULL,
  summary TEXT,
  duration INTEGER NOT NULL,
  is_important BOOLEAN DEFAULT FALSE,
  summary_incomplete_at_save BOOLEAN DEFAULT FALSE
);

-- Existing projects: run once if the column is missing
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS summary_incomplete_at_save BOOLEAN DEFAULT FALSE;

-- Set up storage bucket
-- Note: You need to create a bucket named 'recordings' in the Supabase Dashboard Storage section manually.
-- Then set the policy to allow public access or authenticated access as needed.

-- Shared AI settings (model, API keys, provider order): run supabase_ai_app_config.sql in the SQL Editor.
