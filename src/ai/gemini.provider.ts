import { GoogleGenAI } from '@google/genai';
import {
  IAIProvider,
  AIChatMessage,
  AICompletionOptions,
  AICompletionResponse,
} from './provider.interface.js';
import { logger } from '../config/logger.js';

export class GeminiProvider implements IAIProvider {
  readonly name = 'gemini';
  private client: GoogleGenAI;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel = 'gemini-3.8-flash') {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiProvider');
    }
    this.client = new GoogleGenAI({ apiKey });
    this.defaultModel = defaultModel;
  }

  async chat(
    messages: AIChatMessage[],
    options?: AICompletionOptions
  ): Promise<AICompletionResponse> {
    const model = options?.model || this.defaultModel;

    // Convert messages to Gemini format
    const systemInstruction = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const conversationHistory = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    try {
      const response = await this.client.models.generateContent({
        model,
        contents: conversationHistory,
        config: {
          systemInstruction: systemInstruction || undefined,
          temperature: options?.temperature ?? 0.7,
        },
      });

      const text = response.text || '';
      const usageMetadata = response.usageMetadata;

      return {
        content: text,
        promptTokens: usageMetadata?.promptTokenCount || 0,
        completionTokens: usageMetadata?.candidatesTokenCount || 0,
        totalTokens: usageMetadata?.totalTokenCount || 0,
        model,
        provider: this.name,
      };
    } catch (error) {
      logger.error({ error, model }, 'Gemini API generateContent error');
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
        role: 'user',
        content: `IMPORTANT: Respond ONLY with a valid JSON object matching this schema description:\n${schemaDescription}\nDo not wrap output in markdown code blocks (\`\`\`json). Output raw json string only.`,
      },
    ];

    const response = await this.chat(enrichedMessages, {
      ...options,
      temperature: options?.temperature ?? 0.2, // lower temperature for deterministic JSON
    });

    try {
      // Clean possible markdown code fences if model accidentally added them
      let cleaned = response.content.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleaned) as T;
      return { data: parsed, usage: response };
    } catch (parseError) {
      logger.error({ rawContent: response.content, parseError }, 'Failed to parse structured JSON from Gemini');
      throw new Error(`Failed to parse AI JSON response: ${(parseError as Error).message}`);
    }
  }
}

