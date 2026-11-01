import { describe, it, expect, vi } from 'vitest';
import { MemoryService } from '../src/modules/memory/memory.service.js';

describe('MemoryService & Structured Decisions', () => {
  it('formats structured decisions by status correctly for AI prompt', () => {
    const memoryService = new MemoryService({} as any);

    const mockDecisions = [
      {
        id: '1',
        project_id: 'proj-1',
        category: 'TARGET_USERS' as const,
        statement: 'Solo founder dan indie hacker yang butuh PRD cepat',
        status: 'CONFIRMED' as const,
        source_reference: null,
        confirmed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '2',
        project_id: 'proj-1',
        category: 'TECH_STACK' as const,
        statement: 'Disarankan memakai Next.js dan Tailwind CSS',
        status: 'SUGGESTED' as const,
        source_reference: null,
        confirmed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '3',
        project_id: 'proj-1',
        category: 'DATA_REQUIREMENTS' as const,
        statement: 'Mekanisme payment gateway belum ditentukan',
        status: 'UNKNOWN' as const,
        source_reference: null,
        confirmed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '4',
        project_id: 'proj-1',
        category: 'MVP_SCOPE' as const,
        statement: 'Integrasi mobile app native ditunda',
        status: 'OUT_OF_SCOPE' as const,
        source_reference: null,
        confirmed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const formatted = memoryService.formatDecisionsForPrompt(mockDecisions);

    expect(formatted).toContain('### [CONFIRMED DECISIONS - Sumber Kebenaran]');
    expect(formatted).toContain('• [TARGET_USERS] Solo founder dan indie hacker');
    expect(formatted).toContain('### [SUGGESTED / REKOMENDASI AI - Belum Disetujui Pengguna]');
    expect(formatted).toContain('• [TECH_STACK] Disarankan memakai Next.js');
    expect(formatted).toContain('### [UNKNOWN / INFORMASI BELUM JELAS]');
    expect(formatted).toContain('• [DATA_REQUIREMENTS] Mekanisme payment gateway belum ditentukan');
    expect(formatted).toContain('### [OUT OF SCOPE / DITUNDA]');
    expect(formatted).toContain('• [MVP_SCOPE] Integrasi mobile app native ditunda');
  });
});

