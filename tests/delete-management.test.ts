import { describe, it, expect, vi } from 'vitest';
import { IdeasService } from '../src/modules/ideas/ideas.service.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import { PrdService } from '../src/modules/prd/prd.service.js';

describe('Delete & Project Management Module', () => {
  it('deletes an idea with authorization and unlinks project references', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'ideas') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'idea-1', user_id: 'user-1', title: 'Ide Marketplace' },
                  }),
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [] }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const service = new IdeasService(mockSupabase as any);
    const result = await service.deleteIdea('idea-1', 'user-1');

    expect(result.success).toBe(true);
    expect(result.ideaTitle).toBe('Ide Marketplace');
  });

  it('deletes a project cleanly without leaving orphan records', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'proj-1', user_id: 'user-1', title: 'Aplikasi FinTech' },
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === 'prd_documents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (['discovery_sessions', 'product_decisions', 'prd_validations', 'messages', 'prd_versions', 'document_exports'].includes(table)) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [] }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
              in: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {};
      }),
    };

    const service = new ProjectsService(mockSupabase as any);
    const result = await service.deleteProject('proj-1', 'user-1');

    expect(result.success).toBe(true);
    expect(result.projectTitle).toBe('Aplikasi FinTech');
  });

  it('deletes an individual PRD version without deleting the parent project', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'proj-1', user_id: 'user-1', title: 'SaaS App' },
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'prd_documents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'doc-1', project_id: 'proj-1', current_version_id: 'ver-2' },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'prd_versions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === 'id') {
                  return {
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: 'ver-2', title: 'SaaS App v2.0', version_number: 2 },
                      }),
                    }),
                  };
                }
                if (col === 'prd_document_id') {
                  return {
                    order: vi.fn().mockResolvedValue({
                      data: [{ id: 'ver-1', title: 'SaaS App v1.0', version_number: 1 }],
                    }),
                  };
                }
                return {};
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'document_exports') {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {};
      }),
    };

    const prdService = new PrdService(mockSupabase as any, {} as any, {} as any);
    const result = await prdService.deletePRDVersion('ver-2', 'proj-1', 'user-1');

    expect(result.success).toBe(true);
    expect(result.versionTitle).toBe('SaaS App v2.0');
    expect(result.remainingVersionsCount).toBe(1);
  });

  it('resets linked idea status back to INBOX when its project is deleted', async () => {
    const ideaUpdateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'proj-2', user_id: 'user-1', idea_id: 'idea-2', title: 'Aplikasi Tabungan' },
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === 'ideas') {
          return { update: ideaUpdateMock };
        }
        if (table === 'prd_documents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [] }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
            in: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }),
    };

    const service = new ProjectsService(mockSupabase as any);
    const result = await service.deleteProject('proj-2', 'user-1');

    expect(result.success).toBe(true);
    expect(ideaUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'INBOX' })
    );
  });
});
