import OpenAI from 'openai';
import {
  IAIProvider,
  AIChatMessage,
  AICompletionOptions,
  AICompletionResponse,
} from './provider.interface.js';
import { logger } from '../config/logger.js';

export class OpenAIProvider implements IAIProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel = 'gpt-4o-mini') {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAIProvider');
    }
    this.client = new OpenAI({ apiKey });
    this.defaultModel = defaultModel;
  }

  async chat(
    messages: AIChatMessage[],
    options?: AICompletionOptions
  ): Promise<AICompletionResponse> {
    const model = options?.model || this.defaultModel;

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
      });

      const choice = response.choices[0];
      const usage = response.usage;

      return {
        content: choice?.message?.content || '',
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        totalTokens: usage?.total_tokens || 0,
        model,
        provider: this.name,
      };
    } catch (error) {
      logger.error({ error, model }, 'OpenAI API chat error');
      throw error;
    }
  }

  async chatStructured<T>(
    messages: AIChatMessage[],
    schemaDescription: string,
    options?: AICompletionOptions
  ): Promise<{ data: T; usage: AICompletionResponse }> {
    const enrichedMessages: AIChatMessage[] = [
      ...messages,
      {
        role: 'system',
        content: `You MUST return a valid JSON object strictly matching this schema description:\n${schemaDescription}`,
      },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || this.defaultModel,
        messages: enrichedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        response_format: { type: 'json_object' },
        temperature: options?.temperature ?? 0.2,
      });

      const choice = response.choices[0];
      const rawContent = choice?.message?.content || '{}';
      const parsed = JSON.parse(rawContent) as T;
      const usage = response.usage;

      return {
        data: parsed,
        usage: {
          content: rawContent,
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0,
          totalTokens: usage?.total_tokens || 0,
          model: response.model,
          provider: this.name,
        },
      };
    } catch (error) {
      logger.error({ error }, 'OpenAI structured output error');
      throw error;
    }
  }
}

