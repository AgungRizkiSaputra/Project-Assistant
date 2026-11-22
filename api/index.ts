import { FastifyInstance } from 'fastify';
import { webhookCallback } from 'grammy';
import { createAssistantApp } from '../src/bootstrap.js';
import { logger } from '../src/config/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';

let appPromise: Promise<FastifyInstance> | null = null;

async function serveIndexHtml(reply: any) {
  const candidates = [
    path.join(process.cwd(), 'index.html'),
    path.join(process.cwd(), 'public', 'index.html'),
  ];
  for (const p of candidates) {
    try {
      const html = await fs.readFile(p, 'utf-8');
      if (html) {
        return reply.type('text/html; charset=utf-8').send(html);
      }
    } catch {}
  }
  return reply
    .type('text/html; charset=utf-8')
    .send('<!DOCTYPE html><html><body><h3>Qoro — AI Product Architect</h3></body></html>');
}

async function bootstrapServerless(): Promise<FastifyInstance> {
  const { bot, apiApp } = createAssistantApp();

  // Root & SPA page endpoints
  apiApp.get('/', async (_req, reply) => serveIndexHtml(reply));
  apiApp.get('/index.html', async (_req, reply) => serveIndexHtml(reply));
  apiApp.get('/ideas', async (_req, reply) => serveIndexHtml(reply));
  apiApp.get('/projects', async (_req, reply) => serveIndexHtml(reply));
  apiApp.get('/assistant', async (_req, reply) => serveIndexHtml(reply));
  apiApp.get('/spinner', async (_req, reply) => serveIndexHtml(reply));

  // /api handler: if opened by browser, serve UI; if API client, return info
  apiApp.get('/api', async (req, reply) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/html') || !accept.includes('application/json')) {
      return serveIndexHtml(reply);
    }
    return { status: 'ok', service: 'Qoro API', version: '1.0.0' };
  });

  // Register Telegram Webhook handler for Vercel
  apiApp.post('/api/telegram-webhook', webhookCallback(bot, 'fastify'));

  // Quick Webhook registration helper: visit in browser to automatically configure webhook with Telegram
  apiApp.get('/api/telegram-webhook/setup', async (req, reply) => {
    try {
      const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const webhookUrl = `${proto}://${forwardedHost}/api/telegram-webhook`;
      const result = await bot.api.setWebhook(webhookUrl);
      return reply.send({
        success: true,
        message: 'Telegram Webhook configured successfully on Vercel!',
        webhookUrl,
        telegramResult: result,
      });
    } catch (err: any) {
      logger.error({ err }, 'Failed to set Telegram webhook');
      return reply.status(500).send({
        success: false,
        error: err.message || 'Unknown error configuring webhook',
      });
    }
  });

  // Webhook info inspector
  apiApp.get('/api/telegram-webhook/info', async (_req, reply) => {
    try {
      const info = await bot.api.getWebhookInfo();
      return reply.send({ success: true, webhookInfo: info });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Webhook delete helper (if needed to switch back to local polling)
  apiApp.get('/api/telegram-webhook/delete', async (_req, reply) => {
    try {
      const result = await bot.api.deleteWebhook();
      return reply.send({ success: true, telegramResult: result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Fallback handler for all static assets and SPA sub-routes
  apiApp.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `API route ${req.method} ${req.url} not found`,
      });
    }

    const cleanPath = req.url.split('?')[0];

    // Check if matching static file exists on disk
    if (cleanPath !== '/' && cleanPath !== '') {
      const staticCandidates = [
        path.join(process.cwd(), cleanPath),
        path.join(process.cwd(), 'public', cleanPath),
      ];
      for (const p of staticCandidates) {
        try {
          const stat = await fs.stat(p);
          if (stat.isFile()) {
            const ext = path.extname(p).toLowerCase();
            const mimeTypes: Record<string, string> = {
              '.js': 'application/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.html': 'text/html; charset=utf-8',
              '.json': 'application/json; charset=utf-8',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.ico': 'image/x-icon',
              '.svg': 'image/svg+xml',
            };
            const content = await fs.readFile(p);
            return reply.type(mimeTypes[ext] || 'application/octet-stream').send(content);
          }
        } catch {}
      }
    }

    // Default SPA fallback
    return serveIndexHtml(reply);
  });

  await apiApp.ready();
  return apiApp;
}

export default async function handler(req: any, res: any) {
  try {
    if (!appPromise) {
      appPromise = bootstrapServerless().catch((bootErr) => {
        appPromise = null;
        throw bootErr;
      });
    }
    const app = await appPromise;

    // Dispatch directly to Fastify's native Node.js HTTP listener without light-my-request
    await new Promise<void>((resolve, reject) => {
      res.on('finish', () => resolve());
      res.on('close', () => resolve());
      res.on('error', (err: any) => reject(err));
      app.server.emit('request', req, res);
    });
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        {
          error: 'SERVERLESS_INITIALIZATION_ERROR',
          message: err?.message || 'Serverless execution error',
          env_check: {
            SUPABASE_URL: !process.env.SUPABASE_URL ? 'MISSING' : 'CONFIGURED',
            SUPABASE_SERVICE_ROLE_KEY: !process.env.SUPABASE_SERVICE_ROLE_KEY ? 'MISSING' : 'CONFIGURED',
            TELEGRAM_BOT_TOKEN: !process.env.TELEGRAM_BOT_TOKEN ? 'MISSING' : 'CONFIGURED',
            TELEGRAM_ALLOWED_USER_IDS: !process.env.TELEGRAM_ALLOWED_USER_IDS ? 'MISSING' : 'CONFIGURED',
            GEMINI_API_KEY: !process.env.GEMINI_API_KEY ? 'MISSING' : 'CONFIGURED',
          },
          stack: err?.stack,
        },
        null,
        2
      )
    );
  }
}
