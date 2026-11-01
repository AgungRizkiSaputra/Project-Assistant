import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .min(1, 'TELEGRAM_ALLOWED_USER_IDS is required')
    .transform((val) =>
      val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
    ),

  // Supabase
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  SUPABASE_STORAGE_BUCKET: z.string().default('prd-exports'),

  // AI Providers
  DEFAULT_AI_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  AI_MODEL_GEMINI: z.string().default('gemini-3.8-flash'),
  AI_MODEL_OPENAI: z.string().default('gpt-4o-mini'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // App Env
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

let parsedConfig: Config | null = null;

export function loadConfig(overrideEnv?: Record<string, string>): Config {
  if (parsedConfig && !overrideEnv) {
    return parsedConfig;
  }

  const rawEnv = overrideEnv || process.env;
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration validation error:\n${errorDetails}`);
  }

  parsedConfig = result.data;
  return parsedConfig;
}

