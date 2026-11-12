import { describe, it, expect, vi } from 'vitest';
import { QualityValidatorService } from '../src/modules/discovery/quality-validator.service.js';
import { IAIProvider } from '../src/ai/provider.interface.js';

describe('QualityValidatorService', () => {
  it('evaluates readiness and generates pre-flight report', async () => {
    const mockMemoryService = {
      getDecisionsByProject: vi.fn().mockResolvedValue([
        { category: 'TARGET_USERS', statement: 'Developer', status: 'CONFIRMED' },
        { category: 'SECURITY_OWASP', statement: 'Strict RBAC on all endpoints', status: 'CONFIRMED' },
      ]),
      formatDecisionsForPrompt: vi.fn().mockReturnValue('Mock context'),
    };

    const mockAiProvider: IAIProvider = {
      name: 'gemini',
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({
        data: {
          overallScore: 88,
          isReadyForGeneration: true,
          findings: [
            {
              dimension: 'Requirements Completeness',
              status: 'PASSED',
              feedback: 'Requirements terdefinisi dengan sangat baik.',
            },
          ],
          unresolvedGaps: [],
          summaryMessage: 'Proyek siap untuk generate PRD 29 seksi.',
        },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gemini', provider: 'gemini' },
      }),
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'p1', title: 'Marketplace App', summary: 'App summary' },
                }),
              }),
            }),
          };
        }
        if (table === 'prd_validations') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    };

    const validator = new QualityValidatorService(
      mockSupabase as any,
      mockMemoryService as any,
      mockAiProvider
    );

    const report = await validator.validateProjectReadiness('p1');
    expect(report.overallScore).toBe(88);
    expect(report.isReadyForGeneration).toBe(true);
    expect(report.findings[0].dimension).toBe('Requirements Completeness');
  });
});

