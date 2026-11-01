import { SupabaseClient } from '@supabase/supabase-js';
import { Database, DecisionCategory, DecisionStatus, ProductDecisionRow } from '../../db/types.js';
import { logger } from '../../config/logger.js';

export type DecisionRecord = ProductDecisionRow;

export interface UpsertDecisionInput {
  projectId: string;
  category: DecisionCategory;
  statement: string;
  status: DecisionStatus;
  sourceReference?: string;
}

export class MemoryService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Upsert a structured product decision
   */
  async upsertDecision(input: UpsertDecisionInput): Promise<DecisionRecord> {
    const now = new Date().toISOString();
    const confirmedAt = input.status === 'CONFIRMED' ? now : null;

    // Check if an existing decision with same project and statement exists
    const { data: existing } = await (this.supabase as any)
      .from('product_decisions')
      .select('*')
      .eq('project_id', input.projectId)
      .eq('category', input.category)
      .eq('statement', input.statement)
      .maybeSingle();

    if (existing) {
      const { data, error } = await (this.supabase as any)
        .from('product_decisions')
        .update({
          status: input.status,
          source_reference: input.sourceReference ?? existing.source_reference,
          confirmed_at: confirmedAt ?? existing.confirmed_at,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        logger.error({ error, decisionId: existing.id }, 'Failed to update decision');
        throw error;
      }
      return data as DecisionRecord;
    }

    const { data, error } = await (this.supabase as any)
      .from('product_decisions')
      .insert({
        project_id: input.projectId,
        category: input.category,
        statement: input.statement,
        status: input.status,
        source_reference: input.sourceReference ?? null,
        confirmed_at: confirmedAt,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, projectId: input.projectId }, 'Failed to insert decision');
      throw error;
    }

    return data as DecisionRecord;
  }

  /**
   * Get all structured decisions for a project
   */
  async getDecisionsByProject(projectId: string): Promise<DecisionRecord[]> {
    const { data, error } = await (this.supabase as any)
      .from('product_decisions')
      .select('*')
      .eq('project_id', projectId)
      .order('category', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      logger.error({ error, projectId }, 'Failed to fetch project decisions');
      throw error;
    }

    return (data || []) as DecisionRecord[];
  }

  /**
   * Format structured memory into readable context for AI prompt
   */
  formatDecisionsForPrompt(decisions: DecisionRecord[]): string {
    if (decisions.length === 0) {
      return 'Belum ada keputusan terstruktur yang tersimpan.';
    }

    const grouped: Record<DecisionStatus, DecisionRecord[]> = {
      CONFIRMED: [],
      SUGGESTED: [],
      UNKNOWN: [],
      OUT_OF_SCOPE: [],
    };

    for (const d of decisions) {
      if (grouped[d.status]) {
        grouped[d.status].push(d);
      }
    }

    const sections: string[] = [];

    if (grouped.CONFIRMED.length > 0) {
      sections.push(
        '### [CONFIRMED DECISIONS - Sumber Kebenaran]\n' +
          grouped.CONFIRMED.map((d) => `• [${d.category}] ${d.statement}`).join('\n')
      );
    }

    if (grouped.SUGGESTED.length > 0) {
      sections.push(
        '### [SUGGESTED / REKOMENDASI AI - Belum Disetujui Pengguna]\n' +
          grouped.SUGGESTED.map((d) => `• [${d.category}] ${d.statement}`).join('\n')
      );
    }

    if (grouped.UNKNOWN.length > 0) {
      sections.push(
        '### [UNKNOWN / INFORMASI BELUM JELAS]\n' +
          grouped.UNKNOWN.map((d) => `• [${d.category}] ${d.statement}`).join('\n')
      );
    }

    if (grouped.OUT_OF_SCOPE.length > 0) {
      sections.push(
        '### [OUT OF SCOPE / DITUNDA]\n' +
          grouped.OUT_OF_SCOPE.map((d) => `• [${d.category}] ${d.statement}`).join('\n')
      );
    }

    return sections.join('\n\n');
  }
}
