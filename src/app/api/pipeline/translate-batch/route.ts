import { NextRequest, NextResponse } from 'next/server';
import {
  createAdapterFromUserConfig,
  getAIProviderAdapter,
} from '@/lib/ai/providers';
import { translateSingleBatchStateless } from '@/lib/translation/pipeline';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import type {
  ArabicDialect,
  GlobalContextProfile,
  GlossaryItem,
  SubtitleEntry,
  TranslationPreferencesConfig,
  UserClientAIConfig,
} from '@/types/subtitle';

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, 'pipeline-batch', 180);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const {
      batchEntries,
      precedingEntries = [],
      followingEntries = [],
      sourceLanguage = 'en',
      targetLanguage = 'ar',
      arabicDialect = 'msa',
      preferences,
      contextProfile,
      glossary = [],
      userAIConfig,
    } = body as {
      batchEntries: SubtitleEntry[];
      precedingEntries?: SubtitleEntry[];
      followingEntries?: SubtitleEntry[];
      sourceLanguage?: string;
      targetLanguage?: string;
      arabicDialect?: ArabicDialect;
      preferences: TranslationPreferencesConfig;
      contextProfile?: GlobalContextProfile;
      glossary?: GlossaryItem[];
      userAIConfig?: UserClientAIConfig;
    };

    if (!Array.isArray(batchEntries) || batchEntries.length === 0) {
      return NextResponse.json(
        { error: 'batchEntries array is required.' },
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

    const result = await translateSingleBatchStateless({
      batchEntries,
      precedingEntries,
      followingEntries,
      sourceLanguage,
      targetLanguage,
      arabicDialect,
      preferences,
      contextProfile,
      glossary,
      aiAdapter,
    });

    return NextResponse.json({
      ...result,
      provider: aiAdapter.provider,
      model: aiAdapter.model,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to translate subtitle batch.';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
