import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('Config Loader & Env Validation', () => {
  it('throws error when required environment variables are missing', () => {
    expect(() => loadConfig({})).toThrowError(/Configuration validation error/);
  });

  it('successfully parses valid environment variables', () => {
    const validEnv = {
      TELEGRAM_BOT_TOKEN: '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ',
      TELEGRAM_ALLOWED_USER_IDS: '123456789,987654321',
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      DEFAULT_AI_PROVIDER: 'gemini',
    };

    const config = loadConfig(validEnv);
    expect(config.TELEGRAM_BOT_TOKEN).toBe(validEnv.TELEGRAM_BOT_TOKEN);
    expect(config.TELEGRAM_ALLOWED_USER_IDS).toEqual([123456789, 987654321]);
    expect(config.SUPABASE_URL).toBe('https://test-project.supabase.co');
    expect(config.DEFAULT_AI_PROVIDER).toBe('gemini');
    expect(config.SUPABASE_STORAGE_BUCKET).toBe('prd-exports');
  });
});

