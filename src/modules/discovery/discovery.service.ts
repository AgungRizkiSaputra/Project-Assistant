import { SupabaseClient } from '@supabase/supabase-js';
import { Database, DecisionCategory, DecisionStatus, DiscoveryPhase } from '../../db/types.js';
import { IAIProvider, AIChatMessage } from '../../ai/provider.interface.js';
import { MemoryService } from '../memory/memory.service.js';
import { DISCOVERY_PHASES, getPhaseMetadata, getPhasePromptInstruction } from './phases.config.js';
import { logger } from '../../config/logger.js';

export interface DiscoveryQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface DiscoveryQuestion {
  id: string;
  question: string;
  multiSelect: boolean;
  allowCustom: boolean;
  allowSkip: boolean;
  aiRecommendation?: string;
  options: DiscoveryQuestionOption[];
  selectedOptionIds?: string[];
}

export interface DiscoveryReply {
  phase: DiscoveryPhase;
  phaseNumber: number;
  phaseTitle: string;
  assistantResponse: string;
  question?: DiscoveryQuestion;
  identifiedDecisions: Array<{
    category: DecisionCategory;
    statement: string;
    status: DecisionStatus;
  }>;
  suggestedResearch?: string;
  canAdvanceToNextPhase: boolean;
  isReadyForValidation: boolean;
  nextRecommendedPhase?: DiscoveryPhase;
}

