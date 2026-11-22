import { FastifyInstance } from 'fastify';
import { webhookCallback } from 'grammy';
import { createAssistantApp } from '../src/app.js';
import { logger } from '../src/config/logger.js';

let appPromise: Promise<FastifyInstance> | null = null;

async function bootstrapServerless(): Promise<FastifyInstance> {
  const { bot, apiApp } = createAssistantApp();

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
    env: {
      has_SUPABASE_URL: !!process.env.SUPABASE_URL,
      has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      has_TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      has_TELEGRAM_ALLOWED_USER_IDS: !!process.env.TELEGRAM_ALLOWED_USER_IDS,
      has_GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
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
    app.server.emit('request', req, res);
  } catch (err: any) {
    logger.error({ err }, 'Serverless handler execution failed');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        {
          error: 'SERVERLESS_INITIALIZATION_ERROR',
          message: err?.message || 'Failed to initialize serverless application',
          missing_env_check: {
            SUPABASE_URL: !process.env.SUPABASE_URL ? 'MISSING' : 'OK',
            SUPABASE_SERVICE_ROLE_KEY: !process.env.SUPABASE_SERVICE_ROLE_KEY ? 'MISSING' : 'OK',
            TELEGRAM_BOT_TOKEN: !process.env.TELEGRAM_BOT_TOKEN ? 'MISSING' : 'OK',
            TELEGRAM_ALLOWED_USER_IDS: !process.env.TELEGRAM_ALLOWED_USER_IDS ? 'MISSING' : 'OK',
            GEMINI_API_KEY: !process.env.GEMINI_API_KEY ? 'MISSING' : 'OK',
          },
          stack: err?.stack,
        },
        null,
        2
      )
    );
  }
}
