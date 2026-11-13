import type { AIProviderType } from '@/types/subtitle';

export const DEFAULT_MODELS: Record<AIProviderType, string[]> = {
  gemini: [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  deepseek: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
  anthropic: [
    'claude-3-5-sonnet-latest',
    'claude-3-7-sonnet-latest',
    'claude-3-5-haiku-latest',
  ],
  custom: ['deepseek-chat', 'llama-3.3-70b-versatile', 'qwen-2.5-72b-instruct'],
};

export const DEFAULT_MODEL_BY_PROVIDER: Record<AIProviderType, string> = {
  gemini: DEFAULT_MODELS.gemini[0],
  deepseek: DEFAULT_MODELS.deepseek[0],
  openai: DEFAULT_MODELS.openai[0],
  anthropic: DEFAULT_MODELS.anthropic[0],
  custom: DEFAULT_MODELS.custom[0],
};
