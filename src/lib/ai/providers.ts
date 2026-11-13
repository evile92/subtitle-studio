import dns from 'node:dns/promises';
import net from 'node:net';
import type { z } from 'zod';
import type { AIProviderType, UserClientAIConfig } from '@/types/subtitle';
import {
  isBlockedIpAddress,
  isExplicitLoopbackHost,
  isLocalLoopbackOptInEnabled,
  isPermittedLocalLoopbackBaseUrl,
  resolveSafeDeepSeekBaseUrl,
  validateCustomBaseUrl,
} from '@/lib/security/url-safety';
import type {
  AIGenerateRequest,
  AIGenerateResponse,
  AIProviderAdapter,
  ServerAIConfigState,
} from './types';

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
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  custom: ['deepseek-chat', 'llama-3.3-70b-versatile', 'qwen-2.5-72b-instruct'],
};

function maskKey(key?: string): string | undefined {
  if (!key || key.trim().length < 6) return undefined;
  const trimmed = key.trim();
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Resolves DNS right before outbound custom-endpoint requests to block DNS rebinding
 * to loopback, private, link-local, or cloud metadata IP addresses.
 */
async function assertSafeOutboundCustomUrl(rawUrl: string): Promise<string> {
  const safeBase = validateCustomBaseUrl(rawUrl);
  const parsed = new URL(safeBase);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  if (isLocalLoopbackOptInEnabled() && isExplicitLoopbackHost(host)) {
    return safeBase;
  }

  if (net.isIP(host) === 0) {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) {
      throw new Error(`Unsafe Custom AI base URL: hostname "${host}" could not be resolved.`);
    }
    for (const record of records) {
      if (isBlockedIpAddress(record.address, false)) {
        throw new Error(
          `Unsafe Custom AI base URL: hostname "${host}" resolved to blocked internal/private IP "${record.address}".`
        );
      }
    }
  }

  return safeBase;
}

export function resolveAIConfig(): {
  provider: AIProviderType;
  model: string;
  apiKey: string;
  customBaseUrl: string;
  temperature: number;
  maxRetries: number;
  configuredSource: 'env' | 'none';
} {
  const provider = (process.env.AI_PROVIDER?.toLowerCase() as AIProviderType) || 'gemini';

  const defaultModel = DEFAULT_MODELS[provider]?.[0] || 'gemini-3.5-flash-lite';
  const model = process.env.AI_MODEL || defaultModel;
  const temperature = Number(process.env.AI_TEMPERATURE || 0.2);
  const maxRetries = Number(process.env.AI_MAX_RETRIES || 3);
  const customBaseUrl = process.env.CUSTOM_AI_BASE_URL || 'https://api.openai.com/v1';

  let envKey = '';
  if (provider === 'gemini') envKey = process.env.GEMINI_API_KEY || '';
  else if (provider === 'deepseek') envKey = process.env.DEEPSEEK_API_KEY || '';
  else if (provider === 'openai') envKey = process.env.OPENAI_API_KEY || '';
  else if (provider === 'anthropic') envKey = process.env.ANTHROPIC_API_KEY || '';
  else if (provider === 'custom') envKey = process.env.CUSTOM_AI_API_KEY || process.env.OPENAI_API_KEY || '';

  const configuredSource: 'env' | 'none' = envKey ? 'env' : 'none';

  return {
    provider,
    model,
    apiKey: envKey,
    customBaseUrl,
    temperature,
    maxRetries,
    configuredSource,
  };
}

export function getPublicAIConfigState(): ServerAIConfigState {
  const resolved = resolveAIConfig();
  const isConfigured = Boolean(
    resolved.apiKey ||
      (resolved.provider === 'custom' &&
        isPermittedLocalLoopbackBaseUrl(resolved.customBaseUrl))
  );

  const envVarName =
    resolved.provider === 'gemini'
      ? 'GEMINI_API_KEY'
      : resolved.provider === 'deepseek'
        ? 'DEEPSEEK_API_KEY'
        : resolved.provider === 'openai'
          ? 'OPENAI_API_KEY'
          : resolved.provider === 'anthropic'
            ? 'ANTHROPIC_API_KEY'
            : 'CUSTOM_AI_API_KEY';

  const missingConfigMessage = isConfigured
    ? undefined
    : `AI provider "${resolved.provider.toUpperCase()}" is not configured yet. Please set ${envVarName} in your .env.local file or configure your API key in Settings.`;

  return {
    provider: resolved.provider,
    model: resolved.model,
    temperature: resolved.temperature,
    maxRetries: resolved.maxRetries,
    customBaseUrl: resolved.customBaseUrl,
    isConfigured,
    configuredSource: resolved.configuredSource,
    maskedKey: maskKey(resolved.apiKey),
    missingConfigMessage,
    availableModels: DEFAULT_MODELS,
  };
}

