import { loadConfig, Config } from './config/env.js';
import { getSupabaseClient } from './db/client.js';
import { AuthService } from './modules/auth/auth.service.js';
import { IdeasService } from './modules/ideas/ideas.service.js';
import { ProjectsService } from './modules/projects/projects.service.js';
import { MemoryService } from './modules/memory/memory.service.js';
import { DiscoveryService } from './modules/discovery/discovery.service.js';
import { QualityValidatorService } from './modules/discovery/quality-validator.service.js';
import { PrdService } from './modules/prd/prd.service.js';
import { ExportService } from './modules/export/export.service.js';
import { AIProviderFactory } from './ai/factory.js';
import { createTelegramBot } from './telegram/bot.js';
import { createApiServer } from './api/server.js';
import { FastifyInstance } from 'fastify';
import { Bot } from 'grammy';
import { AppContext } from './telegram/middlewares/auth.middleware.js';

export interface AppBundle {
  config: Config;
  bot: Bot<AppContext>;
  apiApp: FastifyInstance;
  supabase: any;
}

export function createAssistantApp(): AppBundle {
  const config = loadConfig();
  const supabase = getSupabaseClient();

  // Initialize domain services
  const authService = new AuthService(supabase, config.TELEGRAM_ALLOWED_USER_IDS);
  const ideasService = new IdeasService(supabase);
  const projectsService = new ProjectsService(supabase);
  const memoryService = new MemoryService(supabase);

  // AI Provider
  const aiProvider = AIProviderFactory.getProvider(config);

  const validatorService = new QualityValidatorService(supabase, memoryService, aiProvider);
  const discoveryService = new DiscoveryService(supabase, memoryService, aiProvider);
  const prdService = new PrdService(supabase, memoryService, aiProvider, validatorService);
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
    memoryService,
    validatorService
  );

  // REST API Server for Mobile & Web clients
  const apiApp = createApiServer({
    config,
    supabase,
    authService,
    ideasService,
    projectsService,
    discoveryService,
    prdService,
    exportService,
    memoryService,
    validatorService,
    aiProvider,
  });

  return { config, bot, apiApp, supabase };
}
