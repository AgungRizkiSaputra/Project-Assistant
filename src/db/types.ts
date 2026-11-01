export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type DecisionCategory =
  | 'PRODUCT_OVERVIEW'
  | 'PROBLEM_STATEMENT'
  | 'TARGET_USERS'
  | 'USER_ROLES'
  | 'CORE_FLOW'
  | 'FUNCTIONAL_REQUIREMENTS'
  | 'FEATURE_SPECS'
  | 'UI_UX_REQUIREMENTS'
  | 'DATA_REQUIREMENTS'
  | 'NON_FUNCTIONAL_REQUIREMENTS'
  | 'TECH_STACK'
  | 'MVP_SCOPE'
  | 'ACCEPTANCE_CRITERIA'
  | 'FUTURE_ROADMAP'
  | 'ASSUMPTION';

export type DecisionStatus = 'CONFIRMED' | 'SUGGESTED' | 'UNKNOWN' | 'OUT_OF_SCOPE';
export type IdeaStatus = 'INBOX' | 'CONVERTED_TO_PROJECT' | 'ARCHIVED';
export type ProjectStatus = 'DISCOVERY' | 'PRD_DRAFTING' | 'PRD_READY' | 'REVISING' | 'COMPLETED' | 'ARCHIVED';
export type DiscoverySessionStatus = 'ACTIVE' | 'PAUSED' | 'CONCLUDED';
export type PrdStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ExportFormat = 'MARKDOWN' | 'PDF';

export interface UserRow {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_allowed: boolean;
  created_at: string;
  last_active_at: string;
}

export interface IdeaRow {
  id: string;
  user_id: string;
  title: string;
  raw_content: string;
  status: IdeaStatus;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  idea_id: string | null;
  title: string;
  summary: string | null;
  status: ProjectStatus;
  active_session_id: string | null;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscoverySessionRow {
  id: string;
  project_id: string;
  status: DiscoverySessionStatus;
  current_topic: string | null;
  questions_count: number;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Json;
  created_at: string;
}

export interface ProductDecisionRow {
  id: string;
  project_id: string;
  category: DecisionCategory;
  statement: string;
  status: DecisionStatus;
  source_reference: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrdDocumentRow {
  id: string;
  project_id: string;
  title: string;
  status: PrdStatus;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrdVersionRow {
  id: string;
  prd_document_id: string;
  version_number: number;
  title: string;
  content_markdown: string;
  changelog_summary: string | null;
  generated_by_ai: boolean;
  created_at: string;
}

export interface DocumentExportRow {
  id: string;
  prd_version_id: string;
  format: ExportFormat;
  file_name: string;
  storage_path: string | null;
  file_size_bytes: number | null;
  created_at: string;
}

export interface ProcessedUpdateRow {
  update_id: number;
  processed_at: string;
}

export interface AiUsageLogRow {
  id: string;
  user_id: string | null;
  project_id: string | null;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  purpose: string;
  created_at: string;
}

export interface AppSettingRow {
  id: string;
  user_id: string | null;
  setting_key: string;
  setting_value: Json;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        Insert: Partial<UserRow> & { telegram_id: number };
        Update: Partial<UserRow>;
        Relationships: [];
      };
      ideas: {
        Row: IdeaRow;
        Insert: Partial<IdeaRow> & { user_id: string; title: string; raw_content: string };
        Update: Partial<IdeaRow>;
        Relationships: [];
      };
      projects: {
        Row: ProjectRow;
        Insert: Partial<ProjectRow> & { user_id: string; title: string };
        Update: Partial<ProjectRow>;
        Relationships: [];
      };
      discovery_sessions: {
        Row: DiscoverySessionRow;
        Insert: Partial<DiscoverySessionRow> & { project_id: string };
        Update: Partial<DiscoverySessionRow>;
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: Partial<MessageRow> & { session_id: string; role: 'user' | 'assistant' | 'system'; content: string };
        Update: Partial<MessageRow>;
        Relationships: [];
      };
      product_decisions: {
        Row: ProductDecisionRow;
        Insert: Partial<ProductDecisionRow> & { project_id: string; category: DecisionCategory; statement: string };
        Update: Partial<ProductDecisionRow>;
        Relationships: [];
      };
      prd_documents: {
        Row: PrdDocumentRow;
        Insert: Partial<PrdDocumentRow> & { project_id: string; title: string };
        Update: Partial<PrdDocumentRow>;
        Relationships: [];
      };
      prd_versions: {
        Row: PrdVersionRow;
        Insert: Partial<PrdVersionRow> & { prd_document_id: string; version_number: number; title: string; content_markdown: string };
        Update: Partial<PrdVersionRow>;
        Relationships: [];
      };
      document_exports: {
        Row: DocumentExportRow;
        Insert: Partial<DocumentExportRow> & { prd_version_id: string; format: ExportFormat; file_name: string };
        Update: Partial<DocumentExportRow>;
        Relationships: [];
      };
      processed_updates: {
        Row: ProcessedUpdateRow;
        Insert: Partial<ProcessedUpdateRow> & { update_id: number };
        Update: Partial<ProcessedUpdateRow>;
        Relationships: [];
      };
      ai_usage_logs: {
        Row: AiUsageLogRow;
        Insert: Partial<AiUsageLogRow> & { provider: string; model: string; purpose: string };
        Update: Partial<AiUsageLogRow>;
        Relationships: [];
      };
      app_settings: {
        Row: AppSettingRow;
        Insert: Partial<AppSettingRow> & { setting_key: string; setting_value: Json };
        Update: Partial<AppSettingRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
