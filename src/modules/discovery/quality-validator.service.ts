import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../db/types.js';
import { MemoryService } from '../memory/memory.service.js';
import { IAIProvider, AIChatMessage } from '../../ai/provider.interface.js';
import { logger } from '../../config/logger.js';

export interface ValidationFinding {
  dimension: string;
  status: 'PASSED' | 'WARNING' | 'CRITICAL';
  feedback: string;
  recommendation?: string;
}

export interface ValidationReport {
  overallScore: number; // 0 - 100
  isReadyForGeneration: boolean;
  findings: ValidationFinding[];
  unresolvedGaps: string[];
  summaryMessage: string;
}

export class QualityValidatorService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private memoryService: MemoryService,
    private aiProvider: IAIProvider
  ) {}

  /**
   * Run comprehensive 10-dimension pre-flight quality check on structured project memory
   */
  async validateProjectReadiness(projectId: string): Promise<ValidationReport> {
    const { data: project } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const decisions = await this.memoryService.getDecisionsByProject(projectId);
    const memoryContext = this.memoryService.formatDecisionsForPrompt(decisions);

    const systemPrompt = `Anda adalah Senior Product Auditor & Software Quality Architect. Tugas Anda adalah mengaudit kesiapan keputusan proyek sebelum dokumen PRD 29 seksi di-generate.

NAMA PROYEK: ${project.title}
DESKRIPSI: ${project.summary || 'Tidak ada ringkasan'}

SUMBER KEBENARAN KEPUTUSAN SAAT INI (STRUCTURED MEMORY):
${memoryContext}

EVALUASI 10 DIMENSI KRUSIAL:
1. Requirements Completeness: Apakah problem, tujuan, dan functional requirements inti sudah jelas?
2. User Role & Matrix Consistency: Apakah peran pengguna dan hak akses sudah didefinisikan tanpa celah?
3. User Flow Completeness: Apakah alur utama dari awal sampai selesai sudah utuh tanpa jalan buntu?
4. Business Logic & Edge Cases: Apakah validasi, aturan bisnis, dan penanganan kondisi khusus sudah ada?
5. UI/UX & Design Direction: Apakah identitas visual, palette, responsive desktop/mobile, dan spesifikasi halaman sudah jelas?
6. Tech Stack Feasibility: Apakah stack frontend/backend/database/auth realistis dan selaras?
7. Database Schema Match: Apakah kebutuhan data sudah terpetakan ke tabel dan relasi?
8. API Specifications: Apakah ada kejelasan endpoint/protokol komunikasi data?
9. Security & OWASP Coverage: Apakah ada mitigasi nyata untuk risiko keamanan (auth, injection, rbac)?
10. Testability & Scope Boundaries: Apakah kriteria MVP vs Out of Scope tegas dan dapat diuji?

ATURAN SKORING:
- Berikan skor 0 - 100 berdasarkan kualitas dan kekompakan implementabilitas (bukan karena panjang teks).
- isReadyForGeneration bernilai true HANYA jika skor >= 75 dan tidak ada temuan CRITICAL.
- Jika ada celah yang belum jelas, masukkan ke unresolvedGaps.

Format JSON yang HARUS dikembalikan:
{
  "overallScore": number,
  "isReadyForGeneration": boolean,
  "findings": [
    {
      "dimension": "Nama dimensi (misal: Security & OWASP Coverage)",
      "status": "PASSED | WARNING | CRITICAL",
      "feedback": "Penjelasan evaluasi tajam",
      "recommendation": "Saran konkrit jika status WARNING/CRITICAL"
    }
  ],
  "unresolvedGaps": ["Poin celah 1", "Poin celah 2"],
  "summaryMessage": "Rangkuman kesiapan produk dalam 2-3 paragraf ramah untuk Telegram"
}`;

    const messages: AIChatMessage[] = [
      { role: 'system', content: 'Anda adalah Senior Quality Auditor yang teliti dan objektif.' },
      { role: 'user', content: systemPrompt },
    ];

    const result = await this.aiProvider.chatStructured<ValidationReport>(
      messages,
      'Valid JSON matching ValidationReport schema'
    );

    const report = result.data;

    // Simpan hasil validasi ke DB prd_validations
    try {
      await (this.supabase as any).from('prd_validations').insert({
        project_id: projectId,
        overall_score: report.overallScore,
        is_ready_for_generation: report.isReadyForGeneration,
        findings: report.findings,
        unresolved_gaps: report.unresolvedGaps,
      });
    } catch (saveErr) {
      logger.error({ saveErr, projectId }, 'Failed to persist validation report');
    }

    return report;
  }
}

