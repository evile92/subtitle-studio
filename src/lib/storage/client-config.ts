import type { AIProviderType, UserClientAIConfig } from '@/types/subtitle';
import type { ServerAIConfigState } from '@/lib/ai/types';

export const USER_AI_CONFIG_STORAGE_KEY = 'subtitle_studio_user_ai_config';

export interface StoredUserAIConfig {
  provider: AIProviderType;
  model: string;
  customBaseUrl?: string;
  temperature?: number;
  maxRetries?: number;
  apiKeys: Partial<Record<AIProviderType, string>>;
}

export function loadStoredUserConfig(): StoredUserAIConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_AI_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveStoredUserConfig(config: StoredUserAIConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(USER_AI_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota issues or private browsing restrictions
  }
}

export function getActiveUserClientAIConfig(): UserClientAIConfig | undefined {
  const stored = loadStoredUserConfig();
  if (!stored) return undefined;
  const currentKey = stored.apiKeys?.[stored.provider];
  if (!currentKey || !currentKey.trim()) return undefined;

  return {
    provider: stored.provider,
    model: stored.model,
    apiKey: currentKey.trim(),
    customBaseUrl: stored.customBaseUrl,
    temperature: stored.temperature,
    maxRetries: stored.maxRetries,
  };
}

export function maskApiKey(key?: string): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function applyUserConfigToAIState(
  serverState: ServerAIConfigState | null,
  stored: StoredUserAIConfig | null
): ServerAIConfigState {
  const provider = stored?.provider || serverState?.provider || 'gemini';
  const model = stored?.model || serverState?.model || 'gemini-3.1-flash-lite';
  const userKey = stored?.apiKeys?.[provider]?.trim();

  const availableModels = serverState?.availableModels || {
    gemini: [
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ],
    deepseek: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
    openai: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    custom: ['llama-3.3-70b-instruct', 'mistral-large-latest'],
  };

  if (userKey) {
    return {
      provider,
      model,
      temperature: stored?.temperature ?? serverState?.temperature ?? 0.2,
      maxRetries: stored?.maxRetries ?? serverState?.maxRetries ?? 3,
      customBaseUrl: stored?.customBaseUrl ?? serverState?.customBaseUrl,
      isConfigured: true,
      configuredSource: 'client-browser',
      maskedKey: maskApiKey(userKey),
      availableModels,
    };
  }

  if (serverState) {
    return {
      ...serverState,
      provider: stored?.provider || serverState.provider,
      model: stored?.model || serverState.model,
      availableModels: serverState.availableModels || availableModels,
    };
  }

  return {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    temperature: 0.2,
    maxRetries: 3,
    isConfigured: false,
    configuredSource: 'none',
    missingConfigMessage:
      'لم يتم العثور على مفتاح API نشط. يرجى إدخال مفتاحك في نافذة الإعدادات للبدء.',
    availableModels,
  };
}
