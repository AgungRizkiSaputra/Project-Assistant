import { SupabaseClient } from '@supabase/supabase-js';
import { Database, IdeaStatus, IdeaRow } from '../../db/types.js';
import { logger } from '../../config/logger.js';

export interface CreateIdeaInput {
  userId: string;
  title: string;
  rawContent: string;
  category?: string;
  tags?: string[];
}

export interface UpdateIdeaInput {
  title?: string;
  rawContent?: string;
  category?: string;
  status?: IdeaStatus;
  tags?: string[];
}

export type IdeaItem = IdeaRow;

export class IdeasService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Helper to encode category into tags if column doesn't exist
   */
  private formatTagsWithCategory(tags: string[] = [], category?: string): string[] {
    const cleanTags = tags.filter((t) => !t.startsWith('cat:'));
    if (category) {
      cleanTags.push(`cat:${category}`);
    }
    return cleanTags;
  }

  /**
   * Helper to extract category from tags
   */
  private extractCategoryFromTags(tags: string[] = []): string {
    const catTag = tags.find((t) => t.startsWith('cat:'));
    return catTag ? catTag.replace('cat:', '') : 'Other';
  }

  /**
   * Capture a new raw product idea
   */
  async createIdea(input: CreateIdeaInput): Promise<IdeaItem> {
    const title = input.title.trim().slice(0, 120);
    const tagsWithCat = this.formatTagsWithCategory(input.tags ?? [], input.category);

    const { data, error } = await (this.supabase as any)
      .from('ideas')
      .insert({
        user_id: input.userId,
        title: title || 'Untitled Idea',
        raw_content: input.rawContent.trim(),
        tags: tagsWithCat,
        status: 'INBOX',
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, userId: input.userId }, 'Failed to create idea');
      throw error;
    }

    // Attach virtual category property
    (data as any).category = this.extractCategoryFromTags(data.tags);

    logger.info({ ideaId: data.id, userId: input.userId }, 'Created new idea in inbox');
    return data as IdeaItem;
  }

  /**
   * List ideas for a user, optionally filtered by status
   */
  async listIdeas(userId: string, status?: IdeaStatus): Promise<IdeaItem[]> {
    let query = (this.supabase as any)
      .from('ideas')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
      logger.error({ error, userId }, 'Failed to list ideas');
      throw error;
    }

    const ideas = (data || []).map((i: any) => ({
      ...i,
      category: this.extractCategoryFromTags(i.tags),
    }));

    return ideas as IdeaItem[];
  }

  /**
   * Get single idea by ID
   */
  async getIdeaById(id: string, userId: string): Promise<IdeaItem | null> {
    const { data, error } = await (this.supabase as any)
      .from('ideas')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error({ error, ideaId: id, userId }, 'Failed to get idea by id');
      throw error;
    }

    if (!data) return null;
    (data as any).category = this.extractCategoryFromTags(data.tags);
    return data as IdeaItem;
  }

  /**
   * Update fields of an existing idea
   */
  async updateIdea(id: string, userId: string, input: UpdateIdeaInput): Promise<IdeaItem> {
    const existing = await this.getIdeaById(id, userId);
    if (!existing) {
      throw new Error('Ide tidak ditemukan');
    }

    const payload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (input.title !== undefined) payload.title = input.title.trim().slice(0, 120);
    if (input.rawContent !== undefined) payload.raw_content = input.rawContent.trim();
    if (input.status !== undefined) payload.status = input.status;

    if (input.tags !== undefined || input.category !== undefined) {
      const baseTags = input.tags !== undefined ? input.tags : (existing.tags || []);
      const targetCat = input.category !== undefined ? input.category : (existing as any).category;
      payload.tags = this.formatTagsWithCategory(baseTags, targetCat);
    }

    const { data, error } = await (this.supabase as any)
      .from('ideas')
      .update(payload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      logger.error({ error, ideaId: id }, 'Failed to update idea');
      throw error;
    }

    (data as any).category = this.extractCategoryFromTags(data.tags);
    return data as IdeaItem;
  }

  /**
   * Update status of an idea
   */
  async updateIdeaStatus(id: string, userId: string, status: IdeaStatus): Promise<IdeaItem> {
    const { data, error } = await (this.supabase as any)
      .from('ideas')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      logger.error({ error, ideaId: id, status }, 'Failed to update idea status');
      throw error;
    }

    return data as IdeaItem;
  }

  /**
   * Delete an idea with strict user ownership validation
   */
  async deleteIdea(id: string, userId: string): Promise<{ success: boolean; ideaTitle: string }> {
    // 1. Validasi keberadaan dan kepemilikan ide
    const idea = await this.getIdeaById(id, userId);
    if (!idea) {
      throw new Error('Ide tidak ditemukan atau Anda tidak memiliki akses untuk menghapusnya.');
    }

    // 2. Jika ide ini terhubung ke proyek, hapus juga proyek terkait dan seluruh riwayatnya
    const { data: allUserProjects } = await (this.supabase as any)
      .from('projects')
      .select('id, idea_id, title')
      .eq('user_id', userId);

    const linkedProjects = (allUserProjects || []).filter(
      (p: any) =>
        p.idea_id === id ||
        (p.title && idea.title && p.title.toLowerCase().trim() === idea.title.toLowerCase().trim())
    );

    if (linkedProjects.length > 0) {
      for (const p of linkedProjects) {
        // Hapus PRD versions dan documents
        const { data: docs } = await (this.supabase as any)
          .from('prd_documents')
          .select('id')
          .eq('project_id', p.id);
        if (docs && docs.length > 0) {
          const docIds = docs.map((d: any) => d.id);
          await (this.supabase as any).from('prd_versions').delete().in('prd_document_id', docIds);
          await (this.supabase as any).from('prd_documents').delete().in('id', docIds);
        }
        // Hapus decisions & discovery sessions
        await (this.supabase as any).from('product_decisions').delete().eq('project_id', p.id);
        await (this.supabase as any).from('discovery_sessions').delete().eq('project_id', p.id);
        // Hapus proyek
        await (this.supabase as any).from('projects').delete().eq('id', p.id).eq('user_id', userId);
      }
    }

    // 3. Hapus ide dari database
    const { error } = await (this.supabase as any)
      .from('ideas')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      logger.error({ error, ideaId: id, userId }, 'Failed to delete idea');
      throw error;
    }

    logger.info({ ideaId: id, userId, title: idea.title }, 'Successfully deleted idea');
    return { success: true, ideaTitle: idea.title };
  }
}
