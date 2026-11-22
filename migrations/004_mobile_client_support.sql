-- Migration 004: Mobile Client Support & Extended Attributes
-- Safe non-breaking extension for Personal Project Hub mobile app

-- 1. Extend users table for mobile auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Extend ideas table for categories & mobile lifecycle
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Other';

-- 3. Safely update ideas status constraint to include new lifecycle statuses
ALTER TABLE ideas DROP CONSTRAINT IF EXISTS ideas_status_check;
ALTER TABLE ideas ADD CONSTRAINT ideas_status_check 
  CHECK (status IN ('INBOX', 'EXPLORING', 'READY_TO_BUILD', 'SELECTED', 'CONVERTED_TO_PROJECT', 'ARCHIVED'));

-- 4. Spin History table for Idea Spinner module
CREATE TABLE IF NOT EXISTS idea_spin_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    filter_category TEXT,
    spun_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_spin_history_user ON idea_spin_history(user_id);
ALTER TABLE idea_spin_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_spin_history ON idea_spin_history FOR ALL USING (true);
