import { SupabaseClient } from '@supabase/supabase-js';
import { Database, PrdDocumentRow, PrdVersionRow } from '../../db/types.js';
import { IAIProvider, AIChatMessage } from '../../ai/provider.interface.js';
import { MemoryService } from '../memory/memory.service.js';
import { QualityValidatorService } from '../discovery/quality-validator.service.js';
import { logger } from '../../config/logger.js';

export interface PRDSectionDef {
  number: number;
  title: string;
  cluster: 1 | 2 | 3;
}

export const PRD_STANDARD_SECTIONS: PRDSectionDef[] = [
  { number: 1, title: 'Project Overview', cluster: 1 },
  { number: 2, title: 'Product Vision & Objectives', cluster: 1 },
  { number: 3, title: 'Problem Statement', cluster: 1 },
  { number: 4, title: 'Target Audience & User Personas', cluster: 1 },
  { number: 5, title: 'Scope & Project Boundaries', cluster: 1 },
  { number: 6, title: 'Functional Requirements', cluster: 1 },
  { number: 7, title: 'Non-Functional Requirements', cluster: 1 },
  { number: 8, title: 'User Roles & Permission Matrix', cluster: 1 },
  { number: 9, title: 'User Journey & Workflow', cluster: 1 },
  { number: 10, title: 'Business Logic & Validation Rules', cluster: 1 },
  { number: 11, title: 'UI/UX Design Direction', cluster: 2 },
  { number: 12, title: 'Design System & Component Guidelines', cluster: 2 },
  { number: 13, title: 'Page-by-Page UI Specifications', cluster: 2 },
  { number: 14, title: 'Responsive Design Specifications', cluster: 2 },
  { number: 15, title: 'System Architecture', cluster: 2 },
  { number: 16, title: 'Technology Stack', cluster: 2 },
  { number: 17, title: 'Database Schema & Relationships', cluster: 2 },
  { number: 18, title: 'API Specifications', cluster: 2 },
  { number: 19, title: 'Authentication & Authorization', cluster: 2 },
  { number: 20, title: 'Security Architecture & OWASP Compliance', cluster: 2 },
  { number: 21, title: 'Error Handling & Edge Cases', cluster: 3 },
  { number: 22, title: 'Third-Party Integrations', cluster: 3 },
  { number: 23, title: 'Performance & Scalability', cluster: 3 },
  { number: 24, title: 'SEO & Accessibility', cluster: 3 },
  { number: 25, title: 'Testing Strategy', cluster: 3 },
  { number: 26, title: 'Acceptance Criteria', cluster: 3 },
  { number: 27, title: 'Deployment & Environment Configuration', cluster: 3 },
  { number: 28, title: 'Risks, Assumptions & Dependencies', cluster: 3 },
  { number: 29, title: 'Development Roadmap & Milestones', cluster: 3 },
];

export interface ParsedSection {
  number: number;
  title: string;
  heading: string;
  content: string;
}

export function parsePRDSections(markdown: string): { header: string; sections: ParsedSection[] } {
  if (!markdown) return { header: '', sections: [] };

  const sectionRegex = /^##\s+(\d+)\.\s*([^\n\r]+)/gm;
  const matches: { index: number; number: number; title: string; heading: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(markdown)) !== null) {
    matches.push({
      index: match.index,
      number: parseInt(match[1], 10),
      title: match[2].trim(),
      heading: match[0].trim(),
    });
  }

  if (matches.length === 0) {
    return { header: markdown, sections: [] };
  }

  const header = markdown.slice(0, matches[0].index).trim();
  const sections: ParsedSection[] = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    let fullSlice = markdown.slice(start, end).trim();
    // Strip trailing separator rule
    fullSlice = fullSlice.replace(/\n\s*---\s*$/, '').trim();

    sections.push({
      number: matches[i].number,
      title: matches[i].title,
      heading: matches[i].heading,
      content: fullSlice,
    });
  }

  return { header, sections };
}

