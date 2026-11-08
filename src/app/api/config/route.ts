import { NextRequest, NextResponse } from 'next/server';
import {
  getPublicAIConfigState,
  saveRuntimeAIConfig,
} from '@/lib/ai/providers';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { AIProviderType } from '@/types/subtitle';

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, 'config-get', 120);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  const config = getPublicAIConfigState();
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, 'config-post', 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const validProviders: AIProviderType[] = [
      'gemini',
      'deepseek',
      'openai',
      'anthropic',
      'custom',
    ];
    const provider = validProviders.includes(body.provider) ? body.provider : undefined;

    saveRuntimeAIConfig({
      provider,
      model: typeof body.model === 'string' ? body.model.trim() : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined,
      customBaseUrl:
        typeof body.customBaseUrl === 'string' ? body.customBaseUrl.trim() : undefined,
      temperature:
        typeof body.temperature === 'number'
          ? Math.max(0, Math.min(1, body.temperature))
          : undefined,
      maxRetries:
        typeof body.maxRetries === 'number'
          ? Math.max(1, Math.min(5, body.maxRetries))
          : undefined,
    });

    const updated = getPublicAIConfigState();
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid request payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
