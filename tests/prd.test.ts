import { describe, it, expect, vi } from 'vitest';
import { PrdService } from '../src/modules/prd/prd.service.js';
import { IAIProvider } from '../src/ai/provider.interface.js';

describe('PrdService', () => {
  it('generates immutable PRD v1.0 and links to document', async () => {
    const mockMemoryService = {
      getDecisionsByProject: vi.fn().mockResolvedValue([
        { category: 'TARGET_USERS', statement: 'Indie makers', status: 'CONFIRMED' },
      ]),
      formatDecisionsForPrompt: vi.fn().mockReturnValue('TARGET_USERS: Indie makers'),
    };

    const mockAiProvider: IAIProvider = {
      name: 'mock',
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({
        data: {
          contentMarkdown: '# PRD Bot\n\n## 1. Product Overview\nSistem asisten...',
          changelogSummary: 'Initial PRD release v1.0',
        },
        usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150, model: 'mock', provider: 'mock' },
      }),
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'proj-1', title: 'Bot Produk', summary: 'Ide awal' },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({}),
            }),
          };
        }
        if (table === 'prd_documents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }), // no existing doc
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'doc-1' } }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({}),
            }),
          };
        }
        if (table === 'prd_versions') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'ver-1', version_number: 1 },
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const prdService = new PrdService(
      mockSupabase as any,
      mockMemoryService as any,
      mockAiProvider
    );

    const result = await prdService.generateOrRevisePRD('proj-1');

    expect(result.versionNumber).toBe(1);
    expect(result.contentMarkdown).toContain('# PRD Bot');
    expect(result.changelogSummary).toBe('Initial PRD release v1.0');
  });
});

