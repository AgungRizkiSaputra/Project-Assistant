import { FastifyInstance } from 'fastify';
import { webhookCallback } from 'grammy';
import { createAssistantApp } from '../src/app.js';
import { logger } from '../src/config/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';

let appPromise: Promise<FastifyInstance> | null = null;

async function bootstrapServerless(): Promise<FastifyInstance> {
  const { bot, apiApp } = createAssistantApp();

  // Root fallback to serve index.html if routed to serverless
  apiApp.get('/', async (_req, reply) => {
    try {
      const indexPath = path.join(process.cwd(), 'public', 'index.html');
      const html = await fs.readFile(indexPath, 'utf-8');
      return reply.type('text/html').send(html);
    } catch {
      return reply.type('text/html').send('<!DOCTYPE html><html><body><h3>Project Assistant</h3></body></html>');
    }
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

  // Health check endpoint with environment diagnostic
  apiApp.get('/api/health', async () => ({
    status: 'ok',
    mode: 'vercel-serverless',
    timestamp: new Date().toISOString(),
    env_configured: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_ALLOWED_USER_IDS: !!process.env.TELEGRAM_ALLOWED_USER_IDS,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    },
  }));

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

    // Collect request body chunks
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const payload = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    // Execute through Fastify inject
    const response = await app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload,
    });

    for (const [key, val] of Object.entries(response.headers)) {
      if (val !== undefined) {
        res.setHeader(key, val as any);
      }
    }
    res.statusCode = response.statusCode;
    res.end(response.rawPayload);
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
