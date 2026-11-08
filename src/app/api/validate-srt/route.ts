import { NextRequest, NextResponse } from 'next/server';
import { parseSrtContent } from '@/lib/srt/parser';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, 'validate-srt', 60);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many validation requests. Please wait a moment.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const { content, fileName } = body as { content?: string; fileName?: string };

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        {
          isValid: false,
          errors: ['No subtitle file content received.'],
        },
        { status: 400 }
      );
    }

    const result = parseSrtContent(content, fileName);

    return NextResponse.json({
      isValid: result.isValid,
      format: result.format,
      totalEntries: result.totalEntries,
      detectedLanguage: result.detectedLanguage,
      detectedLanguageConfidence: result.detectedLanguageConfidence,
      totalDurationSeconds: result.totalDurationSeconds,
      speakerCount: result.speakerCount,
      formattedEntryCount: result.formattedEntryCount,
      errors: result.errors,
      warnings: result.warnings,
      sampleEntries: result.entries.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse SRT file';
    return NextResponse.json(
      { isValid: false, errors: [message] },
      { status: 400 }
    );
  }
}
