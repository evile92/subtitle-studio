import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { parseSrtContent, validateRawSrtInput } from '@/lib/srt/parser';
import { formatSrtContent } from '@/lib/srt/formatter';
import {
  ARABIC_DIALECTS,
  detectLanguageFromText,
  getArabicDialectOption,
  isRtlLanguage,
  SUPPORTED_LANGUAGES,
} from '@/lib/languages';
import {
  applyArabicRtlBidiFix,
  normalizeArabicSubtitleText,
  stripBidiControlChars,
} from '@/lib/translation/arabic-engine';
import { createContextualBatches } from '@/lib/translation/chunker';
import { validateAndRepairTranslations } from '@/lib/translation/validator';
import {
  executeTranslationPipeline,
  regenerateSingleSubtitleEntry,
} from '@/lib/translation/pipeline';
import {
  detectEntriesNeedingProofread,
  proofreadSubtitleJob,
} from '@/lib/translation/proofreader';
import { deleteJob, getJob, saveJob } from '@/lib/storage/job-store';
import { UI_TRANSLATIONS } from '@/lib/i18n/translations';
import { SAMPLE_SUBTITLE_FILES } from '@/lib/sample-subtitles';
import type { AIProviderAdapter, AIGenerateRequest, AIGenerateResponse } from '@/lib/ai/types';
import * as providersModule from '@/lib/ai/providers';
import {
  extractJsonFromResponse,
  createAdapterFromUserConfig,
  getPublicAIConfigState,
  resolveRequestAIAdapter,
} from '@/lib/ai/providers';
import {
  isPermittedLocalLoopbackBaseUrl,
  resolveSafeDeepSeekBaseUrl,
  validateCustomBaseUrl,
} from '@/lib/security/url-safety';
import { applyUserConfigToAIState, maskApiKey } from '@/lib/storage/client-config';
import type { TranslationJob, TranslationPreferencesConfig } from '@/types/subtitle';
import {
  applyLinearTransform,
  decodeSubtitleBytes,
  fpsConversionScale,
  parseFlexibleTimeToMs,
  parseTimedSubtitle,
  serializeTimedSubtitle,
  syncFromReference,
  transformFromAnchors,
} from '@/lib/srt/sync';

const DEFAULT_PREFS: TranslationPreferencesConfig = {
  style: 'natural',
  preserveMeaning: true,
  prioritizeNaturalDialogue: true,
  preserveHumorAndSarcasm: true,
  translateIdiomsByMeaning: true,
  preserveProfanity: true,
  preserveCulturalReferences: true,
  maintainConsistentNames: true,
  batchSize: 10,
  contextOverlapSize: 3,
};

/**
 * Deterministic test adapter that inspects the incoming prompt (context analysis, batch translation,
 * or single-line regeneration) and returns structured JSON responses so we can verify every stage
 * of the contextual translation pipeline, chunking, glossary persistence, and failure recovery.
 */
class ContextualTestAIAdapter implements AIProviderAdapter {
  readonly provider = 'gemini' as const;
  readonly model = 'gemini-2.5-flash';
  public analysisPromptsReceived: string[] = [];
  public batchPromptsReceived: Array<{ system: string; user: string }> = [];
  public failOnBatchCallNumber: number | null = null;
  public omitFirstSequenceOnce = false;
  private batchCallCounter = 0;

  isConfigured(): boolean {
    return true;
  }

  getMissingConfigMessage(): string {
    return '';
  }

