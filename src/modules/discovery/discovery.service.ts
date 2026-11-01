import { SupabaseClient } from '@supabase/supabase-js';
import { Database, DecisionCategory, DecisionStatus } from '../../db/types.js';
import { IAIProvider, AIChatMessage } from '../../ai/provider.interface.js';
import { MemoryService } from '../memory/memory.service.js';
import { logger } from '../../config/logger.js';

export interface DiscoveryReply {
  assistantResponse: string;
  identifiedDecisions: Array<{
    category: DecisionCategory;
    statement: string;
    status: DecisionStatus;
  }>;
  suggestedResearch?: string;
  isReadyForPRD: boolean;
}

export class DiscoveryService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private memoryService: MemoryService,
    private aiProvider: IAIProvider
  ) {}

  /**
   * Process a user turn in an active project discovery session
   */
  async processUserMessage(
    projectId: string,
    sessionId: string,
    userMessage: string
  ): Promise<DiscoveryReply> {
    // 1. Fetch structured decisions
    const existingDecisions = await this.memoryService.getDecisionsByProject(projectId);
    const structuredMemoryContext = this.memoryService.formatDecisionsForPrompt(existingDecisions);

    // 2. Fetch recent conversation turns (last 8 messages)
    const { data: recentMsgs } = await (this.supabase as any)
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(8);

    const history: AIChatMessage[] = ((recentMsgs || []) as any[])
      .reverse()
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

    // 3. Save incoming user message
    await (this.supabase as any).from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content: userMessage,
    });

    // 4. Construct System Prompt for Hybrid PM Persona
    const systemPrompt = `Anda adalah Senior Product Manager pribadi yang bertugas melakukan discovery produk melalui percakapan Telegram.
Karakteristik & Aturan Anda:
1. Bersikap sebagai PM profesional, tajam, ringkas, dan empatik. Jangan bertele-tele dan hindari AI slop/basa-basi berlebihan.
2. Sumber utama kebenaran keputusan saat ini adalah Structured Memory berikut:
${structuredMemoryContext}

3. Aturan Tanya-Jawab Discovery:
- Analisis pesan terbaru dari pengguna.
- Identifikasi informasi apa yang baru dikonfirmasi atau diusulkan.
- JANGAN mengulang pertanyaan yang sudah terjawab di Structured Memory atau percakapan sebelumnya.
- Jika masih ada informasi inti yang belum jelas (misal: Target User, Masalah Inti, Core User Flow, atau MVP Scope), AJUKAN HANYA SATU PERTANYAAN TERFOKUS dalam respons Anda.
- Jangan menumpuk lebih dari satu pertanyaan sekaligus agar pengguna nyaman menjawab di Telegram.
- Jika pengguna membutuhkan saran, berikan rekomendasi opsional, tetapi kategorikan sebagai 'SUGGESTED' (bukan keputusan final sebelum disetujui).
- Jika ada topik riset kompetitor atau teknis yang kompleks di internet, usulkan 'suggestedResearch' secara sopan, jangan lakukan riset tanpa izin.
- Tentukan apakah informasi sudah cukup matang untuk menyusun PRD (isReadyForPRD: true/false).

Skema JSON yang HARUS Anda hasilkan:
{
  "assistantResponse": "Teks balasan Anda untuk pengguna Telegram (gunakan markdown rapi, pertahankan max 1 pertanyaan terarah)",
  "identifiedDecisions": [
    {
      "category": "PRODUCT_OVERVIEW | PROBLEM_STATEMENT | TARGET_USERS | USER_ROLES | CORE_FLOW | FUNCTIONAL_REQUIREMENTS | FEATURE_SPECS | UI_UX_REQUIREMENTS | DATA_REQUIREMENTS | NON_FUNCTIONAL_REQUIREMENTS | TECH_STACK | MVP_SCOPE | ACCEPTANCE_CRITERIA | FUTURE_ROADMAP | ASSUMPTION",
      "statement": "Ringkasan ringkas dan jelas dari keputusan",
      "status": "CONFIRMED | SUGGESTED | UNKNOWN | OUT_OF_SCOPE"
    }
  ],
  "suggestedResearch": "Topik riset on-demand jika perlu, atau null jika tidak ada",
  "isReadyForPRD": boolean
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

    // 5. Save AI assistant message to DB
    await (this.supabase as any).from('messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: reply.assistantResponse,
      metadata: {
        decisionsExtracted: reply.identifiedDecisions?.length ?? 0,
        isReadyForPRD: reply.isReadyForPRD,
      },
    });

    // 6. Update Structured Memory in background
    if (reply.identifiedDecisions && Array.isArray(reply.identifiedDecisions)) {
      for (const dec of reply.identifiedDecisions) {
        try {
          await this.memoryService.upsertDecision({
            projectId,
            category: dec.category,
            statement: dec.statement,
            status: dec.status,
            sourceReference: 'Discovery conversation',
          });
        } catch (err) {
          logger.error({ err, dec }, 'Failed to persist extracted decision');
        }
      }
    }

    // 7. Update session timestamp
    await (this.supabase as any)
      .from('discovery_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);

    return reply;
  }
}
