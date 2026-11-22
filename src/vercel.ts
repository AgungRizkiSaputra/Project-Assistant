import { FastifyInstance } from 'fastify';
import { webhookCallback } from 'grammy';
import { createAssistantApp } from './app.js';
import { logger } from './config/logger.js';

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

  // Health check endpoint
  apiApp.get('/api/health', async () => ({
    status: 'ok',
    mode: 'vercel-serverless',
    timestamp: new Date().toISOString(),
  }));

  await apiApp.ready();
  return apiApp;
}

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = bootstrapServerless();
  }
  const app = await appPromise;
  app.server.emit('request', req, res);
}
