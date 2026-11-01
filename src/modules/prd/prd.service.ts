import { SupabaseClient } from '@supabase/supabase-js';
import { Database, PrdDocumentRow, PrdVersionRow } from '../../db/types.js';
import { IAIProvider, AIChatMessage } from '../../ai/provider.interface.js';
import { MemoryService } from '../memory/memory.service.js';
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
    private aiProvider: IAIProvider
  ) { }

  /**
   * Generate or Revise PRD based on Structured Memory
   */
  async generateOrRevisePRD(
    projectId: string,
    revisionFeedback?: string
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

      // Get latest version
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

    // 4. Construct AI prompt according to Industry Standard PRD Template
    const promptTemplate = `Anda adalah Lead Product Manager kelas dunia. Susun dokumen Product Requirements Document (PRD) yang komprehensif, presisi, dan siap diimplementasikan oleh tim teknik & desain.

JUDUL PROYEK: ${project.title}
DESKRIPSI AWAL: ${project.summary || 'Tidak ada deskripsi awal'}

SUMBER KEBENARAN (STRUCTURED MEMORY):
${memoryContext}

${revisionFeedback
        ? `CATATAN REVISI / PERUBAHAN DARI PENGGUNA:
${revisionFeedback}

DOKUMEN VERSI SEBELUMNYA:
${previousMarkdown}`
        : ''
      }

STANDAR WAJIB STRUKTUR PRD:
Dokumen Markdown yang dihasilkan HARUS mengikuti struktur seksi berikut secara berurutan dan lengkap:
# [Judul Proyek] — Product Requirements Document (PRD)
- Version: v${nextVersionNumber}.0
- Date: ${new Date().toISOString().slice(0, 10)}
- Status: Ready for Review

## 1. Product Overview
(Ringkasan eksekutif produk, visi, dan value proposition utama)

## 2. Problem Statement
(Masalah nyata yang dihadapi pengguna, dampak masalah, dan bukti urgensi)

## 3. Goals & Success Metrics
(Tujuan terukur produk dan KPI kesuksesan peluncuran MVP)

## 4. Target Users & Personas
(Karakteristik target pengguna, kebutuhan utama, dan pain points)

## 5. User Roles & Permissions
(Daftar peran pengguna sistem: Guest, Member, Admin, dll.)

## 6. User Flow & Core Journey
(Langkah-langkah alur utama pengguna dari awal hingga akhir nilai tercapai)

## 7. Functional Requirements
(Daftar kapabilitas sistem dengan numbering terstruktur: FR-01, FR-02, dll.)

## 8. Feature Specifications
(Detail perilaku fungsional dari setiap fitur inti)

## 9. UI/UX Requirements
(Panduan antarmuka, affordance tombol, feedback sistem, dan pertimbangan responsif)

## 10. Data Requirements
(Model entitas data utama, relasi kunci, dan persistensi)

## 11. Non-Functional Requirements
(Performa, keamanan, privasi data, uptime, dan skalabilitas)

## 12. Tech Stack Recommendations
(Rekomendasi stack frontend, backend, database, dan hosting yang selaras)

## 13. MVP Scope
(Batasan fitur yang WAJIB ada di rilis pertama vs fitur yang ditunda)

## 14. Acceptance Criteria
(Kriteria uji kelayakan penerimaan produk sebelum go-live)

## 15. Future Roadmap
(Rencana evolusi produk pasca MVP)

## 16. Assumptions & Open Questions
(Asumsi yang diambil dan pertanyaan terbuka yang perlu validasi lanjutan)

ATURAN OUTPUT:
Kembalikan respon dalam format JSON:
{
  "contentMarkdown": "Dokumen Markdown lengkap sesuai seluruh seksi di atas",
  "changelogSummary": "Ringkasan 2-4 poin perubahan pada versi ini dibanding versi sebelumnya (atau 'Initial PRD release' untuk v1)"
}`;

    const messages: AIChatMessage[] = [
      {
        role: 'system',
        content: 'Anda adalah Lead Product Manager yang hanya menghasilkan PRD terstandarisasi dan output JSON yang valid.',
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

    // 7. Update project status to PRD_READY
    await (this.supabase as any)
      .from('projects')
      .update({
        status: 'PRD_READY',
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    logger.info({ projectId, versionNumber: nextVersionNumber }, 'Generated new PRD version');

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
   * List all versions of a PRD
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
}
