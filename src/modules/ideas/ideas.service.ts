import { SupabaseClient } from '@supabase/supabase-js';
import { Database, IdeaStatus, IdeaRow } from '../../db/types.js';
import { logger } from '../../config/logger.js';

export interface CreateIdeaInput {
  userId: string;
  title: string;
  rawContent: string;
  tags?: string[];
}

export type IdeaItem = IdeaRow;

export class IdeasService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Capture a new raw product idea
   */
  async createIdea(input: CreateIdeaInput): Promise<IdeaItem> {
    const title = input.title.trim().slice(0, 120);
    const { data, error } = await (this.supabase as any)
      .from('ideas')
      .insert({
        user_id: input.userId,
        title: title || 'Untitled Idea',
        raw_content: input.rawContent.trim(),
        tags: input.tags ?? [],
        status: 'INBOX',
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, userId: input.userId }, 'Failed to create idea');
      throw error;
    }

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

    return (data || []) as IdeaItem[];
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

    return (data as IdeaItem) || null;
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

    // 2. Jika ide ini terhubung ke proyek, putuskan referensi idea_id di tabel projects (SET NULL)
    await (this.supabase as any)
      .from('projects')
      .update({ idea_id: null, updated_at: new Date().toISOString() })
      .eq('idea_id', id)
      .eq('user_id', userId);

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
