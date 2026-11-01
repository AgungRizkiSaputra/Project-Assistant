-- Migration 001: Initial Schema for Personal Product Assistant
-- Created at: 2026-11-01

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Table: processed_updates (Telegram idempotency to prevent duplicate command processing)
CREATE TABLE IF NOT EXISTS processed_updates (
    update_id BIGINT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_processed_updates_processed_at ON processed_updates(processed_at);

-- 2. Table: users (Authorized telegram users)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    is_allowed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- 3. Table: app_settings (Per-user or global assistant configurations)
CREATE TABLE IF NOT EXISTS app_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    setting_key TEXT NOT NULL,
    setting_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(user_id, setting_key)
);

-- 4. Table: ideas (Idea Inbox)
-- Statuses: INBOX, CONVERTED_TO_PROJECT, ARCHIVED
CREATE TABLE IF NOT EXISTS ideas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'INBOX' CHECK (status IN ('INBOX', 'CONVERTED_TO_PROJECT', 'ARCHIVED')),
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_ideas_user_id ON ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);

-- 5. Table: projects (Projects actively being discovered or PRD drafted)
-- Statuses: DISCOVERY, PRD_DRAFTING, PRD_READY, REVISING, COMPLETED, ARCHIVED
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'DISCOVERY' CHECK (status IN ('DISCOVERY', 'PRD_DRAFTING', 'PRD_READY', 'REVISING', 'COMPLETED', 'ARCHIVED')),
    active_session_id UUID,
    is_locked BOOLEAN NOT NULL DEFAULT false, -- concurrency lock for ongoing AI discovery
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- 6. Table: discovery_sessions (Conversational discovery for a project)
-- Statuses: ACTIVE, PAUSED, CONCLUDED
CREATE TABLE IF NOT EXISTS discovery_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'CONCLUDED')),
    current_topic TEXT,
    questions_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project ON discovery_sessions(project_id);

-- 7. Table: messages (Discovery conversation turns)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES discovery_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

-- 8. Table: product_decisions (Structured Memory)
-- Statuses: CONFIRMED, SUGGESTED, UNKNOWN, OUT_OF_SCOPE
CREATE TABLE IF NOT EXISTS product_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN (
        'PRODUCT_OVERVIEW', 'PROBLEM_STATEMENT', 'TARGET_USERS', 'USER_ROLES', 
        'CORE_FLOW', 'FUNCTIONAL_REQUIREMENTS', 'FEATURE_SPECS', 'UI_UX_REQUIREMENTS', 
        'DATA_REQUIREMENTS', 'NON_FUNCTIONAL_REQUIREMENTS', 'TECH_STACK', 
        'MVP_SCOPE', 'ACCEPTANCE_CRITERIA', 'FUTURE_ROADMAP', 'ASSUMPTION'
    )),
    statement TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'SUGGESTED', 'UNKNOWN', 'OUT_OF_SCOPE')),
    source_reference TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON product_decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON product_decisions(status);

-- 9. Table: prd_documents (Parent PRD record for a project)
CREATE TABLE IF NOT EXISTS prd_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    current_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 10. Table: prd_versions (Immutable version history)
CREATE TABLE IF NOT EXISTS prd_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prd_document_id UUID NOT NULL REFERENCES prd_documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    title TEXT NOT NULL,
    content_markdown TEXT NOT NULL,
    changelog_summary TEXT,
    generated_by_ai BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(prd_document_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_prd_versions_doc ON prd_versions(prd_document_id);

-- 11. Table: document_exports (Exported files tracked in storage)
CREATE TABLE IF NOT EXISTS document_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prd_version_id UUID NOT NULL REFERENCES prd_versions(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('MARKDOWN', 'PDF')),
    file_name TEXT NOT NULL,
    storage_path TEXT,
    file_size_bytes BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_exports_version ON document_exports(prd_version_id);

-- 12. Table: ai_usage_logs (Cost tracking & audit log)
CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    latency_ms INT DEFAULT 0,
    purpose TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_logs(user_id);

-- Add self-referencing foreign keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_active_session'
    ) THEN
        ALTER TABLE projects 
        ADD CONSTRAINT fk_projects_active_session 
        FOREIGN KEY (active_session_id) REFERENCES discovery_sessions(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_prd_documents_current_version'
    ) THEN
        ALTER TABLE prd_documents 
        ADD CONSTRAINT fk_prd_documents_current_version 
        FOREIGN KEY (current_version_id) REFERENCES prd_versions(id) ON DELETE SET NULL;
    END IF;
END $$;

