import { IAIProvider } from './provider.interface.js';
import { GeminiProvider } from './gemini.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import { Config } from '../config/env.js';
import { logger } from '../config/logger.js';

export class AIProviderFactory {
  private static providers: Map<string, IAIProvider> = new Map();

  static getProvider(config: Config, overrideProvider?: string): IAIProvider {
    const providerName = overrideProvider || config.DEFAULT_AI_PROVIDER;

    if (this.providers.has(providerName)) {
      return this.providers.get(providerName)!;
    }

    let provider: IAIProvider;

    if (providerName === 'gemini') {
      if (!config.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured in environment variables');
      }
      provider = new GeminiProvider(config.GEMINI_API_KEY, config.AI_MODEL_GEMINI);
    } else if (providerName === 'openai') {
      if (!config.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not configured in environment variables');
      }
      provider = new OpenAIProvider(config.OPENAI_API_KEY, config.AI_MODEL_OPENAI);
    } else {
      throw new Error(`Unsupported AI provider: ${providerName}`);
    }

    logger.info({ providerName }, 'Initialized AI Provider');
    this.providers.set(providerName, provider);
    return provider;
  }
}

