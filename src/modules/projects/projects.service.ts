import { SupabaseClient } from '@supabase/supabase-js';
import { Database, ProjectStatus, ProjectRow } from '../../db/types.js';
import { logger } from '../../config/logger.js';

export interface CreateProjectInput {
  userId: string;
  ideaId?: string;
  title: string;
  summary?: string;
}

export type ProjectItem = ProjectRow;

export class ProjectsService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Find an existing project with the same title for this user
   */
  async findProjectByTitle(userId: string, title: string): Promise<ProjectItem | null> {
    const cleanTitle = title.trim();
    const { data } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .ilike('title', cleanTitle)
      .maybeSingle();

    return data || null;
  }

  /**
   * Find an existing project linked to a specific idea
   */
  async findProjectByIdeaId(userId: string, ideaId: string): Promise<ProjectItem | null> {
    const { data } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .eq('idea_id', ideaId)
      .maybeSingle();

    return data || null;
  }

  /**
   * Create a new project, preventing duplicate titles for the same user
   */
  async createProject(input: CreateProjectInput): Promise<{ project: ProjectItem; isExisting: boolean }> {
    const cleanTitle = input.title.trim().slice(0, 150);

    // 1. Cek apakah proyek dari ide ini atau dengan nama sama sudah pernah dibuat
    let existing: ProjectItem | null = null;
    if (input.ideaId) {
      existing = await this.findProjectByIdeaId(input.userId, input.ideaId);
    }
    if (!existing) {
      existing = await this.findProjectByTitle(input.userId, cleanTitle);
    }

    if (existing) {
      logger.info({ projectId: existing.id, title: cleanTitle }, 'Reusing existing project with identical name or idea');

      // Aktifkan proyek ini (perbarui updated_at dan hubungkan idea_id jika belum terhubung)
      const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
      if (input.ideaId && !existing.idea_id) {
        updatePayload.idea_id = input.ideaId;
      }
      await (this.supabase as any)
        .from('projects')
        .update(updatePayload)
        .eq('id', existing.id)
        .eq('user_id', input.userId);

      // Jika berasal dari ide, tetap tandai ide sebagai converted
      if (input.ideaId) {
        await (this.supabase as any)
          .from('ideas')
          .update({ status: 'CONVERTED_TO_PROJECT', updated_at: new Date().toISOString() })
          .eq('id', input.ideaId)
          .eq('user_id', input.userId);
      }

      return { project: existing, isExisting: true };
    }

    // 2. Buat proyek baru jika belum ada
    const { data, error } = await (this.supabase as any)
      .from('projects')
      .insert({
        user_id: input.userId,
        idea_id: input.ideaId ?? null,
        title: cleanTitle,
        summary: input.summary ?? null,
        status: 'DISCOVERY',
        current_phase: 'PHASE_1_IDEA',
        is_locked: false,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, userId: input.userId }, 'Failed to create project');
      throw error;
    }

    // Automatically create initial discovery session
    const { data: session, error: sessionError } = await (this.supabase as any)
      .from('discovery_sessions')
      .insert({
        project_id: data.id,
        status: 'ACTIVE',
        current_phase: 'PHASE_1_IDEA',
        questions_count: 0,
      })
      .select()
      .single();

    if (sessionError) {
      logger.error({ error: sessionError, projectId: data.id }, 'Failed to create discovery session');
    } else {
      await (this.supabase as any)
        .from('projects')
        .update({ active_session_id: session.id })
        .eq('id', data.id);
      data.active_session_id = session.id;
    }

    // If converted from an idea, mark idea status
    if (input.ideaId) {
      await (this.supabase as any)
        .from('ideas')
        .update({ status: 'CONVERTED_TO_PROJECT', updated_at: new Date().toISOString() })
        .eq('id', input.ideaId)
        .eq('user_id', input.userId);
    }

    logger.info({ projectId: data.id, userId: input.userId }, 'Created new product project');
    return { project: data as ProjectItem, isExisting: false };
  }

  /**
   * List all projects for a user
   */
  async listProjects(userId: string, status?: ProjectStatus): Promise<ProjectItem[]> {
    let query = (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
      logger.error({ error, userId }, 'Failed to list projects');
      throw error;
    }

    return (data || []) as ProjectItem[];
  }

  /**
   * Get single project by ID
   */
  async getProjectById(id: string, userId: string): Promise<ProjectItem | null> {
    const { data, error } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error({ error, projectId: id, userId }, 'Failed to get project by id');
      throw error;
    }

    return (data as ProjectItem) || null;
  }

  /**
   * Get active project for discovery (most recently updated active project)
   */
  async getActiveProject(userId: string): Promise<ProjectItem | null> {
    const { data, error } = await (this.supabase as any)
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['DISCOVERY', 'PRD_DRAFTING', 'REVISING'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ error, userId }, 'Failed to get active project');
      throw error;
    }

    return (data as ProjectItem) || null;
  }

  /**
   * Set lock status to prevent concurrent discoveries
   */
  async setProjectLock(projectId: string, isLocked: boolean): Promise<void> {
    await (this.supabase as any)
      .from('projects')
      .update({ is_locked: isLocked, updated_at: new Date().toISOString() })
      .eq('id', projectId);
  }

  /**
   * Delete a project with strict user authorization and safe cleanup
   */
  async deleteProject(id: string, userId: string): Promise<{ success: boolean; projectTitle: string }> {
    // 1. Verifikasi kepemilikan proyek
    const project = await this.getProjectById(id, userId);
    if (!project) {
      throw new Error('Proyek tidak ditemukan atau Anda tidak memiliki akses untuk menghapusnya.');
    }

    // 2. Putuskan self-referencing FK constraints (active_session_id) untuk mencegah constraint deadlocks
    await (this.supabase as any)
      .from('projects')
      .update({ active_session_id: null })
      .eq('id', id)
      .eq('user_id', userId);

    // 3. Putuskan current_version_id pada prd_documents jika ada
    await (this.supabase as any)
      .from('prd_documents')
      .update({ current_version_id: null })
      .eq('project_id', id);

    // 4. Hapus data validasi PRD
    await (this.supabase as any)
      .from('prd_validations')
      .delete()
      .eq('project_id', id);

    // 5. Hapus keputusan produk (structured memory)
    await (this.supabase as any)
      .from('product_decisions')
      .delete()
      .eq('project_id', id);

    // 6. Hapus sessions & messages
    const { data: sessions } = await (this.supabase as any)
      .from('discovery_sessions')
      .select('id')
      .eq('project_id', id);

    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s: any) => s.id);
      await (this.supabase as any)
        .from('messages')
        .delete()
        .in('session_id', sessionIds);

      await (this.supabase as any)
        .from('discovery_sessions')
        .delete()
        .eq('project_id', id);
    }

    // 7. Hapus prd_documents & versions
    const { data: prdDoc } = await (this.supabase as any)
      .from('prd_documents')
      .select('id')
      .eq('project_id', id)
      .maybeSingle();

    if (prdDoc) {
      const { data: versions } = await (this.supabase as any)
        .from('prd_versions')
        .select('id')
        .eq('prd_document_id', prdDoc.id);

      if (versions && versions.length > 0) {
        const versionIds = versions.map((v: any) => v.id);
        await (this.supabase as any)
          .from('document_exports')
          .delete()
          .in('prd_version_id', versionIds);

        await (this.supabase as any)
          .from('prd_versions')
          .delete()
          .eq('prd_document_id', prdDoc.id);
      }

      await (this.supabase as any)
        .from('prd_documents')
        .delete()
        .eq('id', prdDoc.id);
    }

    // 8. Hapus entitas proyek utama
    const { error } = await (this.supabase as any)
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      logger.error({ error, projectId: id, userId }, 'Failed to delete project');
      throw error;
    }

    // 9. Jika proyek berasal dari ide di Idea Inbox, kembalikan status ide ke INBOX agar bisa dijadikan proyek lagi
    if (project.idea_id) {
      await (this.supabase as any)
        .from('ideas')
        .update({ status: 'INBOX', updated_at: new Date().toISOString() })
        .eq('id', project.idea_id)
        .eq('user_id', userId);
    }

    logger.info({ projectId: id, userId, title: project.title }, 'Successfully deleted project and its dependencies');
    return { success: true, projectTitle: project.title };
  }
}
