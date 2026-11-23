import { describe, it, expect, vi } from 'vitest';
import { PrdService, parsePRDSections } from '../src/modules/prd/prd.service.js';
import { IAIProvider } from '../src/ai/provider.interface.js';

describe('PrdService', () => {
  it('parses PRD sections correctly', () => {
    const markdown = `# Test PRD
Metadata...
---

## 1. Project Overview
Overview text here.

---

## 18. API Specifications
POST /api/checkout

---

## 20. Security Architecture & OWASP Compliance
Rate limiting rules.`;

    const parsed = parsePRDSections(markdown);
    expect(parsed.sections.length).toBe(3);
    expect(parsed.sections[0].number).toBe(1);
    expect(parsed.sections[0].title).toBe('Project Overview');
    expect(parsed.sections[1].number).toBe(18);
    expect(parsed.sections[1].title).toBe('API Specifications');
    expect(parsed.sections[2].number).toBe(20);
    expect(parsed.sections[2].title).toBe('Security Architecture & OWASP Compliance');
  });

  it('generates immutable PRD v1.0 and links to document', async () => {
    const mockMemoryService = {
      getDecisionsByProject: vi.fn().mockResolvedValue([
        { category: 'TARGET_USERS', statement: 'Indie makers', status: 'CONFIRMED' },
      ]),
      formatDecisionsForPrompt: vi.fn().mockReturnValue('TARGET_USERS: Indie makers'),
    };

    const mockAiProvider: IAIProvider = {
      name: 'mock',
      chat: vi.fn().mockResolvedValue({
        content: '## 1. Project Overview\nKonten seksi...\n',
        usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150, model: 'mock', provider: 'mock' },
      }),
      chatStructured: vi.fn(),
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
    expect(result.contentMarkdown).toContain('# Bot Produk — Product Requirements Document (PRD)');
    expect(result.contentMarkdown).toContain('## 1. Project Overview');
  });

  it('performs targeted surgical revision preserving unaffected sections 100%', async () => {
    const existingMarkdown = `# Bot Produk — Product Requirements Document (PRD)
- Document Version: v1.0
---

## 1. Project Overview
Teks original seksi 1 yang sangat berharga dan tidak boleh hilang.

---

## 18. API Specifications
Endpoint lama belum ada proteksi checkout.

---

## 20. Security Architecture & OWASP Compliance
Belum ada rate limiting.`;

    const mockMemoryService = {
      getDecisionsByProject: vi.fn().mockResolvedValue([]),
      formatDecisionsForPrompt: vi.fn().mockReturnValue(''),
    };

    const mockAiProvider: IAIProvider = {
      name: 'mock',
      chat: vi.fn().mockImplementation(async (messages: any[]) => {
        const userPrompt = messages[1]?.content || '';
        if (userPrompt.includes('Tentukan nomor seksi')) {
          // identify affected sections
          return { content: '[18, 20]' };
        }
        if (userPrompt.includes('SEKSI 18')) {
          return { content: '## 18. API Specifications\nPOST /api/checkout [REVISI BARU OWASP RATE LIMIT]' };
        }
        if (userPrompt.includes('SEKSI 20')) {
          return { content: '## 20. Security Architecture & OWASP Compliance\nProteksi rate limiting 100 req/min aktif.' };
        }
        return { content: 'Revisi fallback' };
      }),
      chatStructured: vi.fn(),
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
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'doc-1', title: 'PRD: Bot Produk' },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({}),
            }),
          };
        }
        if (table === 'prd_versions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'ver-1',
                        version_number: 1,
                        content_markdown: existingMarkdown,
                      },
                    }),
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'ver-2', version_number: 2 },
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

    const result = await prdService.generateOrRevisePRD(
      'proj-1',
      'Pertegas endpoint API untuk checkout dan tambahkan proteksi rate limiting OWASP'
    );

    expect(result.versionNumber).toBe(2);
    // Unaffected section 1 must be strictly preserved!
    expect(result.contentMarkdown).toContain('Teks original seksi 1 yang sangat berharga dan tidak boleh hilang.');
    // Affected sections 18 and 20 must be updated!
    expect(result.contentMarkdown).toContain('POST /api/checkout [REVISI BARU OWASP RATE LIMIT]');
    expect(result.contentMarkdown).toContain('Proteksi rate limiting 100 req/min aktif.');
    expect(result.affectedSections).toEqual([18, 20]);
  });
});

