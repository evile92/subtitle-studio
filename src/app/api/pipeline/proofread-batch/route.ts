import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAIAdapter } from '@/lib/ai/providers';
import { proofreadSingleBatchStateless } from '@/lib/translation/proofreader';
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
  const rate = checkRateLimit(req, 'pipeline-proofread-batch', 180);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const {
      targetEntries,
      contextEntries = [],
      reasonsBySequence = {},
      sourceLanguage = 'en',
      targetLanguage = 'ar',
      arabicDialect = 'msa',
      preferences,
      contextProfile,
      glossary = [],
      userAIConfig,
    } = body as {
      targetEntries: SubtitleEntry[];
      contextEntries?: SubtitleEntry[];
      reasonsBySequence?: Record<number, string[]>;
      sourceLanguage?: string;
      targetLanguage?: string;
      arabicDialect?: ArabicDialect;
      preferences: TranslationPreferencesConfig;
      contextProfile?: GlobalContextProfile;
      glossary?: GlossaryItem[];
      userAIConfig?: UserClientAIConfig;
    };

    if (!Array.isArray(targetEntries) || targetEntries.length === 0) {
      return NextResponse.json(
        { error: 'targetEntries array is required for proofreading.' },
        { status: 400 }
      );
    }

    const aiAdapter = resolveRequestAIAdapter(userAIConfig);

    if (!aiAdapter.isConfigured()) {
      return NextResponse.json(
        { error: aiAdapter.getMissingConfigMessage() },
        { status: 400 }
      );
    }

    const result = await proofreadSingleBatchStateless({
      targetEntries,
      contextEntries,
      reasonsBySequence,
      sourceLanguage,
      targetLanguage,
      arabicDialect,
      preferences,
      contextProfile,
      glossary,
      aiAdapter,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to proofread subtitle batch.';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
