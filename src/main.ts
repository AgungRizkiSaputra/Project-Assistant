import { loadConfig } from './config/env.js';
import { logger } from './config/logger.js';
import { getSupabaseClient } from './db/client.js';
import { AuthService } from './modules/auth/auth.service.js';
import { IdeasService } from './modules/ideas/ideas.service.js';
import { ProjectsService } from './modules/projects/projects.service.js';
import { MemoryService } from './modules/memory/memory.service.js';
import { DiscoveryService } from './modules/discovery/discovery.service.js';
import { PrdService } from './modules/prd/prd.service.js';
import { ExportService } from './modules/export/export.service.js';
import { AIProviderFactory } from './ai/factory.js';
import { createTelegramBot } from './telegram/bot.js';

async function bootstrap() {
  logger.info('Initializing Personal Product Assistant...');

  try {
    const config = loadConfig();
    const supabase = getSupabaseClient();

    // Initialize domain services
    const authService = new AuthService(supabase, config.TELEGRAM_ALLOWED_USER_IDS);
    const ideasService = new IdeasService(supabase);
    const projectsService = new ProjectsService(supabase);
    const memoryService = new MemoryService(supabase);

    // AI Provider
    const aiProvider = AIProviderFactory.getProvider(config);

    const discoveryService = new DiscoveryService(supabase, memoryService, aiProvider);
    const prdService = new PrdService(supabase, memoryService, aiProvider);
    const exportService = new ExportService(supabase, config.SUPABASE_STORAGE_BUCKET);

    // Bot factory
    const bot = createTelegramBot(
      config.TELEGRAM_BOT_TOKEN,
      supabase,
      authService,
      ideasService,
      projectsService,
      discoveryService,
      prdService,
      exportService,
      memoryService
    );

    // Graceful stop
    process.once('SIGINT', () => {
      logger.info('Stopping Telegram Bot (SIGINT)...');
      bot.stop();
    });
    process.once('SIGTERM', () => {
      logger.info('Stopping Telegram Bot (SIGTERM)...');
      bot.stop();
    });

    logger.info('Personal Product Assistant bot starting polling...');
    await bot.start({
      onStart: (botInfo) => {
        logger.info({ username: botInfo.username }, 'Telegram Bot successfully started');
      },
    });
  } catch (error) {
    logger.fatal({ error }, 'Fatal error during bootstrap');
    process.exit(1);
  }
}

bootstrap();

