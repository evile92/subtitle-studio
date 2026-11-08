import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  ArabicDialect,
  TranslationJob,
  TranslationPreferencesConfig,
} from '@/types/subtitle';
import { parseSrtContent } from '@/lib/srt/parser';
import { createContextualBatches } from '@/lib/translation/chunker';
import { listJobSummaries, saveJob } from '@/lib/storage/job-store';
import { checkRateLimit } from '@/lib/security/rate-limiter';

const DEFAULT_PREFERENCES: TranslationPreferencesConfig = {
  style: 'natural',
  preserveMeaning: true,
  prioritizeNaturalDialogue: true,
  preserveHumorAndSarcasm: true,
  translateIdiomsByMeaning: true,
  preserveProfanity: true,
  preserveCulturalReferences: true,
  maintainConsistentNames: true,
  batchSize: 35,
  contextOverlapSize: 6,
};

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, 'jobs-list', 120);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const summaries = listJobSummaries();
  return NextResponse.json({ jobs: summaries });
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, 'jobs-create', 30);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const {
      fileName,
      fileContent,
      sourceLanguage = 'auto',
      targetLanguage = 'ar',
      arabicDialect = 'msa',
      preferences = {},
    } = body as {
      fileName?: string;
      fileContent?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      arabicDialect?: ArabicDialect;
      preferences?: Partial<TranslationPreferencesConfig>;
    };

    if (!fileContent || typeof fileContent !== 'string') {
      return NextResponse.json(
        { error: 'Subtitle file content is required.' },
        { status: 400 }
      );
    }

    const safeFileName = (fileName || 'subtitles.srt').replace(/[<>:"/\\|?*]/g, '_');
    const parsed = parseSrtContent(fileContent, safeFileName);

    if (!parsed.isValid || parsed.entries.length === 0) {
      return NextResponse.json(
        {
          error:
            parsed.errors[0] ||
            'The uploaded file is not a valid SubRip (.srt) subtitle file.',
          errors: parsed.errors,
        },
        { status: 400 }
      );
    }

    const mergedPreferences: TranslationPreferencesConfig = {
      ...DEFAULT_PREFERENCES,
      ...preferences,
      batchSize: Math.max(5, Math.min(80, Number(preferences.batchSize || 35))),
      contextOverlapSize: Math.max(
        2,
        Math.min(15, Number(preferences.contextOverlapSize || 6))
      ),
    };

    const batches = createContextualBatches(parsed.entries, {
      batchSize: mergedPreferences.batchSize,
      contextOverlapSize: mergedPreferences.contextOverlapSize,
    });

    const now = new Date().toISOString();
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const newJob: TranslationJob = {
      id: jobId,
      fileName: safeFileName,
      fileSize: Buffer.byteLength(fileContent, 'utf8'),
      format: 'srt',
      sourceLanguage,
      detectedSourceLanguage: parsed.detectedLanguage,
      targetLanguage,
      arabicDialect: targetLanguage.toLowerCase() === 'ar' ? arabicDialect : undefined,
      preferences: mergedPreferences,
      stage: 'parsing',
      progressPercent: 5,
      translatedCount: 0,
      totalEntries: parsed.entries.length,
      currentBatch: 0,
      totalBatches: batches.length,
      entries: parsed.entries,
      glossary: [],
      batches,
      logs: [
        {
          timestamp: now,
          stage: 'uploading',
          message: `Uploaded "${safeFileName}" (${(
            Buffer.byteLength(fileContent, 'utf8') / 1024
          ).toFixed(1)} KB).`,
          level: 'info',
        },
        {
          timestamp: now,
          stage: 'parsing',
          message: `Parsed ${parsed.entries.length} subtitle entries across ${batches.length} contextual batches (detected source language: ${parsed.detectedLanguage.toUpperCase()}).`,
          level: 'success',
        },
      ],
      warnings: [...parsed.warnings],
      createdAt: now,
      updatedAt: now,
    };

    saveJob(newJob);

    return NextResponse.json({ job: newJob }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create translation job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
