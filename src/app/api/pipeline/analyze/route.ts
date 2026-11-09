import { NextRequest, NextResponse } from 'next/server';
import {
  createAdapterFromUserConfig,
  getAIProviderAdapter,
} from '@/lib/ai/providers';
import {
  analyzeFullSubtitleContext,
  analyzeSubtitleSegmentStateless,
  synthesizeSegmentAnalysesStateless,
} from '@/lib/translation/context-analyzer';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import type {
  ArabicDialect,
  SubtitleEntry,
  TranslationPreferencesConfig,
  UserClientAIConfig,
} from '@/types/subtitle';

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, 'pipeline-analyze', 120);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const {
      mode = 'full',
      entries,
      segmentEntries,
      segmentIndex = 0,
      totalSegments = 1,
      totalEntriesInFile = 0,
      previousStoryline,
      previousCharactersSummary,
      partialAnalyses,
      sourceLanguage = 'en',
      targetLanguage = 'ar',
      arabicDialect = 'msa',
      preferences,
      userAIConfig,
    } = body as {
      mode?: 'segment' | 'synthesize' | 'full';
      entries?: SubtitleEntry[];
      segmentEntries?: SubtitleEntry[];
      segmentIndex?: number;
      totalSegments?: number;
      totalEntriesInFile?: number;
      previousStoryline?: string;
      previousCharactersSummary?: string;
      partialAnalyses?: unknown[];
      sourceLanguage?: string;
      targetLanguage?: string;
      arabicDialect?: ArabicDialect;
      preferences: TranslationPreferencesConfig;
      userAIConfig?: UserClientAIConfig;
    };

    const aiAdapter = userAIConfig?.apiKey
      ? createAdapterFromUserConfig(userAIConfig)
      : getAIProviderAdapter();

    if (!aiAdapter.isConfigured()) {
      return NextResponse.json(
        { error: aiAdapter.getMissingConfigMessage() },
        { status: 400 }
      );
    }

    if (mode === 'segment') {
      const targetSegment = segmentEntries ?? entries ?? [];
      if (!Array.isArray(targetSegment) || targetSegment.length === 0) {
        return NextResponse.json(
          { error: 'Segment entries are required for segment context analysis.' },
          { status: 400 }
        );
      }

      const result = await analyzeSubtitleSegmentStateless({
        segmentEntries: targetSegment,
        segmentIndex,
        totalSegments,
        totalEntriesInFile: totalEntriesInFile || targetSegment.length,
        previousStoryline,
        previousCharactersSummary,
        sourceLanguage,
        targetLanguage,
        arabicDialect,
        preferences,
        aiAdapter,
      });

      return NextResponse.json({
        ...result,
        provider: aiAdapter.provider,
        model: aiAdapter.model,
      });
    }

    if (mode === 'synthesize') {
      if (!Array.isArray(partialAnalyses) || partialAnalyses.length === 0) {
        return NextResponse.json(
          { error: 'partialAnalyses array is required for synthesis.' },
          { status: 400 }
        );
      }

      const result = await synthesizeSegmentAnalysesStateless({
        partialAnalyses,
        totalEntriesInFile: totalEntriesInFile || 0,
        sourceLanguage,
        targetLanguage,
        arabicDialect,
        preferences,
        aiAdapter,
      });

      return NextResponse.json({
        ...result,
        provider: aiAdapter.provider,
        model: aiAdapter.model,
      });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: 'Subtitle entries are required for context analysis.' },
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
