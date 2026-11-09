import { NextRequest, NextResponse } from 'next/server';
import {
  createAdapterFromUserConfig,
  getAIProviderAdapter,
} from '@/lib/ai/providers';
import { analyzeFullSubtitleContext } from '@/lib/translation/context-analyzer';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import type {
  ArabicDialect,
  SubtitleEntry,
  TranslationPreferencesConfig,
  UserClientAIConfig,
} from '@/types/subtitle';

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, 'pipeline-analyze', 60);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const {
      entries,
      sourceLanguage = 'en',
      targetLanguage = 'ar',
      arabicDialect = 'msa',
      preferences,
      userAIConfig,
    } = body as {
      entries: SubtitleEntry[];
      sourceLanguage?: string;
      targetLanguage?: string;
      arabicDialect?: ArabicDialect;
      preferences: TranslationPreferencesConfig;
      userAIConfig?: UserClientAIConfig;
    };

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: 'Subtitle entries are required for context analysis.' },
        { status: 400 }
      );
    }

    const aiAdapter = userAIConfig?.apiKey
      ? createAdapterFromUserConfig(userAIConfig)
      : getAIProviderAdapter();

    if (!aiAdapter.isConfigured()) {
      return NextResponse.json(
        { error: aiAdapter.getMissingConfigMessage() },
        { status: 400 }
      );
    }

    const result = await analyzeFullSubtitleContext({
      entries,
      sourceLanguage,
      targetLanguage,
      arabicDialect,
      preferences,
      aiAdapter,
      singlePassFastMode: true,
    });

    return NextResponse.json({
      ...result,
      provider: aiAdapter.provider,
      model: aiAdapter.model,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to analyze subtitle context.';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
