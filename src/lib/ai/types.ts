import type { z } from 'zod';
import type { AIProviderType } from '@/types/subtitle';

export interface AIGenerateRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  jsonMode?: boolean;
}

export interface AIGenerateResponse {
  content: string;
  provider: AIProviderType;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface AIProviderAdapter {
  readonly provider: AIProviderType;
  readonly model: string;
  isConfigured(): boolean;
  getMissingConfigMessage(): string;
  generateText(request: AIGenerateRequest): Promise<AIGenerateResponse>;
  generateStructured<T>(
    request: AIGenerateRequest,
    schema: z.ZodType<T>,
    maxRetries?: number
  ): Promise<{ data: T; provider: AIProviderType; model: string }>;
}

export interface ServerAIConfigState {
  provider: AIProviderType;
  model: string;
  temperature: number;
  maxRetries: number;
  customBaseUrl?: string;
  isConfigured: boolean;
  configuredSource: 'env' | 'runtime' | 'client-browser' | 'none';
  maskedKey?: string;
  missingConfigMessage?: string;
  availableModels: Record<AIProviderType, string[]>;
}
