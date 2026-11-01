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
   * Create a new project, preventing duplicate titles for the same user
   */
  async createProject(input: CreateProjectInput): Promise<{ project: ProjectItem; isExisting: boolean }> {
    const cleanTitle = input.title.trim().slice(0, 150);

    // 1. Cek apakah proyek dengan nama sama sudah pernah dibuat
    const existing = await this.findProjectByTitle(input.userId, cleanTitle);
    if (existing) {
      logger.info({ projectId: existing.id, title: cleanTitle }, 'Reusing existing project with identical name');
      
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
}
