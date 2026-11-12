-- Migration 003: Upgrade to AI Product Architect Schema
-- Adds phase tracking, expanded decision categories, and PRD validation checks

-- 1. Alter projects table to track discovery phase
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_phase TEXT NOT NULL DEFAULT 'PHASE_1_IDEA';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS phase_data JSONB DEFAULT '{}'::jsonb;

-- 2. Alter discovery_sessions to track active phase
ALTER TABLE discovery_sessions ADD COLUMN IF NOT EXISTS current_phase TEXT NOT NULL DEFAULT 'PHASE_1_IDEA';

-- 3. Create table for PRD quality validations
CREATE TABLE IF NOT EXISTS prd_validations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    overall_score INT NOT NULL,
    is_ready_for_generation BOOLEAN NOT NULL DEFAULT false,
    findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    unresolved_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_prd_validations_project ON prd_validations(project_id);

-- 4. Enable RLS for prd_validations
ALTER TABLE prd_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_validations ON prd_validations FOR ALL USING (true);

