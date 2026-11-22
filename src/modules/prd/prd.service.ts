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

    // 4. Construct Multi-Stage Deep Synthesis Prompts (3 Parallel Clusters)
    // To prevent LLM summarization bias when generating 29 sections, we split generation
    // into 3 parallel clusters (Part 1: Sec 1-10, Part 2: Sec 11-20, Part 3: Sec 21-29)
    // as raw Markdown. This produces a massive 250-500+ line production-grade document
    // fully synthesizing all user decisions without being throttled by JSON escaping.

    const sysMsg: AIChatMessage = {
      role: 'system',
      content:
        'Anda adalah Principal Software Architect & Head of Product kelas dunia. Anda menulis spesifikasi teknis dan PRD standar industri yang SANGAT MENDALAM, PANJANG, LENGKAP, DAN PRESISI. Dilarang keras meringkas menjadi 1-2 baris. Kembangkan setiap seksi dengan analisis mendalam, tabel, skenario nyata, skema data DDL SQL lengkap, spesifikasi API REST, dan kode konkret.',
    };

    const promptPart1 = `Hasilkan DOKUMEN PRD BAGIAN 1 (SEKSI 1 SAMPAI 10) SECARA MENDALAM untuk proyek "${project.title}".
DESKRIPSI PROYEK: ${project.summary || 'Tidak ada ringkasan'}

SUMBER KEBENARAN (${decisions.length} Keputusan Terkonfirmasi Pengguna):
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

FORMAT DOKUMEN BAGIAN 1 (Wajib sertakan seluruh 10 seksi berikut dengan detail mendalam):
## 1. Project Overview
(Tulis 2-3 paragraf mendalam mengenai latar belakang, model bisnis, dan proposisi nilai produk)

## 2. Product Vision & Objectives
(Visi strategis, 3-5 tujuan spesifik yang terukur, dan target jangka panjang)

## 3. Problem Statement
(Analisis mendalam masalah utama yang dialami pengguna sasaran dan kegagalan solusi konvensional)

## 4. Target Audience & User Personas
(Uraikan minimal 2 persona detail: Persona Primer dan Persona Sekunder. Sertakan Bio, Pain Points, Goals, dan Tech Savviness)

## 5. Scope & Project Boundaries
(Tabel detail: In Scope vs Out of Scope beserta alasan bisnis & teknis)

## 6. Functional Requirements
(Tabel komprehensif MoSCoW mencakup FR-01 sampai minimal FR-15: Kode, Nama Fitur, Deskripsi Fungsional, User Role, Prioritas MoSCoW, Acceptance Note)

## 7. Non-Functional Requirements
(Spesifikasi metrik angka terukur: Latency API, Concurrent Users, Uptime SLA 99.9%, Keamanan Data, dan Retensi Dokumen)

## 8. User Roles & Permission Matrix
(Tabel matriks RBAC lengkap untuk seluruh peran pengguna dalam sistem)

## 9. User Journey & Workflow
(Alur langkah demi langkah End-to-End dari registrasi hingga serah terima. Sertakan blok Mermaid diagram)

## 10. Business Logic & Validation Rules
(Aturan transisi status transaksi/proyek, aturan validasi data, dan penanganan sengketa/arbitrase jika ada)`;

    const promptPart2 = `Hasilkan DOKUMEN PRD BAGIAN 2 (SEKSI 11 SAMPAI 20) SECARA MENDALAM untuk proyek "${project.title}".

SUMBER KEBENARAN (${decisions.length} Keputusan Terkonfirmasi Pengguna):
${memoryContext}

FORMAT DOKUMEN BAGIAN 2 (Wajib sertakan seluruh 10 seksi berikut dengan detail mendalam):
## 11. UI/UX Design Direction
(Filosofi desain anti-slop, estetika visual khas, hierarki informasi yang bersih tanpa dashboard klise)

## 12. Design System & Component Guidelines
(Tabel Design Tokens: Palette warna HEX lengkap untuk Primary, Secondary, Accent, Background, Border; Typography scale; spacing)

## 13. Page-by-Page UI Specifications
(Spesifikasi detail minimal 5-6 halaman utama: Deskripsikan Layout, Elemen Kunci, Empty State, Loading State, dan Error State)

## 14. Responsive Design Specifications
(Perilaku responsif: Desktop >=1280px, Tablet 768-1024px, Mobile <768px dengan navigasi adaptif)

## 15. System Architecture
(Arsitektur sistem frontend, backend, database, queue/storage, dan integrasi realtime)

## 16. Technology Stack
(Tabel lengkap tech stack: Frontend, Backend, Database, Auth, Storage, Library pendukung beserta justifikasi pemilihannya)

## 17. Database Schema & Relationships
(WAJIB: Tuliskan DDL SQL PostgreSQL LENGKAP dengan CREATE TABLE, Primary Keys, Foreign Keys, Constraints, Indexes, dan Row Level Security (RLS) untuk seluruh tabel inti)

## 18. API Specifications
(WAJIB: Tabel spesifikasi REST API minimal 8-10 endpoint lengkap dengan Method, Path, Auth Level, Contoh JSON Request Body, dan Contoh JSON Response)

## 19. Authentication & Authorization
(Mekanisme login/OAuth, JWT Access Token rotation, Refresh Token, dan enkripsi keamanan)

## 20. Security Architecture & OWASP Compliance
(Tabel mitigasi konkret terhadap OWASP Top 10: SQL Injection, Broken Access Control via RLS, SSRF, Rate Limiting, CORS, dan Data Encryption)`;

    const promptPart3 = `Hasilkan DOKUMEN PRD BAGIAN 3 (SEKSI 21 SAMPAI 29) SECARA MENDALAM untuk proyek "${project.title}".

SUMBER KEBENARAN (${decisions.length} Keputusan Terkonfirmasi Pengguna):
${memoryContext}

FORMAT DOKUMEN BAGIAN 3 (Wajib sertakan seluruh 9 seksi berikut dengan detail mendalam):
## 21. Error Handling & Edge Cases
(Standar respon JSON error, boundary limits, dan penanganan skenario kegagalan koneksi atau human error)

## 22. Third-Party Integrations
(Integrasi payment gateway, messaging / notifikasi, storage eksternal, dan webhook lifecycle)

## 23. Performance & Scalability
(Strategi caching Edge, connection pooling, optimasi query database, dan asset optimization)

## 24. SEO & Accessibility
(OpenGraph metadata, struktur semantik HTML, dan checklist kepatuhan WCAG 2.1 AA)

## 25. Testing Strategy
(Rencana pengujian: Unit Testing, Integration Test API, End-to-End Test, dan Security Pentest)

## 26. Acceptance Criteria
(WAJIB: Minimal 5-6 skenario pengujian Gherkin menggunakan format Given - When - Then untuk fitur-fitur kritis)

## 27. Deployment & Environment Configuration
(Daftar lengkap Environment Variables, konfigurasi Docker/Hosting, dan alur CI/CD)

## 28. Risks, Assumptions & Dependencies
(Tabel analisis risiko teknis, produk, & operasional beserta rencana kontinjensi nyata)

## 29. Development Roadmap & Milestones
(Roadmap implementasi Sprint 1 sampai Sprint 4 lengkap dengan target deliverable per sprint)`;

    logger.info({ projectId, nextVersionNumber }, 'Executing Multi-Stage Parallel Deep PRD Synthesis (3 Clusters)...');

    const [part1Res, part2Res, part3Res] = await Promise.all([
      this.aiProvider.chat([sysMsg, { role: 'user', content: promptPart1 }]),
      this.aiProvider.chat([sysMsg, { role: 'user', content: promptPart2 }]),
      this.aiProvider.chat([sysMsg, { role: 'user', content: promptPart3 }]),
    ]);

    const header = `# ${project.title} — Product Requirements Document (PRD)
- Document Version: v${nextVersionNumber}.0
- Date: ${new Date().toISOString().slice(0, 10)}
- Author: AI Principal Product Architect
- Status: Ready for Development & Implementation
- Decisions Synthesized: ${decisions.length} Confirmed Architectural Decisions

---
`;

    const fullMarkdown = `${header}\n${part1Res.content.trim()}\n\n---\n\n${part2Res.content.trim()}\n\n---\n\n${part3Res.content.trim()}\n`;

    const changelogSummary = revisionFeedback
      ? `Revisi v${nextVersionNumber}.0 berdasarkan masukan: "${revisionFeedback.slice(0, 120)}..."`
      : `Deep synthesis komprehensif 29 seksi standar industri yang mengintegrasikan seluruh ${decisions.length} keputusan arsitektur (DDL SQL lengkap, API spesifikasi terperinci, matriks RBAC, alur proses, dan kriteria Gherkin).`;

    // 5. Store immutable PRD version
    const { data: newVersion, error: vError } = await (this.supabase as any)
      .from('prd_versions')
      .insert({
        prd_document_id: prdDocId,
        version_number: nextVersionNumber,
        title: `${project.title} v${nextVersionNumber}.0`,
        content_markdown: fullMarkdown,
        changelog_summary: changelogSummary,
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

    logger.info(
      {
        projectId,
        versionNumber: nextVersionNumber,
        lines: fullMarkdown.split('\n').length,
        chars: fullMarkdown.length,
      },
      'Successfully generated Deep Synthesis PRD version'
    );

    return {
      versionNumber: nextVersionNumber,
      contentMarkdown: fullMarkdown,
      changelogSummary,
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