export class DiscoveryService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private memoryService: MemoryService,
    private aiProvider: IAIProvider
  ) {}

  /**
   * Process a user turn in an active project discovery session with phase-aware intelligence
   */
  async processUserMessage(
    projectId: string,
    sessionId: string,
    userMessage: string
  ): Promise<DiscoveryReply> {
    // 1. Ambil data project dan fase saat ini
    const { data: project } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const currentPhase: DiscoveryPhase = project.current_phase || 'PHASE_1_IDEA';
    const phaseMeta = getPhaseMetadata(currentPhase);

    // 2. Fetch structured decisions
    const existingDecisions = await this.memoryService.getDecisionsByProject(projectId);
    const structuredMemoryContext = this.memoryService.formatDecisionsForPrompt(existingDecisions);

    // 3. Fetch recent conversation turns (last 2 turns for context pruning to optimize latency & tokens)
    const { data: recentMsgs } = await (this.supabase as any)
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(3);

    const history: AIChatMessage[] = ((recentMsgs || []) as any[])
      .reverse()
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

    // 4. Save incoming user message
    await (this.supabase as any).from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content: userMessage,
    });

    // 5. Construct phase-aware System Prompt
    const phaseInstruction = getPhasePromptInstruction(currentPhase, project.title, project.summary || '');

    const systemPrompt = `Anda adalah AI Product Architect & Senior Product Leader kelas dunia.
Anda membimbing pengguna merancang arsitektur produk website atau aplikasi melalui 8 fase terarah:
1. Idea Discovery
2. Product Discovery & Scope
3. Requirements & User Flow
4. UI/UX & Design Direction (Anti-Slop, No generic AI dashboards)
5. Technical Architecture & Data Model (DB Schema, API Specs)
6. Security Architecture & OWASP Top 10 (Access Control, Injection, Cryptography)
7. Pre-Flight Validation & Approval
8. PRD Generation (29 Seksi Standar)

SAAT INI ANDA SEDANG BERADA PADA:
Fase ${phaseMeta.number}/8: ${phaseMeta.title}

INSTRUKSI KHUSUS FASE INI:
${phaseInstruction}

SUMBER KEBENARAN SAAT INI (STRUCTURED MEMORY):
${structuredMemoryContext}

ATURAN INTERAKSI KETAT:
1. Tanggapi dengan bahasa Indonesia profesional, empatik, tajam, ringkas, dan to-the-point.
2. JANGAN tanyakan lebih dari SATU pertanyaan inti per pesan. Pengguna Telegram membutuhkan interaksi yang fokus dan tidak melelahkan.
3. JANGAN mengulang pertanyaan yang sudah dijawab di Structured Memory atau riwayat sebelumnya.
4. Jika pengguna belum yakin, berikan rekomendasi cerdas dan berbobot (tandai status sebagai 'SUGGESTED').
5. Ekstrak setiap fakta/keputusan baru dari jawaban pengguna ke dalam 'identifiedDecisions'.
6. Evaluasi apakah aspek-aspek kunci pada fase ini (${phaseMeta.keyAspects.join(', ')}) sudah cukup dipahami untuk bisa lanjut ke fase berikutnya ('canAdvanceToNextPhase': true/false).
7. Jika sudah di Fase 6 atau 7 dan seluruh fondasi lengkap, tandai 'isReadyForValidation': true.

Format JSON yang WAJIB dihasilkan:
{
  "assistantResponse": "Balasan Telegram Anda (gunakan Markdown rapi, jelaskan konteks secara ramah dan ringkas)",
  "question": {
    "id": "slug_singkat_pertanyaan (misal: platform_type, core_features, user_roles, design_style, backend_stack)",
    "question": "Kalimat pertanyaan interaktif terarah yang diajukan",
    "multiSelect": boolean (true jika memungkinkan memilih beberapa fitur/opsi sekaligus, false jika pilihan tunggal),
    "allowCustom": true,
    "allowSkip": boolean (true hanya untuk pertanyaan pendukung opsional, false untuk aspek wajib),
    "aiRecommendation": "Penjelasan singkat rekomendasi terbaik menurut AI berdasarkan konteks proyek",
    "options": [
      {
        "id": "opt_1",
        "label": "Teks opsi ringkas dan jelas (max 30 karakter agar muat di tombol)"
      },
      {
        "id": "opt_2",
        "label": "Teks opsi ringkas dan jelas"
      },
      {
        "id": "opt_3",
        "label": "Teks opsi ringkas dan jelas"
      }
    ]
  },
  "identifiedDecisions": [
    {
      "category": "PRODUCT_OVERVIEW | PROBLEM_STATEMENT | TARGET_USERS | USER_ROLES | CORE_FLOW | FUNCTIONAL_REQUIREMENTS | FEATURE_SPECS | UI_UX_DESIGN_SYSTEM | PAGE_SPECIFICATIONS | DATA_REQUIREMENTS | NON_FUNCTIONAL_REQUIREMENTS | TECH_STACK | API_SPECIFICATIONS | SECURITY_OWASP | ERROR_EDGE_CASES | MVP_SCOPE | ACCEPTANCE_CRITERIA | FUTURE_ROADMAP | ASSUMPTION",
      "statement": "Ringkasan keputusan yang jelas dan spesifik",
      "status": "CONFIRMED | SUGGESTED | UNKNOWN | OUT_OF_SCOPE"
    }
  ],
  "suggestedResearch": "Topik riset on-demand jika perlu, atau null jika tidak ada",
  "canAdvanceToNextPhase": boolean,
  "isReadyForValidation": boolean,
  "nextRecommendedPhase": "${phaseMeta.nextPhase || 'PHASE_8_PRD_READY'}"
}`;

    const promptMessages: AIChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const result = await this.aiProvider.chatStructured<DiscoveryReply>(
      promptMessages,
      'Valid JSON matching DiscoveryReply schema'
    );

    const reply = result.data;
    reply.phase = currentPhase;
    reply.phaseNumber = phaseMeta.number;
    reply.phaseTitle = phaseMeta.title;

    // 6. Save AI assistant message to DB
    await (this.supabase as any).from('messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: reply.assistantResponse,
      metadata: {
        phase: currentPhase,
        decisionsExtracted: reply.identifiedDecisions?.length ?? 0,
        canAdvance: reply.canAdvanceToNextPhase,
        isReadyForValidation: reply.isReadyForValidation,
      },
    });

    // 7. Update Structured Memory in background
    if (reply.identifiedDecisions && Array.isArray(reply.identifiedDecisions)) {
      for (const dec of reply.identifiedDecisions) {
        try {
          await this.memoryService.upsertDecision({
            projectId,
            category: dec.category,
            statement: dec.statement,
            status: dec.status,
            sourceReference: `Discovery Phase ${phaseMeta.number}`,
          });
        } catch (err) {
          logger.error({ err, dec }, 'Failed to persist extracted decision');
        }
      }
    }

    // 8. Update current interactive question in project phase_data
    if (reply.question) {
      reply.question.selectedOptionIds = [];
      const currentPhaseData = project.phase_data || {};
      await (this.supabase as any)
        .from('projects')
        .update({
          phase_data: {
            ...currentPhaseData,
            activeQuestion: reply.question,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);
    }

    // 8. Update session timestamp
    await (this.supabase as any)
      .from('discovery_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);

    return reply;
  }

  /**
   * Manually transition project to a specific discovery phase
   */
  async advancePhase(projectId: string, targetPhase: DiscoveryPhase): Promise<DiscoveryPhase> {
    const { data: project } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    const currentPhaseData = project?.phase_data || {};
    // Bersihkan activeQuestion sebelumnya agar AI merancang pertanyaan segar untuk fase baru
    delete currentPhaseData.activeQuestion;

    await (this.supabase as any)
      .from('projects')
      .update({
        current_phase: targetPhase,
        phase_data: currentPhaseData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    // Sync active session if exists
    await (this.supabase as any)
      .from('discovery_sessions')
      .update({
        current_phase: targetPhase,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', projectId);

    logger.info({ projectId, targetPhase }, 'Advanced project discovery phase');
    return targetPhase;
  }

  /**
   * Fast-Track / Express Discovery:
   * AI analyzes the project concept, automatically synthesizes solid architecture & OWASP decisions,
   * and brings the project directly to Phase 7 (Validation & Approval) in a single high-speed turn.
   */
  async fastTrackDiscovery(projectId: string): Promise<{ success: boolean; decisionsCount: number }> {
    const { data: project } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (!project) throw new Error(`Project not found: ${projectId}`);

    const existingDecisions = await this.memoryService.getDecisionsByProject(projectId);
    const existingContext = this.memoryService.formatDecisionsForPrompt(existingDecisions);

    const prompt = `Anda adalah Principal Product Architect & Tech Lead.
Pengguna menginginkan jalur cepat (Fast-Track) untuk proyek: "${project.title}"
Deskripsi Ide: "${project.summary || project.title}"

Keputusan yang sudah ada sejauh ini:
${existingContext || 'Belum ada keputusan tersimpan'}

Tugas Anda:
Sintesiskan secara otomatis keputusan arsitektur terbaik, terukur, dan aman untuk aspek-aspek yang masih kosong:
1. Target User & Persona
2. MVP Core Scope (3-5 fitur inti)
3. User Roles (RBAC) & Main Flow
4. UI/UX Design Direction (Aesthetic, Palette, Layout anti-slop)
5. Tech Stack (Frontend, Backend, PostgreSQL DB, Auth)
6. Security & OWASP Top 10 (Access control, injection defense, secrets, audit log)

Format output JSON WAJIB:
{
  "synthesizedDecisions": [
    {
      "category": "TARGET_USERS | MVP_SCOPE | USER_ROLES | CORE_FLOW | UI_UX_DESIGN_SYSTEM | TECH_STACK | SECURITY_OWASP",
      "statement": "Pernyataan keputusan konkret dan spesifik",
      "status": "CONFIRMED"
    }
  ],
  "summary": "Ringkasan cepat arsitektur produk yang dihasilkan secara otomatis"
}`;

    const res = await this.aiProvider.chatStructured<{
      synthesizedDecisions: Array<{
        category: DecisionCategory;
        statement: string;
        status: DecisionStatus;
      }>;
      summary: string;
    }>([{ role: 'user', content: prompt }], 'Valid JSON matching fast-track schema');

    let count = 0;
    if (res.data?.synthesizedDecisions && Array.isArray(res.data.synthesizedDecisions)) {
      for (const dec of res.data.synthesizedDecisions) {
        await this.memoryService.upsertDecision({
          projectId,
          category: dec.category,
          statement: dec.statement,
          status: dec.status,
          sourceReference: 'Fast-Track AI Synthesis',
        });
        count++;
      }
    }

    // Advance project directly to PHASE_7_VALIDATION
    await this.advancePhase(projectId, 'PHASE_7_VALIDATION');

    return { success: true, decisionsCount: count };
  }
}