export interface PRDGenerateResult {
  versionNumber: number;
  contentMarkdown: string;
  changelogSummary: string;
  affectedSections?: number[];
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

    let fullMarkdown = '';
    let changelogSummary = '';
    let affectedSectionNumbers: number[] = [];

    const sysMsg: AIChatMessage = {
      role: 'system',
      content:
        'Anda adalah Principal Software Architect & Head of Product kelas dunia. Anda menulis dan merevisi spesifikasi teknis dan PRD standar industri yang SANGAT MENDALAM, PANJANG, LENGKAP, DAN PRESISI. Dilarang keras meringkas menjadi 1-2 baris. Kembangkan setiap seksi dengan analisis mendalam, tabel, skenario nyata, skema data DDL SQL lengkap, spesifikasi API REST, dan kode konkret.',
    };

    // 4. Targeted Surgical Revision vs Initial Full Synthesis
    const parsedPrev = previousMarkdown ? parsePRDSections(previousMarkdown) : { header: '', sections: [] };
    const canDoTargetedRevision = Boolean(revisionFeedback && parsedPrev.sections.length > 0);

    if (canDoTargetedRevision) {
      // ===== SURGICAL TARGETED REVISION MODE =====
      // Only revise the specific section(s) affected by revisionFeedback, preserving all other sections 100%!
      affectedSectionNumbers = await this.identifyAffectedSections(revisionFeedback!, targetSectionNumber);
      logger.info(
        { projectId, nextVersionNumber, affectedSectionNumbers, revisionFeedback },
        'Executing Surgical Targeted Section Revision (preserving unaffected sections)...'
      );

      const revisedSectionMap = new Map<number, string>();

      await Promise.all(
        affectedSectionNumbers.map(async (secNum) => {
          const existingSec = parsedPrev.sections.find((s) => s.number === secNum);
          const secDef = PRD_STANDARD_SECTIONS.find((s) => s.number === secNum);
          const secTitle = existingSec?.title || secDef?.title || `Seksi ${secNum}`;
          const secExistingContent = existingSec?.content || `## ${secNum}. ${secTitle}\n(Belum ada konten spesifik)`;

          const revisePrompt = `REVISI TERFOKUS PADA SEKSI ${secNum} (${secTitle}) UNTUK PROYEK "${project.title}".

DESKRIPSI PROYEK: ${project.summary || 'Tidak ada ringkasan'}

SUMBER KEBENARAN ARSITEKTUR (${decisions.length} Keputusan Pengguna):
${memoryContext}

INSTRUKSI REVISI DARI PENGGUNA:
"${revisionFeedback}"

KONTEN SEKSI ${secNum} SEBELUMNYA:
${secExistingContent}

PETUNJUK REVISI KETAT (WAJIB DIIKUTI):
1. Pengguna meminta revisi spesifik. Anda HANYA merevisi dan memperbarui Seksi ${secNum} (${secTitle}).
2. PERTAHANKAN seluruh isi, data, tabel, skema DDL, parameter, dan alur teknis yang sudah ada dari konten sebelumnya yang TIDAK diminta diubah. JANGAN menghapus informasi atau membuat seksi ini menjadi lebih pendek atau sekadar ringkasan!
3. MASUKKAN, PERTEGAS, dan PERBARUI seluruh revisi, endpoint, parameter keamanan, atau aturan baru yang diminta pengguna secara detail, mendalam, dan terstruktur.
4. Awali output langsung dengan heading "## ${secNum}. ${secTitle}". Dilarang memberikan teks pengantar atau basa-basi sebelum atau sesudah seksi.`;

          const res = await this.aiProvider.chat([sysMsg, { role: 'user', content: revisePrompt }]);
          let revisedText = (res?.content || '').trim();
          if (!revisedText.startsWith(`## ${secNum}.`)) {
            revisedText = `## ${secNum}. ${secTitle}\n\n${revisedText}`;
          }
          revisedSectionMap.set(secNum, revisedText);
        })
      );

      // Reassemble document: keep ALL unaffected sections untouched
      const finalSections = parsedPrev.sections.map((sec) => {
        if (revisedSectionMap.has(sec.number)) {
          return revisedSectionMap.get(sec.number)!;
        }
        return sec.content;
      });

      const header = `# ${project.title} — Product Requirements Document (PRD)
- Document Version: v${nextVersionNumber}.0
- Date: ${new Date().toISOString().slice(0, 10)}
- Author: AI Principal Product Architect
- Status: Ready for Development & Implementation (Revised)
- Decisions Synthesized: ${decisions.length} Confirmed Architectural Decisions
- Catatan Revisi: Seksi ${affectedSectionNumbers.join(', ')} (${revisionFeedback!.slice(0, 80)})

---
`;

      fullMarkdown = `${header}\n${finalSections.join('\n\n---\n\n')}\n`;
      changelogSummary = `Revisi v${nextVersionNumber}.0 pada Seksi ${affectedSectionNumbers.join(', ')}: "${revisionFeedback!.slice(0, 120)}..."`;
    } else {
      // ===== INITIAL FULL SYNTHESIS (OR NON-STRUCTURED FALLBACK) =====
      // To prevent LLM summarization bias when generating 29 sections, we split generation
      // into 3 parallel clusters (Part 1: Sec 1-10, Part 2: Sec 11-20, Part 3: Sec 21-29)
      const feedbackBlock = revisionFeedback
        ? `\nCATATAN REVISI / PERUBAHAN DARI PENGGUNA:\n${revisionFeedback}\n`
        : '';

      const promptPart1 = `Hasilkan DOKUMEN PRD BAGIAN 1 (SEKSI 1 SAMPAI 10) SECARA MENDALAM untuk proyek "${project.title}".
DESKRIPSI PROYEK: ${project.summary || 'Tidak ada ringkasan'}

SUMBER KEBENARAN (${decisions.length} Keputusan Terkonfirmasi Pengguna):
${memoryContext}
${feedbackBlock}
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
${feedbackBlock}
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
${feedbackBlock}
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

      fullMarkdown = `${header}\n${(part1Res?.content || '').trim()}\n\n---\n\n${(part2Res?.content || '').trim()}\n\n---\n\n${(part3Res?.content || '').trim()}\n`;

      changelogSummary = revisionFeedback
        ? `Revisi v${nextVersionNumber}.0 berdasarkan masukan: "${revisionFeedback.slice(0, 120)}..."`
        : `Deep synthesis komprehensif 29 seksi standar industri yang mengintegrasikan seluruh ${decisions.length} keputusan arsitektur (DDL SQL lengkap, API spesifikasi terperinci, matriks RBAC, alur proses, dan kriteria Gherkin).`;
    }

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
      affectedSections: affectedSectionNumbers.length > 0 ? affectedSectionNumbers : undefined,
    };
  }

  /**
   * Identify which PRD sections (1-29) are affected by a user's revision feedback
   */
  async identifyAffectedSections(
    revisionFeedback: string,
    targetSectionNumber?: number
  ): Promise<number[]> {
    if (targetSectionNumber && targetSectionNumber >= 1 && targetSectionNumber <= 29) {
      return [targetSectionNumber];
    }

    const sectionsOverview = PRD_STANDARD_SECTIONS.map((s) => `${s.number}. ${s.title}`).join('\n');
    const sysMsg: AIChatMessage = {
      role: 'system',
      content:
        'Anda adalah Lead Product Architect. Anda menganalisis instruksi revisi PRD dari pengguna dan memetakannya HANYA ke nomor seksi yang relevan secara ketat. Berikan output HANYA format JSON murni array angka.',
    };

    const userMsg: AIChatMessage = {
      role: 'user',
      content: `Daftar 29 seksi standar pada dokumen PRD:
${sectionsOverview}

INSTRUKSI REVISI DARI PENGGUNA:
"${revisionFeedback}"

Tugas:
Analisis instruksi revisi di atas dan tentukan nomor seksi (1 sampai 29) yang TERDAMPAK dan PERLU diperbarui secara spesifik.
Prinsip: HANYA pilih nomor seksi yang benar-benar relevan dengan permintaan perubahan (biasanya 1 sampai 3 seksi). Jangan memilih seksi yang tidak diminta diubah, agar seksi lainnya tetap dipertahankan 100%.

Format output: Berikan HANYA JSON array nomor seksi, contoh: [18, 20]`,
    };

    try {
      const res = await this.aiProvider.chat([sysMsg, userMsg]);
      const raw = res?.content?.trim() || '';
      const jsonMatch = raw.match(/\[[\s\d,]+\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter((n: any) => typeof n === 'number' && n >= 1 && n <= 29);
          if (valid.length > 0) return valid;
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to parse AI identified affected sections, using keyword heuristic');
    }

    // Heuristic keyword matching
    const lower = revisionFeedback.toLowerCase();
    const matched = new Set<number>();
    if (/endpoint|api|rest|json|payload|route|post|get|put|delete|status code|response/i.test(lower)) matched.add(18);
    if (/owasp|security|keamanan|rate limit|ddos|enkripsi|csrf|xss|sql injection|proteksi/i.test(lower)) matched.add(20);
    if (/tabel|database|db|skema|sql|ddl|postgresql|rls|foreign key|kolom|relasi/i.test(lower)) matched.add(17);
    if (/auth|login|jwt|token|session|oauth|registrasi|password|verifikasi/i.test(lower)) matched.add(19);
    if (/ui|ux|desain|tampilan|tema|warna|layout|komponen|wireframe|mockup/i.test(lower)) matched.add(11);
    if (/design system|palette|typography|spacing|token/i.test(lower)) matched.add(12);
    if (/halaman|page|screen|empty state|loading state/i.test(lower)) matched.add(13);
    if (/responsif|mobile|tablet|breakpoint/i.test(lower)) matched.add(14);
    if (/arsitektur|architecture|microservice|monolith|queue|realtime/i.test(lower)) matched.add(15);
    if (/tech stack|teknologi|framework|library/i.test(lower)) matched.add(16);
    if (/persona|user|pengguna|target audience|profil/i.test(lower)) matched.add(4);
    if (/fitur|functional|moscow|fr-\d+|fungsional/i.test(lower)) matched.add(6);
    if (/non-functional|nfr|latency|uptime|sla|concurrent/i.test(lower)) matched.add(7);
    if (/role|peran|hak akses|rbac|permission/i.test(lower)) matched.add(8);
    if (/alur|workflow|journey|mermaid|langkah/i.test(lower)) matched.add(9);
    if (/bisnis|business logic|validasi|transisi status/i.test(lower)) matched.add(10);
    if (/error|edge case|penanganan error/i.test(lower)) matched.add(21);
    if (/third-party|integrasi|payment gateway|midtrans|stripe|webhook/i.test(lower)) matched.add(22);
    if (/performa|performance|cache|caching|skalabilitas/i.test(lower)) matched.add(23);
    if (/seo|aksesibilitas|wcag/i.test(lower)) matched.add(24);
    if (/test|pengujian|unit test|e2e|qa/i.test(lower)) matched.add(25);
    if (/acceptance|gherkin|skenario|given.*when.*then/i.test(lower)) matched.add(26);
    if (/deploy|deployment|docker|ci\/cd|env|hosting/i.test(lower)) matched.add(27);
    if (/risiko|risk|asumsi|dependensi/i.test(lower)) matched.add(28);
    if (/roadmap|sprint|milestone|timeline|jadwal/i.test(lower)) matched.add(29);
    if (/problem|masalah|pain point/i.test(lower)) matched.add(3);
    if (/visi|objective|tujuan|goal/i.test(lower)) matched.add(2);
    if (/scope|lingkup|in scope|out of scope/i.test(lower)) matched.add(5);
    if (/overview|latar belakang|model bisnis/i.test(lower)) matched.add(1);

    if (matched.size > 0) {
      return Array.from(matched).sort((a, b) => a - b);
    }

    return [1];
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
