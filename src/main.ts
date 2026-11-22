import { logger } from './config/logger.js';
import { createAssistantApp } from './bootstrap.js';

async function bootstrap() {
  logger.info('Initializing Personal Product Assistant (AI Product Architect)...');

  try {
    const { config, bot, apiApp } = createAssistantApp();

    // Start Fastify API server
    try {
      await apiApp.listen({ port: config.PORT, host: config.HOST });
      logger.info({ port: config.PORT, host: config.HOST }, 'Personal Project Hub REST API listening');
    } catch (apiErr: any) {
      logger.error({ err: apiErr }, 'Failed to start REST API server');
    }

    // Graceful stop
    const shutdown = async (signal: string) => {
      logger.info(`Stopping services (${signal})...`);
      try {
        bot.stop();
        await apiApp.close();
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
      }
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    logger.info('Personal Product Assistant bot starting polling...');
    await bot.start({
      onStart: (botInfo) => {
        logger.info({ username: botInfo.username }, 'Telegram Bot successfully started as AI Product Architect');
      },
    });
  } catch (error) {
    logger.fatal({ error }, 'Fatal error during bootstrap');
    process.exit(1);
  }
}

bootstrap();