  async generateText(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    // 1. Global Context Analysis or Multi-Segment Synthesis
    if (request.systemPrompt.includes('Chief Audiovisual Script Analyst')) {
      this.analysisPromptsReceived.push(request.userPrompt);
      const responseJson = {
        detectedSourceLanguageCode: 'en',
        subjectAndStoryline:
          'Detective Elena Vance confronts her former partner Marcus Thorne in Cairo after the Aegis Syndicate compromises Project Horizon.',
        narrativeContextAndGenre: 'Noir Crime Thriller / Mystery Drama',
        overallTone: 'Tense, sarcastic, urgent',
        speechPatternsSummary:
          'Elena uses sharp sarcasm and idioms; Marcus speaks urgently and directly.',
        plotDevelopments: [
          'Marcus returns to Cairo chased by the Aegis Syndicate.',
          'Project Horizon and Director Vance’s ledger are compromised.',
          'Elena agrees to help Marcus protect the Glass Archive key.',
        ],
        arabicLocalizationGuidance:
          'Elena is female (use feminine addressing أنتِ/لكِ when Marcus speaks to her); Marcus is male (use masculine addressing أنتَ/لكَ when Elena speaks to him).',
        characters: [
          {
            name: 'Elena',
            translatedName: 'إيلينا',
            gender: 'female',
            role: 'Detective',
            personalityAndTone: 'Sharp, sarcastic, guarded',
            formalityLevel: 'informal',
            relationships: 'Former partner of Marcus',
          },
          {
            name: 'Marcus',
            translatedName: 'ماركوس',
            gender: 'male',
            role: 'Operative',
            personalityAndTone: 'Urgent, pragmatic',
            formalityLevel: 'informal',
            relationships: 'Former partner seeking Elena’s help',
          },
        ],
        idiomsAndNuances: [
          {
            sequenceNumbers: [4],
            originalExpression: 'Piece of cake',
            type: 'sarcasm',
            intendedMeaning: 'Ironic remark meaning it is dangerously reckless, not easy.',
            recommendedTranslationStrategy: 'Translate sarcastically as أمر في غاية السهولة، أليس كذلك؟',
          },
          {
            sequenceNumbers: [6],
            originalExpression: 'barking up the wrong tree',
            type: 'idiom',
            intendedMeaning: 'Mistakenly looking for help from the wrong person.',
            recommendedTranslationStrategy: 'Use natural Arabic idiom أنت تطرق الباب الخطأ',
          },
        ],
        glossary: [
          {
            sourceTerm: 'Elena',
            targetTerm: 'إيلينا',
            category: 'character',
            gender: 'female',
          },
          {
            sourceTerm: 'Marcus',
            targetTerm: 'ماركوس',
            category: 'character',
            gender: 'male',
          },
          {
            sourceTerm: 'Aegis Syndicate',
            targetTerm: 'نقابة إيجيس',
            category: 'organization',
            gender: 'female',
          },
          {
            sourceTerm: 'Project Horizon',
            targetTerm: 'مشروع الأفق',
            category: 'terminology',
            gender: 'male',
          },
        ],
      };

      return {
        content: JSON.stringify(responseJson),
        provider: this.provider,
        model: this.model,
      };
    }

    // 2. Single-entry regeneration
    if (request.userPrompt.includes('TARGET SUBTITLE ENTRY TO REGENERATE')) {
      const seqMatch = request.userPrompt.match(/Sequence:\s*#(\d+)/);
      const seq = seqMatch ? parseInt(seqMatch[1], 10) : 1;
      return {
        content: JSON.stringify({
          sequence: seq,
          translatedText: 'لم أتوقع قط أنك ستعود إلى هنا يا ماركوس.',
          alternatives: [
            'ما كنت لأظن أنك ستعود يوماً.',
            'لم يخطر ببالي أنك ستعود.',
          ],
          reasoning: 'Refined with deeper dramatic emphasis and masculine addressee agreement.',
        }),
        provider: this.provider,
        model: this.model,
      };
    }

    // 2b. Second-pass AI Proofreading & Linguistic Review
    if (
      request.userPrompt.includes(
        'SUBTITLE ENTRIES FOR SECOND-PASS PROOFREADING'
      )
    ) {
      const firstBracket = request.userPrompt.indexOf('[');
      const lastBracket = request.userPrompt.lastIndexOf(']');
      const items = JSON.parse(
        request.userPrompt.slice(firstBracket, lastBracket + 1)
      ) as Array<{
        sequence: number;
        originalText: string;
        currentTranslation: string;
      }>;

      const corrections = items.map((item) => {
        const revised = item.currentTranslation
          .replace(/Syndicate/gi, 'النقابة')
          .replace(/quickly/gi, 'بسرعة')
          .replace(/انشاء الله/g, 'إن شاء الله')
          .replace(/يأخذ مكان/g, 'يحدث');
        return {
          sequence: item.sequence,
          revisedText: revised,
          reason: 'تعريب الكلمات الإنجليزية المتبقية وتصحيح الإملاء والنحو',
        };
      });

      return {
        content: JSON.stringify({ corrections }),
        provider: this.provider,
        model: this.model,
      };
    }

    // 3. Batch translation
    this.batchCallCounter++;
    this.batchPromptsReceived.push({
      system: request.systemPrompt,
      user: request.userPrompt,
    });

    if (
      this.failOnBatchCallNumber !== null &&
      this.batchCallCounter === this.failOnBatchCallNumber
    ) {
      throw new Error('Simulated temporary network interruption during batch processing');
    }

    // Extract the JSON array of target entries from the userPrompt
    const marker = '=== TARGET SUBTITLE BATCH TO TRANSLATE';
    const markerIdx = request.userPrompt.indexOf(marker);
    const afterMarker = markerIdx !== -1 ? request.userPrompt.slice(markerIdx) : request.userPrompt;
    const firstBracket = afterMarker.indexOf('[');
    const endContextMarker = afterMarker.indexOf('=== UPCOMING LOOKAHEAD');
    const jsonSlice =
      endContextMarker !== -1
        ? afterMarker.slice(firstBracket, endContextMarker).trim()
        : afterMarker.slice(firstBracket, afterMarker.lastIndexOf(']') + 1).trim();

    const batchItems = JSON.parse(jsonSlice) as Array<{
      sequence: number;
      originalText: string;
    }>;

    const arabicMap: Record<string, string> = {
      'I never thought you would come back.': 'لم أتوقع أنك ستعود.',
      'I had no other choice.': 'لم يكن لدي خيار آخر.',
    };

    let itemsToReturn = batchItems;
    if (this.omitFirstSequenceOnce && batchItems.length > 1) {
      this.omitFirstSequenceOnce = false;
      itemsToReturn = batchItems.slice(1);
    }

    const translations = itemsToReturn.map((item) => {
      const trimmedOrig = item.originalText.trim();
      let translated = arabicMap[trimmedOrig];
      if (!translated) {
        if (trimmedOrig.includes('Piece of cake')) {
          translated = 'إيلينا: يا للروعة! وقررت أن تجلبهم إلى عتبة بابي؟ أمر في غاية السهولة، أليس كذلك؟';
        } else if (trimmedOrig.includes('barking up the wrong tree')) {
          translated = 'إيلينا: أنت تطرق الباب الخطأ إن كنت تظن أنني سأغطي عليك مجدداً.';
        } else if (trimmedOrig.includes('Aegis Syndicate')) {
          translated = 'ماركوس: لم يكن لدي خيار آخر يا إيلينا.\nلقد عثرت عليّ نقابة إيجيس.';
        } else if (trimmedOrig.includes('Project Horizon')) {
          translated = 'ماركوس: توقفي عن السخرية. تعلمين أنني لن أخاطر بحياتكِ إلا إذا اختُرق مشروع الأفق.';
        } else {
          translated = `ترجمة سياقية للمقطع رقم ${item.sequence} (إيلينا / ماركوس - مشروع الأفق)`;
        }
      }
      return {
        sequence: item.sequence,
        translatedText: translated,
      };
    });

    return {
      content: JSON.stringify({
        translations,
        newGlossaryTerms: [],
      }),
      provider: this.provider,
      model: this.model,
    };
  }

  async generateStructured<T>(
    request: AIGenerateRequest,
    schema: z.ZodType<T>
  ): Promise<{ data: T; provider: 'gemini'; model: string }> {
    const res = await this.generateText(request);
    const parsed = extractJsonFromResponse(res.content);
    const validated = schema.parse(parsed);
    return {
      data: validated,
      provider: this.provider,
      model: this.model,
    };
  }
}

describe('Subtitle Studio — Full Acceptance & Engineering Suite', () => {
  it('Test 1: Basic Translation — Parses English SRT and generates exact valid Arabic SRT', async () => {
    const sampleEnglishSrt = `1
00:00:01,200 --> 00:00:03,500
I never thought you would come back.

2
00:00:04,000 --> 00:00:06,200
I had no other choice.
`;

    const parsed = parseSrtContent(sampleEnglishSrt, 'basic.srt');
    assert.equal(parsed.isValid, true);
    assert.equal(parsed.totalEntries, 2);
    assert.equal(parsed.detectedLanguage, 'en');

    const jobId = `test_basic_${Date.now()}`;
    const job: TranslationJob = {
      id: jobId,
      fileName: 'basic.srt',
      fileSize: sampleEnglishSrt.length,
      format: 'srt',
      sourceLanguage: 'en',
      detectedSourceLanguage: 'en',
      targetLanguage: 'ar',
      arabicDialect: 'msa',
      preferences: DEFAULT_PREFS,
      stage: 'parsing',
      progressPercent: 5,
      translatedCount: 0,
      totalEntries: parsed.entries.length,
      currentBatch: 0,
      totalBatches: 1,
      entries: parsed.entries,
      glossary: [],
      batches: [],
      logs: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveJob(job);

    const testAdapter = new ContextualTestAIAdapter();
    const completed = await executeTranslationPipeline(jobId, testAdapter);

    assert.equal(completed.stage, 'completed');
    assert.equal(completed.translatedCount, 2);
    assert.equal(stripBidiControlChars(completed.entries[0].translatedText!), 'لم أتوقع أنك ستعود.');
    assert.equal(stripBidiControlChars(completed.entries[1].translatedText!), 'لم يكن لدي خيار آخر.');

    const exportedSrt = formatSrtContent(completed.entries);
    const expectedSrt = `1
00:00:01,200 --> 00:00:03,500
لم أتوقع أنك ستعود.

2
00:00:04,000 --> 00:00:06,200
لم يكن لدي خيار آخر.
`;
    assert.equal(stripBidiControlChars(exportedSrt), expectedSrt);
    // Also verify Unicode RLM (\u200F) marks are embedded for RTL video player punctuation rendering
    assert.ok(exportedSrt.includes('\u200F'));

    deleteJob(jobId);
  });

  it('Test 2: Contextual Accuracy — Analyzes full script before translation and localizes idioms, sarcasm & gender', async () => {
    const noirSample = SAMPLE_SUBTITLE_FILES[0];
    const parsed = parseSrtContent(noirSample.content, noirSample.fileName);
    assert.equal(parsed.isValid, true);
    assert.equal(parsed.totalEntries, 12);

    const jobId = `test_context_${Date.now()}`;
    const job: TranslationJob = {
      id: jobId,
      fileName: noirSample.fileName,
      fileSize: noirSample.content.length,
      format: 'srt',
      sourceLanguage: 'en',
      detectedSourceLanguage: 'en',
      targetLanguage: 'ar',
      arabicDialect: 'msa',
      preferences: { ...DEFAULT_PREFS, batchSize: 6, contextOverlapSize: 3 },
      stage: 'parsing',
      progressPercent: 5,
      translatedCount: 0,
      totalEntries: parsed.entries.length,
      currentBatch: 0,
      totalBatches: 0,
      entries: parsed.entries,
      glossary: [],
      batches: [],
      logs: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveJob(job);

    const testAdapter = new ContextualTestAIAdapter();
    const completed = await executeTranslationPipeline(jobId, testAdapter);

    // Confirm Stage B ran BEFORE Stage D and analyzed all 12 entries
    assert.ok(completed.contextProfile);
    assert.equal(completed.contextProfile.analyzedEntryCount, 12);
    assert.equal(completed.contextProfile.characters.length, 2);
    assert.ok(completed.glossary.some((g) => g.sourceTerm === 'Aegis Syndicate' && g.targetTerm === 'نقابة إيجيس'));

    // Confirm Batch 2 received Preceding Dialogue Context (with already-translated text from Batch 1)
    assert.ok(testAdapter.batchPromptsReceived.length >= 2);
    assert.ok(
      testAdapter.batchPromptsReceived[1].user.includes('PRECEDING DIALOGUE CONTEXT')
    );
    assert.ok(
      testAdapter.batchPromptsReceived[1].user.includes('Already Translated:')
    );

    // Confirm idioms ("Piece of cake", "barking up the wrong tree") were localized by intended meaning, not literally
    const entry4 = completed.entries.find((e) => e.sequence === 4);
    const entry6 = completed.entries.find((e) => e.sequence === 6);
    assert.ok(entry4?.translatedText?.includes('أمر في غاية السهولة'));
    assert.ok(!entry4?.translatedText?.includes('قطعة من الكعكة'));
    assert.ok(entry6?.translatedText?.includes('تطرق الباب الخطأ'));

    deleteJob(jobId);
  });

  it('Test 3: Long Subtitle Files — Multi-pass full-file analysis & overlapping contextual chunking for 420 entries', async () => {
    // Generate a 420-entry movie subtitle file
    const blocks: string[] = [];
    for (let i = 1; i <= 420; i++) {
      const startSec = i * 3;
      const endSec = startSec + 2;
      const pad = (n: number) => String(n).padStart(2, '0');
      const startH = pad(Math.floor(startSec / 3600));
      const startM = pad(Math.floor((startSec % 3600) / 60));
      const startS = pad(startSec % 60);
      const endH = pad(Math.floor(endSec / 3600));
      const endM = pad(Math.floor((endSec % 3600) / 60));
      const endS = pad(endSec % 60);

      blocks.push(
        `${i}\n${startH}:${startM}:${startS},100 --> ${endH}:${endM}:${endS},800\nELENA: Line ${i} about Project Horizon with Marcus.`
      );
    }
    const longSrt = blocks.join('\n\n');
    const parsed = parseSrtContent(longSrt, 'long_movie.srt');
    assert.equal(parsed.totalEntries, 420);

    const batches = createContextualBatches(parsed.entries, {
      batchSize: 50,
      contextOverlapSize: 5,
    });
    assert.ok(batches.length >= 8);
    // Verify overlapping context windows between adjacent batches
    assert.equal(batches[0].precedingContextSequences.length, 0);
    assert.equal(batches[0].followingContextSequences.length, 5);
    assert.equal(batches[1].precedingContextSequences.length, 5);
    assert.equal(batches[1].followingContextSequences.length, 5);

    // Verify all 420 sequences are covered without any gap or duplicate
    const allCoveredSeqs = batches.flatMap((b) => b.entrySequences);
    assert.equal(allCoveredSeqs.length, 420);
    assert.equal(allCoveredSeqs[0], 1);
    assert.equal(allCoveredSeqs[419], 420);
  });

  it('Test 4: SRT Integrity — Sequence numbers, timestamps, entry count, and formatting tags are 100% preserved', () => {
    const parsed = parseSrtContent(SAMPLE_SUBTITLE_FILES[0].content, 'integrity.srt');

    // Simulate a slightly messy AI output where timestamp was altered and a closing </i> tag was forgotten
    const messyTranslated = parsed.entries.map((e) => ({
      ...e,
      startTime: e.sequence === 3 ? '99:99:99,999' : e.startTime,
      translatedText:
        e.sequence === 1
          ? '<i>[صوت رعد في الأفق]' // Missing closing </i>
          : `ترجمة المقطع ${e.sequence} لإيلينا وماركوس`,
    }));

    const { repairedEntries, report } = validateAndRepairTranslations({
      originalEntries: parsed.entries,
      translatedEntries: messyTranslated,
      glossary: [
        {
          id: 'g1',
          sourceTerm: 'Elena',
          targetTerm: 'إيلينا',
          category: 'character',
        },
      ],
      sourceLanguage: 'en',
      targetLanguage: 'ar',
    });

    assert.equal(report.isValidSrtStructure, true);
    assert.equal(report.sequenceIntegrityMatch, true);
    assert.equal(report.timestampIntegrityMatch, true);
    assert.equal(repairedEntries.length, parsed.entries.length);

    // Verify timestamp #3 was automatically restored to exact original
    assert.equal(repairedEntries[2].startTime, parsed.entries[2].startTime);
    // Verify unclosed <i> on entry #1 was automatically repaired to <i>...</i>
    assert.equal(stripBidiControlChars(repairedEntries[0].translatedText!), '<i>[صوت رعد في الأفق]</i>');
    // Verify entry #9 bold tag <b>...</b> was preserved
    assert.ok(repairedEntries[8].translatedText?.startsWith('<b>'));
    assert.ok(repairedEntries[8].translatedText?.endsWith('</b>'));
  });

  it('Test 5: Arabic Support — Punctuation normalization, RTL BiDi anchoring, dialect rules, and UTF-8 BOM export', () => {
    assert.equal(isRtlLanguage('ar'), true);
    assert.equal(isRtlLanguage('en'), false);
    assert.ok(SUPPORTED_LANGUAGES.length >= 50);
    assert.ok(ARABIC_DIALECTS.some((d) => d.id === 'msa'));
    assert.ok(ARABIC_DIALECTS.some((d) => d.id === 'moroccan'));
    assert.ok(ARABIC_DIALECTS.some((d) => d.id === 'egyptian'));
    assert.ok(ARABIC_DIALECTS.some((d) => d.id === 'levantine'));
    assert.ok(ARABIC_DIALECTS.some((d) => d.id === 'gulf'));
    assert.equal(getArabicDialectOption(undefined).id, 'msa');

    // Test Arabic punctuation normalizer + RTL BiDi fix with mixed tags
    const rawArabic = '<i>هل أنت متأكد من ذلك?, نعم; بالتأكيد!</i>';
    const normalized = normalizeArabicSubtitleText(rawArabic, '<i>Are you sure?, Yes; certainly!</i>');
    assert.equal(stripBidiControlChars(normalized), '<i>هل أنت متأكد من ذلك؟، نعم؛ بالتأكيد!</i>');
    assert.ok(normalized.includes('\u200F'));

    // Test trailing ellipsis BiDi anchoring (e.g. "كل شيء يعتمد على السرعة...")
    const ellipsisLine = applyArabicRtlBidiFix('كل شيء يعتمد على السرعة...');
    assert.ok(ellipsisLine.startsWith('\u200Fكل'));
    assert.ok(ellipsisLine.endsWith('\u200F...\u200F'));

    // Test language auto-detection for Arabic & English
    assert.equal(detectLanguageFromText('لم أتوقع أنك ستعود إلى القاهرة').code, 'ar');
    assert.equal(detectLanguageFromText('I never thought you would come back to Cairo').code, 'en');

    // Test UTF-8 with BOM export
    const parsed = parseSrtContent(SAMPLE_SUBTITLE_FILES[1].content);
    parsed.entries[0].translatedText = 'لم أتوقع أنك ستعود.';
    const exportedWithBom = formatSrtContent(parsed.entries, { useBom: true });
    assert.equal(exportedWithBom.charCodeAt(0), 0xfeff);
  });

  it('Test 6: Manual Editing & Single-Entry Contextual Regeneration', async () => {
    const parsed = parseSrtContent(SAMPLE_SUBTITLE_FILES[1].content, 'edit.srt');
    const jobId = `test_edit_${Date.now()}`;
    const job: TranslationJob = {
      id: jobId,
      fileName: 'edit.srt',
      fileSize: 250,
      format: 'srt',
      sourceLanguage: 'en',
      detectedSourceLanguage: 'en',
      targetLanguage: 'ar',
      arabicDialect: 'msa',
      preferences: DEFAULT_PREFS,
      stage: 'parsing',
      progressPercent: 5,
      translatedCount: 0,
      totalEntries: parsed.entries.length,
      currentBatch: 0,
      totalBatches: 1,
      entries: parsed.entries,
      glossary: [],
      batches: [],
      logs: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveJob(job);

    const adapter = new ContextualTestAIAdapter();
    await executeTranslationPipeline(jobId, adapter);

    // Manually edit entry #2
    const savedJob = getJob(jobId)!;
    const originalAiText = savedJob.entries[1].aiTranslatedText;
    savedJob.entries[1].translatedText = 'لم يكن أمامي أي سبيل آخر.';
    savedJob.entries[1].isEditedByUser = true;
    saveJob(savedJob);

    const exportedAfterEdit = formatSrtContent(getJob(jobId)!.entries);
    assert.ok(stripBidiControlChars(exportedAfterEdit).includes('لم يكن أمامي أي سبيل آخر.'));
    assert.equal(getJob(jobId)!.entries[1].aiTranslatedText, originalAiText);

    // Regenerate entry #1 using surrounding context while preserving entry #2's manual edit
    const regenResult = await regenerateSingleSubtitleEntry({
      jobId,
      sequence: 1,
      customInstruction: 'Add stronger dramatic emphasis',
      customAdapter: adapter,
    });

    assert.equal(
      stripBidiControlChars(regenResult.entry.translatedText!),
      'لم أتوقع قط أنك ستعود إلى هنا يا ماركوس.'
    );
    assert.ok(regenResult.alternatives.length >= 2);
    // Confirm manual edit on entry #2 was preserved!
    assert.equal(
      stripBidiControlChars(getJob(jobId)!.entries[1].translatedText!),
      'لم يكن أمامي أي سبيل آخر.'
    );

    deleteJob(jobId);
  });

  it('Test 7: Bilingual Interface Dictionaries (English LTR & Arabic RTL Parity)', () => {
    const enKeys = Object.keys(UI_TRANSLATIONS.en);
    const arKeys = Object.keys(UI_TRANSLATIONS.ar);
    assert.deepEqual(enKeys, arKeys);
    assert.equal(
      Object.keys(UI_TRANSLATIONS.en.progress.stages).length,
      Object.keys(UI_TRANSLATIONS.ar.progress.stages).length
    );
  });

  it('Test 8: Failure Handling — Invalid files, incomplete AI batch recovery, and interrupted job resumption without losing completed batches', async () => {
    // 8a. Reject invalid extensions, empty files, binary files, and timestamp-less text
    assert.equal(validateRawSrtInput('hello', 'video.mp4').valid, false);
    assert.equal(validateRawSrtInput('', 'empty.srt').valid, false);
    assert.equal(validateRawSrtInput('1\n00:00:01,000\u0000binary', 'corrupt.srt').valid, false);
    assert.equal(validateRawSrtInput('Just plain text without timestamps', 'notes.srt').valid, false);

    // 8b. Test mid-pipeline interruption on Batch 2 and seamless resumption without re-translating Batch 1
    const parsed = parseSrtContent(SAMPLE_SUBTITLE_FILES[0].content, 'recovery.srt');
    const jobId = `test_recovery_${Date.now()}`;
    const job: TranslationJob = {
      id: jobId,
      fileName: 'recovery.srt',
      fileSize: 500,
      format: 'srt',
      sourceLanguage: 'en',
      detectedSourceLanguage: 'en',
      targetLanguage: 'ar',
      arabicDialect: 'msa',
      preferences: { ...DEFAULT_PREFS, batchSize: 6, contextOverlapSize: 2 },
      stage: 'parsing',
      progressPercent: 5,
      translatedCount: 0,
      totalEntries: parsed.entries.length,
      currentBatch: 0,
      totalBatches: 0,
      entries: parsed.entries,
      glossary: [],
      batches: [],
      logs: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveJob(job);

    const failingAdapter = new ContextualTestAIAdapter();
    // Fail on Batch 2 while also omitting sequence #1 on Batch 1 to test automatic omitted-entry recovery
    failingAdapter.omitFirstSequenceOnce = true;
    failingAdapter.failOnBatchCallNumber = 3; // Call 1 = Batch 1, Call 2 = Recovery of seq #1 in Batch 1, Call 3 = Batch 2 (throws!)

    await assert.rejects(
      () => executeTranslationPipeline(jobId, failingAdapter),
      /Simulated temporary network interruption/
    );

    const interruptedJob = getJob(jobId)!;
    assert.equal(interruptedJob.stage, 'failed');
    // Batch 1 (first 6 entries, including recovered entry #1) MUST be completed and saved on disk!
    assert.equal(interruptedJob.batches[0].status, 'completed');
    assert.equal(interruptedJob.translatedCount, 6);

    // Now resume the job with a healthy adapter and confirm Batch 1 is NOT re-translated
    const resumeAdapter = new ContextualTestAIAdapter();
    const resumedJob = await executeTranslationPipeline(jobId, resumeAdapter);

    assert.equal(resumedJob.stage, 'completed');
    assert.equal(resumedJob.translatedCount, 12);
    // Resume adapter should have been called ONLY for Batch 2 (1 batch call, 0 context analysis calls!)
    assert.equal(resumeAdapter.analysisPromptsReceived.length, 0);
    assert.equal(resumeAdapter.batchPromptsReceived.length, 1);

    deleteJob(jobId);
  });

  it('Test 9: Second-Pass AI Proofreading — Detects and fixes leftover English words, spelling mistakes, and calques safely', async () => {
    const sampleSrt = `1
00:00:01,000 --> 00:00:03,000
<i>We must escape the Syndicate quickly!</i>

2
00:00:04,000 --> 00:00:06,500
Everything will take place tomorrow, God willing.

3
00:00:07,000 --> 00:00:09,000
Wait for me at the gate.
`;
    const parsed = parseSrtContent(sampleSrt, 'proofread_test.srt');
    // Simulate a first-pass translation that left English words ("Syndicate", "quickly") and a spelling/calque error ("يأخذ مكان", "انشاء الله")
    parsed.entries[0].translatedText = '<i>علينا الهروب من Syndicate quickly!</i>';
    parsed.entries[0].aiTranslatedText = parsed.entries[0].translatedText;
    parsed.entries[1].translatedText = 'كل شيء سوف يأخذ مكان غداً انشاء الله.';
    parsed.entries[1].aiTranslatedText = parsed.entries[1].translatedText;
    parsed.entries[2].translatedText = 'انتظرني عند البوابة.';
    parsed.entries[2].aiTranslatedText = parsed.entries[2].translatedText;

    // 1. Verify smart detector finds entries #1 and #2 (while ignoring valid <i> tags and leaving clean entry #3 alone)
    const detected = detectEntriesNeedingProofread(parsed.entries, 'ar');
    assert.deepEqual(detected.sequences, [1, 2]);

    const jobId = `test_proofread_${Date.now()}`;
    const job: TranslationJob = {
      id: jobId,
      fileName: 'proofread_test.srt',
      fileSize: sampleSrt.length,
      format: 'srt',
      sourceLanguage: 'en',
      detectedSourceLanguage: 'en',
      targetLanguage: 'ar',
      arabicDialect: 'msa',
      preferences: DEFAULT_PREFS,
      stage: 'completed',
      progressPercent: 100,
      translatedCount: 3,
      totalEntries: 3,
      currentBatch: 1,
      totalBatches: 1,
      entries: parsed.entries,
      glossary: [],
      batches: [],
      logs: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveJob(job);

    const adapter = new ContextualTestAIAdapter();
    const result = await proofreadSubtitleJob({
      jobId,
      scope: 'smart',
      customAdapter: adapter,
    });

    assert.equal(result.summary.reviewedCount, 2);
    assert.equal(result.summary.correctedCount, 2);
    assert.equal(result.summary.remainingEnglishCount, 0);

    const updatedEntries = result.job.entries;
    assert.equal(
      stripBidiControlChars(updatedEntries[0].translatedText!),
      '<i>علينا الهروب من النقابة بسرعة!</i>'
    );
    assert.equal(
      stripBidiControlChars(updatedEntries[1].translatedText!),
      'كل شيء سوف يحدث غداً إن شاء الله.'
    );
    assert.equal(
      stripBidiControlChars(updatedEntries[2].translatedText!),
      'انتظرني عند البوابة.'
    );

    deleteJob(jobId);
  });

  it('Test 10: Client BYOK Configuration & DeepSeek Adapter Isolation', () => {
    // 1. Adapter creation from transient user config
    const adapter = createAdapterFromUserConfig({
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKey: 'sk-test-deepseek-12345678',
    });

    assert.equal(adapter.provider, 'deepseek');
    assert.equal(adapter.model, 'deepseek-flash');
    assert.equal(adapter.isConfigured(), true);

    // 2. Key masking
    assert.equal(maskApiKey('sk-test-deepseek-12345678'), 'sk-t...5678');
    assert.equal(maskApiKey('short'), '****');

    // 3. User config merge with server state
    const mergedState = applyUserConfigToAIState(null, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKeys: { deepseek: 'sk-test-deepseek-12345678' },
    });

    assert.equal(mergedState.provider, 'deepseek');
    assert.equal(mergedState.model, 'deepseek-flash');
    assert.equal(mergedState.isConfigured, true);
    assert.equal(mergedState.configuredSource, 'client-browser');
    assert.equal(mergedState.maskedKey, 'sk-t...5678');
  });

  it('Test 11: Subtitle Sync & Release Converter — offset, FPS drift, anchors, reference copy, text untouched', () => {
    const srt =
      '1\n00:01:00,000 --> 00:01:02,000\n<i>Hello?</i>\n\n2\n00:30:00,000 --> 00:30:03,500\nمرحباً\n\n3\n01:40:00,000 --> 01:40:02,000\n- Bye.\n- See you.\n';
    const parsed = parseTimedSubtitle('\uFEFF' + srt.replace(/\n/g, '\r\n'));
    assert.equal(parsed.format, 'srt');
    assert.equal(parsed.cues.length, 3);
    assert.equal(parsed.cues[0].startMs, 60_000);
    assert.equal(parsed.cues[2].text, '- Bye.\n- See you.');

    // Constant offset (+2.5s)
    const shifted = applyLinearTransform(parsed.cues, { scale: 1, offsetMs: 2500 });
    assert.equal(shifted.cues[0].startMs, 62_500);
    assert.equal(shifted.cues[1].endMs, 1_803_500 + 2500);

    // FPS conversion 23.976 -> 25 shrinks timestamps
    const fps = applyLinearTransform(parsed.cues, { scale: fpsConversionScale(23.976, 25), offsetMs: 0 });
    assert.equal(fps.cues[2].startMs, Math.round(6_000_000 * (23.976 / 25)));

    // Two-anchor sync recovers both offset and drift exactly
    const t = transformFromAnchors(
      { subtitleMs: 60_000, videoMs: 60_000 * 0.95904 + 4000 },
      { subtitleMs: 6_000_000, videoMs: 6_000_000 * 0.95904 + 4000 }
    );
    assert.ok(Math.abs(t.scale - 0.95904) < 1e-9);
    assert.ok(Math.abs(t.offsetMs - 4000) < 1e-6);

    // Single anchor = pure offset
    assert.deepEqual(transformFromAnchors({ subtitleMs: 60_000, videoMs: 58_000 }), {
      scale: 1,
      offsetMs: -2000,
    });

    // Negative shifts are clamped and counted
    const clamped = applyLinearTransform(parsed.cues, { scale: 1, offsetMs: -61_000 });
    assert.equal(clamped.cues[0].startMs, 0);
    assert.equal(clamped.cues[0].endMs, 1000);
    assert.equal(clamped.clampedCount, 1);

    // Flexible time input
    assert.equal(parseFlexibleTimeToMs('74.5'), 74_500);
    assert.equal(parseFlexibleTimeToMs('1:14'), 74_000);
    assert.equal(parseFlexibleTimeToMs('00:01:14,500'), 74_500);
    assert.equal(parseFlexibleTimeToMs('abc'), null);

    // Reference sync: equal counts copy timings exactly, text untouched
    const ref = parseTimedSubtitle(srt.replace('00:01:00,000', '00:01:05,250'));
    const copied = syncFromReference(parsed.cues, ref.cues);
    assert.equal(copied.method, 'exact_copy');
    assert.equal(copied.cues[0].startMs, 65_250);
    assert.equal(copied.cues[1].text, 'مرحباً');

    // Serialization produces valid SRT / VTT and round-trips
    const out = serializeTimedSubtitle(shifted.cues, 'srt');
    assert.ok(out.startsWith('1\n00:01:02,500 --> 00:01:04,500\n<i>Hello?</i>'));
    const vtt = serializeTimedSubtitle(shifted.cues, 'vtt');
    assert.ok(vtt.startsWith('WEBVTT\n\n00:01:02.500 --> 00:01:04.500'));
    const roundTrip = parseTimedSubtitle(vtt);
    assert.equal(roundTrip.format, 'vtt');
    assert.equal(roundTrip.cues.length, 3);
    assert.equal(roundTrip.cues[1].text, 'مرحباً');
  });

  it('Test 12: Security — SSRF URL restriction, DeepSeek host check, and BYOK server isolation', () => {
    // 1. Valid HTTPS custom endpoint normalizes trailing slashes
    assert.equal(
      validateCustomBaseUrl('https://openrouter.ai/api/v1/'),
      'https://openrouter.ai/api/v1'
    );

    // 2. Reject insecure schemes, credentials, internal names, private & metadata IPs
    const blockedUrls = [
      '',
      'not-a-url',
      'http://openrouter.ai/api/v1',
      'file:///etc/passwd',
      'https://user:pass@api.openai.com/v1',
      'https://api.openai.com/v1#frag',
      'https://api.openai.com/v1?x=1',
      'https://169.254.169.254/latest/meta-data',
      'http://169.254.169.254/latest/meta-data',
      'https://metadata.google.internal/computeMetadata/v1',
      'https://10.0.0.1/v1',
      'https://172.16.0.10/v1',
      'https://192.168.1.50/v1',
      'https://127.0.0.1:8080/v1',
      'https://localhost:11434/v1',
      'http://localhost:11434/v1',
      'https://[::1]:11434/v1',
      'https://[fd00:ec2::254]/v1',
      'https://[::ffff:127.0.0.1]/v1',
      'https://redis/v1',
    ];
    for (const candidate of blockedUrls) {
      assert.throws(() => validateCustomBaseUrl(candidate, { allowLocalLoopback: false }), candidate);
    }

    // 3. Explicit local loopback opt-in allows localhost/127.0.0.1 ONLY, while still blocking metadata/LAN IPs
    assert.equal(
      validateCustomBaseUrl('http://localhost:11434/v1/', { allowLocalLoopback: true }),
      'http://localhost:11434/v1'
    );
    assert.throws(() =>
      validateCustomBaseUrl('https://169.254.169.254/v1', { allowLocalLoopback: true })
    );
    assert.throws(() =>
      validateCustomBaseUrl('https://10.0.0.1/v1', { allowLocalLoopback: true })
    );
    assert.equal(isPermittedLocalLoopbackBaseUrl('https://evil.com/localhost', true), false);
    assert.equal(isPermittedLocalLoopbackBaseUrl('http://127.0.0.1:11434/v1', true), true);

    // 4. DeepSeek URL bypass via query string is rejected
    assert.equal(resolveSafeDeepSeekBaseUrl('https://evil.com/?deepseek'), 'https://api.deepseek.com');
    assert.equal(resolveSafeDeepSeekBaseUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1');

    // 5. Adapter creation and route resolver block unsafe custom URLs even when apiKey is empty
    assert.throws(() =>
      createAdapterFromUserConfig({
        provider: 'custom',
        apiKey: 'sk-test',
        customBaseUrl: 'https://169.254.169.254/v1',
      })
    );
    assert.throws(() =>
      resolveRequestAIAdapter({
        provider: 'custom',
        customBaseUrl: 'https://10.0.0.2/v1',
      })
    );

    // 6. Server BYOK isolation: no POST handler on /api/config and no saveRuntimeAIConfig persistence
    const configRouteSrc = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'api', 'config', 'route.ts'),
      'utf8'
    );
    assert.equal(/export\s+(?:async\s+)?function\s+POST\b/.test(configRouteSrc), false);
    assert.equal('saveRuntimeAIConfig' in providersModule, false);
    assert.notEqual(getPublicAIConfigState().configuredSource, 'runtime');

    // 7. Clearing browser key does not preserve stale client-browser configured state
    const previousClientMerged = applyUserConfigToAIState(null, {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      apiKeys: { gemini: 'AIzaTestKey123456' },
    });
    assert.equal(previousClientMerged.isConfigured, true);

    const clearedClientMerged = applyUserConfigToAIState(previousClientMerged, {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      apiKeys: {},
    });
    assert.equal(clearedClientMerged.isConfigured, false);
    assert.equal(clearedClientMerged.configuredSource, 'none');
    assert.equal(clearedClientMerged.maskedKey, undefined);
  });

  it('Test 13: Phase 2 Fixes — Windows-1256 upload decoding and Unicode/global glossary QA repair', () => {
    // 1. UTF-8 and Windows-1256 SRT byte decoding
    const utf8Bytes = new TextEncoder().encode('1\r\n00:00:01,000 --> 00:00:03,000\r\nأهلا بك\r\n');
    assert.ok(decodeSubtitleBytes(utf8Bytes.buffer).includes('أهلا بك'));

    // "مرحبا" in Windows-1256 (0xE3 0xD1 0xCD 0xC8 0xC7) - invalid UTF-8 triggers Windows-1256 fallback
    const win1256Prefix = new TextEncoder().encode('1\r\n00:00:01,000 --> 00:00:03,000\r\n');
    const win1256ArabicWord = new Uint8Array([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]);
    const win1256Combined = new Uint8Array(win1256Prefix.length + win1256ArabicWord.length);
    win1256Combined.set(win1256Prefix, 0);
    win1256Combined.set(win1256ArabicWord, win1256Prefix.length);

    const decodedWin1256 = decodeSubtitleBytes(win1256Combined.buffer);
    assert.ok(decodedWin1256.includes('مرحبا'));
    const parsedWin1256 = parseSrtContent(decodedWin1256);
    assert.equal(parsedWin1256.entries.length, 1);
    assert.equal(parsedWin1256.entries[0]?.originalText, 'مرحبا');

    // 2. Glossary validation: multiple occurrences, non-Latin Unicode boundaries, punctuation-ending terms, literal '$'
    const parsedBaseline = parseSrtContent(
      '1\r\n00:00:01,000 --> 00:00:04,000\r\nJohn told Johnson about Dr. Strange at the café for PRICE.\r\n'
    );
    const originalEntries = parsedBaseline.entries;

    const corruptedTranslatedEntries = [
      {
        ...originalEntries[0]!,
        startTime: '99:99:99,000',
        endTime: '99:99:99,999',
        rawTimestampLine: '99:99:99,000 --> 99:99:99,999',
        translatedText: 'أخبر John المدعو Johnson عن Dr. Strange في café بسعر PRICE أو John.',
      },
    ];

    const qaResult = validateAndRepairTranslations({
      originalEntries,
      translatedEntries: corruptedTranslatedEntries,
      sourceLanguage: 'en',
      targetLanguage: 'ar',
      glossary: [
        { id: 'g-john', sourceTerm: 'John', targetTerm: 'جون', category: 'character' },
        { id: 'g-dr', sourceTerm: 'Dr.', targetTerm: 'د.', category: 'terminology' },
        { id: 'g-cafe', sourceTerm: 'café', targetTerm: 'المقهى', category: 'terminology' },
        { id: 'g-price', sourceTerm: 'PRICE', targetTerm: '$100', category: 'terminology' },
      ],
    });

    const repaired = qaResult.repairedEntries[0];
    assert.ok(repaired);
    // Genuine timestamp baseline from originalEntries must be restored
    assert.equal(repaired.startTime, '00:00:01,000');
    assert.equal(repaired.endTime, '00:00:04,000');
    assert.ok(qaResult.report.issues.some((i) => i.type === 'timestamp_modified'));

    const repairedText = repaired.translatedText || '';
    // Both occurrences of John replaced, without corrupting Johnson
    assert.equal(repairedText.includes('Johnson'), true);
    assert.equal((repairedText.match(/جون/g) || []).length, 2);
    assert.equal(/\bJohn\b/.test(repairedText), false);
    // Punctuation-ending term ("Dr.") and Unicode-ending term ("café") replaced
    assert.equal(repairedText.includes('د.'), true);
    assert.equal(repairedText.includes('المقهى'), true);
    // '$' replacement pattern is treated literally
    assert.equal(repairedText.includes('$100'), true);
  });
});