/**
 * Extracts valid JSON from an LLM response that might contain markdown code fences or prose around JSON.
 */
export function extractJsonFromResponse(raw: string): unknown {
  const trimmed = raw.trim();

  // Direct parse attempt
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to extraction strategies
  }

  // Extract from ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // Find outermost { ... } or [ ... ]
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue
    }
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue
    }
  }

  // Fallback recovery for batch translation responses where an LLM included unescaped quotes inside "translatedText"
  if (trimmed.includes('"sequence"') && trimmed.includes('"translatedText"')) {
    const recoveredTranslations: Array<{ sequence: number; translatedText: string }> = [];
    const entryBlockRegex =
      /"sequence"\s*:\s*"?(\d+)"?\s*,\s*"translatedText"\s*:\s*"([\s\S]*?)"\s*(?=\}|,\s*"[a-zA-Z]|\r?\n\s*\})/g;
    let match: RegExpExecArray | null;
    while ((match = entryBlockRegex.exec(trimmed)) !== null) {
      const seq = parseInt(match[1], 10);
      const rawText = match[2]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .trim();
      if (!isNaN(seq) && rawText) {
        recoveredTranslations.push({ sequence: seq, translatedText: rawText });
      }
    }
    if (recoveredTranslations.length > 0) {
      return { translations: recoveredTranslations, newGlossaryTerms: [] };
    }
  }

  throw new Error(`Model response did not contain valid JSON. Raw excerpt: ${trimmed.slice(0, 180)}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConfigurableAIProviderAdapter implements AIProviderAdapter {
  readonly provider: AIProviderType;
  readonly model: string;
  private readonly apiKey: string;
  private readonly customBaseUrl: string;
  private readonly defaultTemp: number;
  private readonly defaultRetries: number;

  constructor(overrides?: {
    provider?: AIProviderType;
    model?: string;
    apiKey?: string;
    customBaseUrl?: string;
    temperature?: number;
    maxRetries?: number;
  }) {
    const resolved = resolveAIConfig();
    this.provider = overrides?.provider || resolved.provider;
    this.model = overrides?.model || resolved.model;
    this.apiKey = overrides?.apiKey ?? resolved.apiKey;
    const rawCustomBaseUrl = overrides?.customBaseUrl || resolved.customBaseUrl;
    this.customBaseUrl =
      this.provider === 'custom'
        ? validateCustomBaseUrl(rawCustomBaseUrl)
        : rawCustomBaseUrl;
    this.defaultTemp = overrides?.temperature ?? resolved.temperature;
    this.defaultRetries = overrides?.maxRetries ?? resolved.maxRetries;
  }

  isConfigured(): boolean {
    if (this.apiKey && this.apiKey.trim().length > 0) return true;
    // Allow local Ollama/vLLM endpoints only when explicitly enabled via ALLOW_LOCAL_AI_ENDPOINTS=true
    if (
      this.provider === 'custom' &&
      isPermittedLocalLoopbackBaseUrl(this.customBaseUrl)
    ) {
      return true;
    }
    return false;
  }

  getMissingConfigMessage(): string {
    const envVar =
      this.provider === 'gemini'
        ? 'GEMINI_API_KEY'
        : this.provider === 'deepseek'
          ? 'DEEPSEEK_API_KEY'
          : this.provider === 'openai'
            ? 'OPENAI_API_KEY'
            : this.provider === 'anthropic'
              ? 'ANTHROPIC_API_KEY'
              : 'CUSTOM_AI_API_KEY';

    return `Missing API key for provider "${this.provider}". Set ${envVar} in your environment (.env.local) or configure it in the Platform Settings panel.`;
  }

  async generateText(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    if (!this.isConfigured()) {
      throw new Error(this.getMissingConfigMessage());
    }

    const temperature = request.temperature ?? this.defaultTemp;

    if (this.provider === 'gemini') {
      return this.callGemini(request, temperature);
    }
    if (this.provider === 'anthropic') {
      return this.callAnthropic(request, temperature);
    }
    // DeepSeek, OpenAI, or Custom OpenAI-compatible
    const baseUrl =
      this.provider === 'deepseek'
        ? resolveSafeDeepSeekBaseUrl(this.customBaseUrl)
        : this.provider === 'openai'
          ? 'https://api.openai.com/v1'
          : validateCustomBaseUrl(this.customBaseUrl);
    return this.callOpenAICompatible(baseUrl, request, temperature);
  }

  async generateStructured<T>(
    request: AIGenerateRequest,
    schema: z.ZodType<T>,
    maxRetries?: number
  ): Promise<{ data: T; provider: AIProviderType; model: string }> {
    const retries = maxRetries ?? this.defaultRetries;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await this.generateText({
          ...request,
          jsonMode: true,
        });

        const parsedJson = extractJsonFromResponse(res.content);
        const validated = schema.parse(parsedJson);
        return {
          data: validated,
          provider: res.provider,
          model: res.model,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Do not retry non-transient configuration, authentication, or SSRF policy errors
        if (
          lastError.message.includes('Missing API key') ||
          lastError.message.includes('401') ||
          lastError.message.includes('invalid_api_key') ||
          lastError.message.includes('Custom AI base URL') ||
          lastError.message.includes('Unsafe Custom AI base URL')
        ) {
          throw lastError;
        }
        if (attempt < retries) {
          const backoffMs = Math.min(4000, 600 * Math.pow(2, attempt - 1));
          await sleep(backoffMs);
        }
      }
    }

    throw new Error(
      `AI request failed after ${retries} attempts (${this.provider}/${this.model}): ${lastError?.message || 'Unknown error'}`
    );
  }

  private async callGemini(
    request: AIGenerateRequest,
    temperature: number
  ): Promise<AIGenerateResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const body: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: request.systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: request.userPrompt }],
        },
      ],
      generationConfig: {
        temperature,
        ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API error (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text || '')
        .join('') || '';

    if (!text) {
      throw new Error('Gemini API returned an empty response.');
    }

    return {
      content: text,
      provider: 'gemini',
      model: this.model,
      usage: {
        promptTokens: data?.usageMetadata?.promptTokenCount,
        completionTokens: data?.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  private async callOpenAICompatible(
    baseUrl: string,
    request: AIGenerateRequest,
    temperature: number
  ): Promise<AIGenerateResponse> {
    const verifiedBaseUrl =
      this.provider === 'custom' ? await assertSafeOutboundCustomUrl(baseUrl) : baseUrl;
    const url = `${verifiedBaseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      temperature,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      ...(request.jsonMode &&
      (this.provider === 'openai' ||
        (this.provider === 'deepseek' &&
          (this.model.includes('chat') || this.model.includes('flash'))))
        ? { response_format: { type: 'json_object' } }
        : {}),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`${this.provider.toUpperCase()} API error (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) {
      throw new Error(`${this.provider.toUpperCase()} API returned an empty message content.`);
    }

    return {
      content: text,
      provider: this.provider,
      model: this.model,
      usage: {
        promptTokens: data?.usage?.prompt_tokens,
        completionTokens: data?.usage?.completion_tokens,
      },
    };
  }

  private async callAnthropic(
    request: AIGenerateRequest,
    temperature: number
  ): Promise<AIGenerateResponse> {
    const url = 'https://api.anthropic.com/v1/messages';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8192,
        temperature,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Anthropic API error (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const text =
      data?.content
        ?.map((block: { type?: string; text?: string }) => (block.type === 'text' ? block.text : ''))
        .join('') || '';

    if (!text) {
      throw new Error('Anthropic API returned an empty response.');
    }

    return {
      content: text,
      provider: 'anthropic',
      model: this.model,
      usage: {
        promptTokens: data?.usage?.input_tokens,
        completionTokens: data?.usage?.output_tokens,
      },
    };
  }
}

// Allow custom adapter injection for testing
let activeAdapterOverride: AIProviderAdapter | null = null;

export function setAIProviderAdapterOverride(adapter: AIProviderAdapter | null): void {
  activeAdapterOverride = adapter;
}

export function getAIProviderAdapter(): AIProviderAdapter {
  if (activeAdapterOverride) return activeAdapterOverride;
  return new ConfigurableAIProviderAdapter();
}

export function createAdapterFromUserConfig(
  userConfig?: Partial<UserClientAIConfig>
): ConfigurableAIProviderAdapter {
  if (
    userConfig &&
    userConfig.provider &&
    (userConfig.apiKey ||
      (userConfig.provider === 'custom' &&
        isPermittedLocalLoopbackBaseUrl(userConfig.customBaseUrl)))
  ) {
    return new ConfigurableAIProviderAdapter({
      provider: userConfig.provider,
      model: userConfig.model,
      apiKey: userConfig.apiKey,
      customBaseUrl: userConfig.customBaseUrl,
      temperature: userConfig.temperature,
      maxRetries: userConfig.maxRetries,
    });
  }
  return new ConfigurableAIProviderAdapter();
}

/**
 * Resolves a request-scoped AI adapter and validates custom endpoints against SSRF rules.
 */
export function resolveRequestAIAdapter(
  userConfig?: Partial<UserClientAIConfig>
): AIProviderAdapter {
  if (userConfig?.provider === 'custom' && userConfig.customBaseUrl) {
    validateCustomBaseUrl(userConfig.customBaseUrl);
  }
  if (
    userConfig?.provider &&
    (userConfig.apiKey?.trim() ||
      (userConfig.provider === 'custom' &&
        isPermittedLocalLoopbackBaseUrl(userConfig.customBaseUrl)))
  ) {
    return createAdapterFromUserConfig(userConfig);
  }
  return getAIProviderAdapter();
}
