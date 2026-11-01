import { describe, it, expect, vi } from 'vitest';
import { DiscoveryService } from '../src/modules/discovery/discovery.service.js';
import { IAIProvider } from '../src/ai/provider.interface.js';

describe('DiscoveryService & Hybrid Questions', () => {
  it('processes user message, queries structured memory, and upserts new decisions', async () => {
    const mockMemoryService = {
      getDecisionsByProject: vi.fn().mockResolvedValue([]),
      formatDecisionsForPrompt: vi.fn().mockReturnValue('Empty memory context'),
      upsertDecision: vi.fn().mockResolvedValue({}),
    };

    const mockMessagesInsert = vi.fn().mockResolvedValue({});
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [] }),
                }),
              }),
            }),
            insert: mockMessagesInsert,
          };
        }
        if (table === 'discovery_sessions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({}),
            }),
          };
        }
        return {};
      }),
    };

    const mockAiProvider: IAIProvider = {
      name: 'mock-ai',
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({
        data: {
          assistantResponse: 'Bagus sekali! Siapa target audiens utama aplikasi ini?',
          identifiedDecisions: [
            {
              category: 'PRODUCT_OVERVIEW',
              statement: 'Platform asisten ide produk',
              status: 'CONFIRMED',
            },
          ],
          isReadyForPRD: false,
        },
        usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25, model: 'mock', provider: 'mock' },
      }),
    };

    const discoveryService = new DiscoveryService(
      mockSupabase as any,
      mockMemoryService as any,
      mockAiProvider
    );

    const reply = await discoveryService.processUserMessage(
      'proj-123',
      'session-456',
      'Saya ingin membuat platform asisten ide produk'
    );

    expect(reply.assistantResponse).toContain('Siapa target audiens utama');
    expect(mockMemoryService.upsertDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-123',
        category: 'PRODUCT_OVERVIEW',
        status: 'CONFIRMED',
      })
    );
    expect(mockMessagesInsert).toHaveBeenCalledTimes(2); // user message and assistant response
  });
});

