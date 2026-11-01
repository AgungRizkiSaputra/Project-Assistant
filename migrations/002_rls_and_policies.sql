-- Migration 002: Row Level Security (RLS) & Triggers
-- Enable RLS on all sensitive domain tables

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prd_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE prd_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by backend)
-- Policy templates for service role
CREATE POLICY service_role_all_users ON users FOR ALL USING (true);
CREATE POLICY service_role_all_settings ON app_settings FOR ALL USING (true);
CREATE POLICY service_role_all_ideas ON ideas FOR ALL USING (true);
CREATE POLICY service_role_all_projects ON projects FOR ALL USING (true);
CREATE POLICY service_role_all_sessions ON discovery_sessions FOR ALL USING (true);
CREATE POLICY service_role_all_messages ON messages FOR ALL USING (true);
CREATE POLICY service_role_all_decisions ON product_decisions FOR ALL USING (true);
CREATE POLICY service_role_all_prd_docs ON prd_documents FOR ALL USING (true);
CREATE POLICY service_role_all_prd_versions ON prd_versions FOR ALL USING (true);
CREATE POLICY service_role_all_exports ON document_exports FOR ALL USING (true);
CREATE POLICY service_role_all_updates ON processed_updates FOR ALL USING (true);
CREATE POLICY service_role_all_ai_logs ON ai_usage_logs FOR ALL USING (true);

