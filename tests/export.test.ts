import { describe, it, expect, vi } from 'vitest';
import { ExportService } from '../src/modules/export/export.service.js';
import fs from 'node:fs/promises';

describe('ExportService', () => {
  it('exports PRD to clean Markdown file and records to DB', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: mockInsert,
      }),
    };

    const exportService = new ExportService(mockSupabase as any);
    const title = 'Personal Product Assistant';
    const content = '# Personal Product Assistant PRD\n\n## 1. Overview\nBot Telegram AI.';

    const result = await exportService.exportToMarkdown('version-123', title, content);

    expect(result.fileName).toBe('personal_product_assistant.md');
    expect(result.mimeType).toBe('text/markdown');
    expect(result.sizeBytes).toBeGreaterThan(0);

    const savedContent = await fs.readFile(result.filePath, 'utf-8');
    expect(savedContent).toBe(content);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        prd_version_id: 'version-123',
        format: 'MARKDOWN',
        file_name: 'personal_product_assistant.md',
      })
    );
  });
});

