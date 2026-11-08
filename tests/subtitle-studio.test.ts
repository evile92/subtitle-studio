import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  buildArabicLinguisticInstructions,
  normalizeArabicSubtitleText,
  preserveOuterFormattingTags,
  stripBidiControlChars,
} from '@/lib/translation/arabic-engine';
import { createContextualBatches } from '@/lib/translation/chunker';
import { validateAndRepairTranslations } from '@/lib/translation/validator';
import {
  executeTranslationPipeline,
  regenerateSingleSubtitleEntry,
} from '@/lib/translation/pipeline';
import { deleteJob, getJob, saveJob } from '@/lib/storage/job-store';
import { UI_TRANSLATIONS } from '@/lib/i18n/translations';
import { SAMPLE_SUBTITLE_FILES } from '@/lib/sample-subtitles';
import type { AIProviderAdapter, AIGenerateRequest, AIGenerateResponse } from '@/lib/ai/types';
import { extractJsonFromResponse } from '@/lib/ai/providers';
import type { TranslationJob, TranslationPreferencesConfig } from '@/types/subtitle';

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
});
