export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AICompletionResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  provider: string;
}

export interface IAIProvider {
  readonly name: string;
  chat(
    messages: AIChatMessage[],
    options?: AICompletionOptions
  ): Promise<AICompletionResponse>;

  chatStructured<T>(
    messages: AIChatMessage[],
    schemaDescription: string,
    options?: AICompletionOptions
  ): Promise<{ data: T; usage: AICompletionResponse }>;
}

