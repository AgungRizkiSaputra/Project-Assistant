import { describe, it, expect, vi } from 'vitest';
import { IdeasService } from '../src/modules/ideas/ideas.service.js';

describe('IdeasService', () => {
  it('creates an idea and trims content', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'mock-idea-uuid',
            user_id: 'user-uuid',
            title: 'Bot Asisten Produk',
            raw_content: 'Ide membuat bot telegram...',
            status: 'INBOX',
            tags: ['telegram', 'ai'],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: null,
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: mockInsert,
      }),
    };

    const service = new IdeasService(mockSupabase as any);
    const result = await service.createIdea({
      userId: 'user-uuid',
      title: '  Bot Asisten Produk  ',
      rawContent: '  Ide membuat bot telegram...  ',
      tags: ['telegram', 'ai'],
    });

    expect(result.id).toBe('mock-idea-uuid');
    expect(result.title).toBe('Bot Asisten Produk');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Bot Asisten Produk',
        raw_content: 'Ide membuat bot telegram...',
        status: 'INBOX',
      })
    );
  });
});

