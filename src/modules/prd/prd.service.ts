import { SupabaseClient } from '@supabase/supabase-js';
import { Database, PrdDocumentRow, PrdVersionRow } from '../../db/types.js';
import { IAIProvider, AIChatMessage } from '../../ai/provider.interface.js';
import { MemoryService } from '../memory/memory.service.js';
import { QualityValidatorService } from '../discovery/quality-validator.service.js';
import { logger } from '../../config/logger.js';

export interface PRDGenerateResult {
  versionNumber: number;
  contentMarkdown: string;
  changelogSummary: string;
}

export class PrdService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private memoryService: MemoryService,
    private aiProvider: IAIProvider,
    private validatorService?: QualityValidatorService
  ) {}

  /**
   * Generate or Revise full 29-Section Industry-Standard PRD based on Structured Memory
   */
  async generateOrRevisePRD(
    projectId: string,
    revisionFeedback?: string,
    targetSectionNumber?: number
  ): Promise<PRDGenerateResult> {
    // 1. Fetch project details
    const { data: project, error: pError } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (pError || !project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 2. Fetch all structured decisions
    const decisions = await this.memoryService.getDecisionsByProject(projectId);
    const memoryContext = this.memoryService.formatDecisionsForPrompt(decisions);

    // 3. Check for existing PRD document and latest version
    const { data: existingDoc } = await (this.supabase as any)
      .from('prd_documents')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    let prdDocId: string;
    let nextVersionNumber = 1;
    let previousMarkdown = '';

    if (!existingDoc) {
      const { data: newDoc, error: createDocError } = await (this.supabase as any)
        .from('prd_documents')
        .insert({
          project_id: projectId,
          title: `PRD: ${project.title}`,
          status: 'DRAFT',
        })
        .select()
        .single();

      if (createDocError) throw createDocError;
      prdDocId = newDoc.id;
    } else {
      prdDocId = existingDoc.id;

      const { data: latestVersion } = await (this.supabase as any)
        .from('prd_versions')
        .select('*')
        .eq('prd_document_id', prdDocId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestVersion) {
        nextVersionNumber = latestVersion.version_number + 1;
        previousMarkdown = latestVersion.content_markdown;
      }
    }

    // 4. Construct comprehensive 29-Section Prompt
    const promptTemplate = `Anda adalah Principal AI Product Architect & Technical Lead kelas dunia.
Tugas Anda adalah menghasilkan dokumen Product Requirements Document (PRD) berstandar tertinggi yang komprehensif, presisi, mendalam, dan siap digunakan oleh Full-Stack Developer maupun AI Coding Agent (seperti Claude Code, Cursor, atau Devin).

JUDUL PROYEK: ${project.title}
DESKRIPSI PROYEK: ${project.summary || 'Tidak ada ringkasan'}

SUMBER KEBENARAN (STRUCTURED MEMORY):
${memoryContext}

${
  revisionFeedback
    ? `CATATAN REVISI / PERUBAHAN DARI PENGGUNA:
${revisionFeedback}
${targetSectionNumber ? `(Fokus revisi utama pada Seksi ${targetSectionNumber})` : ''}

DOKUMEN VERSI SEBELUMNYA:
${previousMarkdown}`
    : ''
}

STANDAR WAJIB STRUKTUR PRD (29 SEKSI LENGKAP):
Dokumen Markdown yang Anda hasilkan HARUS mencakup SELURUH 29 seksi berikut secara berurutan dan terperinci. JANGAN melewatkan satu seksi pun:

# ${project.title} — Product Requirements Document (PRD)
- Document Version: v${nextVersionNumber}.0
- Date: ${new Date().toISOString().slice(0, 10)}
- Author: AI Product Architect
- Status: Ready for Development

## 1. Project Overview
## 2. Product Vision & Objectives
## 3. Problem Statement
## 4. Target Audience & User Personas
## 5. Scope & Project Boundaries (In Scope vs Out of Scope)
## 6. Functional Requirements (Format FR-01, FR-02... dengan deskripsi & prioritas MoSCoW)
## 7. Non-Functional Requirements (Performance, Reliability, Scalability, Observability)
## 8. User Roles & Permission Matrix (Tabel Role x Permission lengkap)
## 9. User Journey & Workflow (End-to-End workflow per peran dalam format langkah jelas / Mermaid syntax)
## 10. Business Logic & Validation Rules (State transitions, data validation, edge rules)
## 11. UI/UX Design Direction (Identitas visual khas, filosofi anti-slop, no lazy dashboards)
## 12. Design System & Component Guidelines (Design tokens, palette warna HEX, typography scale, spacing)
## 13. Page-by-Page UI Specifications (Deskripsi detail tiap halaman: Layout, Komponen, Empty State, Loading State, Error State)
## 14. Responsive Design Specifications (Behavior pada Desktop >=1280px, Tablet 768-1024px, Mobile <768px)
## 15. System Architecture (Arsitektur servis, modul, diagram flow)
## 16. Technology Stack (Frontend, Backend, Database, Auth, Storage, Library pendukung beserta justifikasinya)
## 17. Database Schema & Relationships (DDL PostgreSQL lengkap: tabel, primary key, foreign keys, constraints, indexes)
## 18. API Specifications (Tabel endpoint REST: Method, Path, Auth Required, Request Body JSON, Response JSON, Status Codes)
## 19. Authentication & Authorization (Session / JWT strategy, refresh token, hashing, OAuth jika ada)
## 20. Security Architecture & OWASP Compliance (Mitigasi konkret untuk 10 ancaman OWASP Top 10 yang relevan)
## 21. Error Handling & Edge Cases (Standar error format JSON, boundary limits, network failure fallback)
## 22. Third-Party Integrations (SDK, Webhooks, API eksternal yang dibutuhkan)
## 23. Performance & Scalability (Caching strategy, pagination, query optimization)
## 24. SEO & Accessibility (Metadata, OpenGraph, WCAG 2.1 AA checklist)
## 25. Testing Strategy (Unit test, integration test, E2E test plan, security audit)
## 26. Acceptance Criteria (Format Gherkin Given-When-Then untuk fitur-fitur kritis)
## 27. Deployment & Environment Configuration (Environment variables, Docker, CI/CD pipeline, VPS/Hosting)
## 28. Risks, Assumptions & Dependencies (Risiko teknis & produk beserta rencana kontinjensi)
## 29. Development Roadmap & Milestones (Fase implementasi MVP Sprint 1-4)

PANDUAN KUALITAS:
- Berikan detail konkret dan kode/skema nyata, jangan gunakan kalimat klise generik ("Sistem akan dibuat dengan baik").
- Sertakan blok DDL SQL pada Seksi 17.
- Sertakan contoh JSON payload pada Seksi 18.
- Format Markdown harus sangat bersih, rapi, dan mudah dibaca.

Format JSON yang HARUS Anda hasilkan:
{
  "contentMarkdown": "Dokumen Markdown lengkap seluruh 29 seksi di atas",
  "changelogSummary": "Ringkasan 2-4 poin perubahan kunci pada versi v${nextVersionNumber}.0 ini"
}`;

    const messages: AIChatMessage[] = [
      {
        role: 'system',
        content: 'Anda adalah Lead Software Architect & Product Manager yang hanya menghasilkan PRD 29 seksi berstandar tinggi tanpa placeholder kosong.',
      },
      {
        role: 'user',
        content: promptTemplate,
      },
    ];

    const result = await this.aiProvider.chatStructured<{
      contentMarkdown: string;
      changelogSummary: string;
    }>(messages, 'JSON matching schema { contentMarkdown: string, changelogSummary: string }');

    // 5. Store immutable PRD version
    const { data: newVersion, error: vError } = await (this.supabase as any)
      .from('prd_versions')
      .insert({
        prd_document_id: prdDocId,
        version_number: nextVersionNumber,
        title: `${project.title} v${nextVersionNumber}.0`,
        content_markdown: result.data.contentMarkdown,
        changelog_summary: result.data.changelogSummary,
        generated_by_ai: true,
      })
      .select()
      .single();

    if (vError) throw vError;

    // 6. Update current version pointer on parent doc
    await (this.supabase as any)
      .from('prd_documents')
      .update({
        current_version_id: newVersion.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prdDocId);

    // 7. Update project status to PRD_READY & current_phase to PHASE_8_PRD_READY
    await (this.supabase as any)
      .from('projects')
      .update({
        status: 'PRD_READY',
        current_phase: 'PHASE_8_PRD_READY',
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    logger.info({ projectId, versionNumber: nextVersionNumber }, 'Generated 29-section PRD version');

    return {
      versionNumber: nextVersionNumber,
      contentMarkdown: result.data.contentMarkdown,
      changelogSummary: result.data.changelogSummary,
    };
  }

  /**
   * Get latest PRD for a project
   */
  async getLatestPRD(projectId: string): Promise<{ doc: PrdDocumentRow; version: PrdVersionRow } | null> {
    const { data: doc } = await (this.supabase as any)
      .from('prd_documents')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (!doc || !doc.current_version_id) {
      return null;
    }

    const { data: version } = await (this.supabase as any)
      .from('prd_versions')
      .select('*')
      .eq('id', doc.current_version_id)
      .maybeSingle();

    if (!version) return null;

    return { doc: doc as PrdDocumentRow, version: version as PrdVersionRow };
  }

  /**
   * List all versions of a PRD for a given project
   */
  async listVersions(projectId: string): Promise<PrdVersionRow[]> {
    const { data: doc } = await (this.supabase as any)
      .from('prd_documents')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle();

    if (!doc) return [];

    const { data: versions } = await (this.supabase as any)
      .from('prd_versions')
      .select('*')
      .eq('prd_document_id', doc.id)
      .order('version_number', { ascending: false });

    return (versions || []) as PrdVersionRow[];
  }

  /**
   * Delete an individual PRD version with user ownership validation without deleting parent project
   */
  async deletePRDVersion(
    versionId: string,
    projectId: string,
    userId: string
  ): Promise<{ success: boolean; versionTitle: string; remainingVersionsCount: number }> {
    // 1. Verifikasi kepemilikan proyek
    const { data: project } = await (this.supabase as any)
      .from('projects')
      .select('id, title, user_id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!project) {
      throw new Error('Proyek tidak ditemukan atau Anda tidak memiliki akses ke dokumen ini.');
    }

    // 2. Ambil dokumen induk PRD
    const { data: prdDoc } = await (this.supabase as any)
      .from('prd_documents')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (!prdDoc) {
      throw new Error('Dokumen PRD tidak ditemukan.');
    }

    // 3. Ambil data versi PRD yang akan dihapus
    const { data: targetVersion } = await (this.supabase as any)
      .from('prd_versions')
      .select('*')
      .eq('id', versionId)
      .eq('prd_document_id', prdDoc.id)
      .maybeSingle();

    if (!targetVersion) {
      throw new Error('Versi PRD tidak ditemukan.');
    }

    // 4. Hapus riwayat ekspor terkait versi ini
    await (this.supabase as any)
      .from('document_exports')
      .delete()
      .eq('prd_version_id', versionId);

    // 5. Cek apakah ini versi aktif di prd_documents
    const isCurrentVersion = prdDoc.current_version_id === versionId;

    // 6. Hapus versi dari tabel prd_versions
    const { error: deleteError } = await (this.supabase as any)
      .from('prd_versions')
      .delete()
      .eq('id', versionId);

    if (deleteError) {
      logger.error({ deleteError, versionId }, 'Failed to delete PRD version');
      throw deleteError;
    }

    // 7. Ambil versi tersisa
    const remainingVersions = await this.listVersions(projectId);

    // 8. Jika versi yang dihapus adalah current_version, perbarui pointer ke versi terbaru tersisa
    if (isCurrentVersion) {
      const nextLatestVersion = remainingVersions[0] || null;
      await (this.supabase as any)
        .from('prd_documents')
        .update({
          current_version_id: nextLatestVersion ? nextLatestVersion.id : null,
          status: nextLatestVersion ? 'DRAFT' : 'ARCHIVED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', prdDoc.id);

      // Jika tidak ada versi tersisa, kembalikan status project
      if (!nextLatestVersion) {
        await (this.supabase as any)
          .from('projects')
          .update({
            status: 'DISCOVERY',
            current_phase: 'PHASE_7_VALIDATION',
            updated_at: new Date().toISOString(),
          })
          .eq('id', projectId);
      }
    }

    logger.info(
      { versionId, projectId, remaining: remainingVersions.length },
      'Successfully deleted individual PRD version'
    );

    return {
      success: true,
      versionTitle: targetVersion.title,
      remainingVersionsCount: remainingVersions.length,
    };
  }
}
