import { chromium } from 'playwright';
import { marked } from 'marked';
import PDFDocument from 'pdfkit';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../db/types.js';
import { logger } from '../../config/logger.js';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ExportResult {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export class ExportService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private storageBucket = 'prd-exports'
  ) {}

  /**
   * Export PRD version as a clean Markdown (.md) file
   */
  async exportToMarkdown(
    versionId: string,
    title: string,
    markdownContent: string
  ): Promise<ExportResult> {
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const fileName = `${sanitizedTitle}.md`;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prd-md-'));
    const filePath = path.join(tempDir, fileName);

    await fs.writeFile(filePath, markdownContent, 'utf-8');
    const stats = await fs.stat(filePath);

    // Save record to document_exports
    await (this.supabase as any).from('document_exports').insert({
      prd_version_id: versionId,
      format: 'MARKDOWN',
      file_name: fileName,
      file_size_bytes: stats.size,
    });

    return {
      filePath,
      fileName,
      mimeType: 'text/markdown',
      sizeBytes: stats.size,
    };
  }

  /**
   * Fast, reliable native Node.js PDF generator (fallback-safe without Chromium hang)
   */
  private async exportToNativePdf(
    filePath: string,
    title: string,
    markdownContent: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: { Title: title, Author: 'Personal Product Assistant' },
      });

      const stream = createWriteStream(filePath);
      doc.pipe(stream);

      // Title header
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#0f172a').text(title, { align: 'left' });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Generated on ${new Date().toLocaleDateString('id-ID')} | Personal Product Assistant`);
      doc.moveDown(1);
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // Simple Markdown line parser
      const lines = markdownContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          doc.moveDown(0.3);
          continue;
        }

        if (trimmed.startsWith('# ')) {
          doc.moveDown(0.8);
          doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(trimmed.replace(/^#\s+/, ''));
          doc.moveDown(0.2);
        } else if (trimmed.startsWith('## ')) {
          doc.moveDown(0.6);
          doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e293b').text(trimmed.replace(/^##\s+/, ''));
          doc.moveDown(0.2);
        } else if (trimmed.startsWith('### ')) {
          doc.moveDown(0.4);
          doc.fontSize(11).font('Helvetica-Bold').fillColor('#334155').text(trimmed.replace(/^###\s+/, ''));
          doc.moveDown(0.2);
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
          doc.fontSize(10).font('Helvetica').fillColor('#334155').text(`  •  ${trimmed.replace(/^[-*•]\s+/, '')}`, { lineGap: 2 });
        } else {
          doc.fontSize(10).font('Helvetica').fillColor('#334155').text(trimmed, { lineGap: 3 });
        }
      }

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  /**
   * Export PRD version to PDF with fast native fallback
   */
  async exportToPdf(
    versionId: string,
    title: string,
    markdownContent: string
  ): Promise<ExportResult> {
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const fileName = `${sanitizedTitle}.pdf`;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prd-pdf-'));
    const filePath = path.join(tempDir, fileName);

    let generated = false;

    // Try Playwright Chromium with 6s timeout; if timeout/fails, use instant Native PDF
    try {
      const browser = await Promise.race([
        chromium.launch({ headless: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Playwright launch timeout')), 6000)),
      ]);

      const page = await browser.newPage();
      const htmlBody = await marked.parse(markdownContent);
      await page.setContent(`<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 25px; line-height: 1.6;">${htmlBody}</body></html>`, { waitUntil: 'load' });
      await page.pdf({ path: filePath, format: 'A4', margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' } });
      await browser.close();
      generated = true;
    } catch (browserErr) {
      logger.warn({ browserErr }, 'Playwright launch skipped/timed out, switching to instant Native PDF renderer');
    }

    if (!generated) {
      await this.exportToNativePdf(filePath, title, markdownContent);
    }

    const stats = await fs.stat(filePath);

    // Record export in DB
    await (this.supabase as any).from('document_exports').insert({
      prd_version_id: versionId,
      format: 'PDF',
      file_name: fileName,
      file_size_bytes: stats.size,
    });

    return {
      filePath,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: stats.size,
    };
  }
}
