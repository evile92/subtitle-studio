import { z } from 'zod';
import type {
  ArabicDialect,
  GlobalContextProfile,
  GlossaryItem,
  SubtitleEntry,
  TranslationJob,
  TranslationPreferencesConfig,
} from '@/types/subtitle';
import type { AIProviderAdapter } from '@/lib/ai/types';
import { createAdapterFromUserConfig, getAIProviderAdapter } from '@/lib/ai/providers';
import { getLanguageName } from '@/lib/languages';
import { stripFormattingTags } from '@/lib/srt/parser';
import { appendJobLog, getJob, saveJob } from '@/lib/storage/job-store';
import {
  buildArabicLinguisticInstructions,
  normalizeArabicSubtitleText,
  preserveOuterFormattingTags,
  stripBidiControlChars,
} from './arabic-engine';
import { validateAndRepairTranslations } from './validator';

export interface ProofreadChangeItem {
  sequence: number;
  originalText: string;
  previousTranslation: string;
  revisedTranslation: string;
  reason: string;
}

export interface ProofreadResultSummary {
  scopeUsed: 'smart' | 'all';
  totalEntriesInJob: number;
  reviewedCount: number;
  correctedCount: number;
  remainingEnglishCount: number;
  changes: ProofreadChangeItem[];
}

function coerceSequenceInt(val: unknown): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const match = val.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }
  return NaN;
}

const ProofreadEntrySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  return {
    sequence: coerceSequenceInt(obj.sequence ?? obj.seq ?? obj.id ?? obj.index),
    revisedText: String(
      obj.revisedText ??
        obj.correctedText ??
        obj.translatedText ??
        obj.translation ??
        obj.text ??
        ''
    ),
    reason: String(
      obj.reason ??
        obj.fixDescription ??
        obj.notes ??
        obj.explanation ??
        'Linguistic & contextual refinement'
    ),
  };
}, z.object({
  sequence: z.number(),
  revisedText: z.string(),
  reason: z.string().optional().default('Linguistic & contextual refinement'),
}));

const ProofreadBatchResponseSchema = z.preprocess((raw) => {
  if (Array.isArray(raw)) {
    return { corrections: raw };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const list =
      obj.corrections ??
      obj.revisions ??
      obj.translations ??
      obj.entries ??
      obj.subtitles ??
      [];
    return {
      corrections: Array.isArray(list) ? list : [],
    };
  }
  return { corrections: [] };
}, z.object({
  corrections: z.array(ProofreadEntrySchema),
}));

/**
 * Strips formatting tags (`<i>`, `<b>`, `{\an8}`) and invisible BiDi characters
 * and checks if any 2+ letter Latin/English words remain in the translated text.
 */
export function extractResidualLatinWords(text: string): string[] {
  if (!text) return [];
  const clean = stripFormattingTags(stripBidiControlChars(text));
  return clean.match(/[A-Za-z]{2,}/g) || [];
}

/**
 * Scans all subtitle entries in a job to identify lines that have:
 * 1. Leftover English/Latin words inside an Arabic (or non-Latin) translation
 * 2. Untranslated or empty translations
 * 3. Active QA warnings
 * 4. Common grammatical/orthographic red flags (duplicate consecutive words, literal machine calques, broken brackets)
 */
export function detectEntriesNeedingProofread(
  entries: SubtitleEntry[],
  targetLanguage: string
): {
  sequences: number[];
  reasonsBySequence: Record<number, string[]>;
} {
  const isArabic = targetLanguage.toLowerCase() === 'ar';
  const sequences: number[] = [];
  const reasonsBySequence: Record<number, string[]> = {};

  for (const entry of entries) {
    if (entry.isSoundEffect) continue;

    const reasons: string[] = [];
    const rawTrans = stripBidiControlChars(entry.translatedText || '').trim();
    const cleanTrans = stripFormattingTags(rawTrans).trim();
    const cleanOrig = stripFormattingTags(entry.originalText || '').trim();

    if (!cleanTrans) {
      reasons.push('Empty translation');
    } else {
      // 1. Check for identical untranslated text
      if (
        cleanOrig.length > 3 &&
        cleanTrans.toLowerCase() === cleanOrig.toLowerCase() &&
        /[A-Za-z]{3,}/.test(cleanOrig)
      ) {
        reasons.push('Line left untranslated in source language');
      }

      // 2. Check for leftover English/Latin words inside Arabic translation
      if (isArabic) {
        const latinWords = extractResidualLatinWords(rawTrans);
        if (latinWords.length > 0) {
          reasons.push(
            `Contains leftover English word(s): ${latinWords.slice(0, 4).join(', ')}`
          );
        }

        // 3. Check for duplicate consecutive Arabic words (e.g. "في في", "من من", "هذا هذا")
        if (/\b([\u0600-\u06FF]{2,})\s+\1\b/.test(cleanTrans)) {
          reasons.push('Duplicate consecutive word detected');
        }

        // 4. Check for awkward literal machine calques or common spelling errors
        if (
          /(يأخذ مكان|يصنع معنى|قطعة من الكعكة|هل تقوم بممازحتي|انشاء الله)/.test(
            cleanTrans
          )
        ) {
          reasons.push('Contains literal calque or common spelling error');
        }
      }
    }

    // 5. Include any entry flagged by the 11-point QA validator
    if (
      (entry.warnings && entry.warnings.length > 0) ||
      entry.status === 'warning'
    ) {
      for (const w of entry.warnings || []) {
        if (!reasons.includes(w)) {
          reasons.push(w);
        }
      }
    }

    if (reasons.length > 0) {
      sequences.push(entry.sequence);
      reasonsBySequence[entry.sequence] = reasons;
    }
  }

  return { sequences, reasonsBySequence };
}

function buildProofreadBatchPrompts(params: {
  targetEntries: SubtitleEntry[];
  allEntriesMap: Map<number, SubtitleEntry>;
  reasonsBySequence: Record<number, string[]>;
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  contextProfile?: GlobalContextProfile;
  glossary: GlossaryItem[];
}): { systemPrompt: string; userPrompt: string } {
  const {
    targetEntries,
    allEntriesMap,
    reasonsBySequence,
    sourceLanguage,
    targetLanguage,
    arabicDialect = 'msa',
    preferences,
    contextProfile,
    glossary,
  } = params;

  const sourceLangName = getLanguageName(sourceLanguage, 'en');
  const targetLangName = getLanguageName(targetLanguage, 'en');
  const isArabic = targetLanguage.toLowerCase() === 'ar';

  const arabicSection = isArabic
    ? '\n\n' +
      buildArabicLinguisticInstructions(
        arabicDialect,
        preferences,
        contextProfile,
        glossary
      )
    : '';

  const glossarySection =
    glossary.length > 0
      ? `\n=== MANDATORY GLOSSARY (CHARACTER NAMES & TERMS) ===\n` +
        glossary
          .map((g) => `- "${g.sourceTerm}" => "${g.targetTerm}" (${g.category})`)
          .join('\n')
      : '';

  const systemPrompt = `You are an Elite Chief Audiovisual Subtitle Proofreader, Grammarian, and Localization Editor reviewing subtitles translated from ${sourceLangName} into ${targetLangName}.

YOUR MISSION (SECOND-PASS LINGUISTIC & QUALITY VERIFICATION):
Carefully inspect each subtitle entry's "originalText" and "currentTranslation" (along with its surrounding dialogue context and detected issues) and produce a polished, error-free "revisedText".

STRICT PROOFREADING & CORRECTION RULES:
1. ELIMINATE ALL LEFTOVER ENGLISH / FOREIGN WORDS:
   - If ${targetLangName} is Arabic (or another target language), NO untranslated English words, phrases, or names may remain in "revisedText" (except valid HTML/SRT formatting tags like <i>, </i>, <b>, </b>, <u>, </u>, {\\an8}).
   - Translate any leftover English words accurately according to the context, or transliterate proper names into Arabic script consistently with the Glossary.
2. FIX SPELLING, ORTHOGRAPHIC & GRAMMATICAL ERRORS:
   - In Arabic: Fix hamza errors (همزة القطع والوصل: أ / إ / آ / ا), taa marbuta vs haa (ة / ه), alif maqsura vs yaa (ى / ي), verb/adjective gender agreement (التذكير والتأنيث حسب المتحدث والمخاطب), dual/plural agreement (المثنى والجمع), and typos (مثل تصحيح "انشاء الله" إلى "إن شاء الله").
3. FIX AWKWARD LITERAL PHRASING:
   - Replace stiff word-for-word machine calques with natural, fluent spoken cinema dialogue while keeping 100% of the original meaning and emotional tone.
4. PRESERVE FORMATTING TAGS & STRUCTURE 100%:
   - Keep all inline tags (<i>...</i>, <b>...</b>, <u>...</u>, {\\an8}, ♪) intact.
   - Never merge or split subtitle entries, and never include timestamps or sequence numbers inside "revisedText".
   - If an entry's "currentTranslation" is already 100% accurate, grammatical, and contains no leftover foreign words, return it unchanged in "revisedText".
${glossarySection}${arabicSection}

OUTPUT FORMAT:
Return ONLY a valid JSON object with the exact structure:
{
  "corrections": [
    {
      "sequence": <exact integer sequence number>,
      "revisedText": "<corrected and polished subtitle text in ${targetLangName}>",
      "reason": "<brief 4-10 word description in Arabic of what was fixed, or 'سليم لغوياً' if unchanged>"
    }
  ]
}`;

  const payload = targetEntries.map((entry) => {
    const prevEntry = allEntriesMap.get(entry.sequence - 1);
    const nextEntry = allEntriesMap.get(entry.sequence + 1);
    return {
      sequence: entry.sequence,
      speaker: entry.speakerLabel || undefined,
      precedingLineContext: prevEntry
        ? `[#${prevEntry.sequence}] ${prevEntry.originalText} -> ${stripBidiControlChars(prevEntry.translatedText || '')}`
        : undefined,
      originalText: entry.originalText,
      currentTranslation: stripBidiControlChars(entry.translatedText || ''),
      detectedIssues: reasonsBySequence[entry.sequence] || [
        'Verify spelling, grammar, gender agreement, and natural phrasing',
      ],
      followingLineContext: nextEntry
        ? `[#${nextEntry.sequence}] ${nextEntry.originalText} -> ${stripBidiControlChars(nextEntry.translatedText || '')}`
        : undefined,
    };
  });

  const userPrompt = `=== SUBTITLE ENTRIES FOR SECOND-PASS PROOFREADING & CORRECTION (${targetEntries.length} entries) ===
${JSON.stringify(payload, null, 2)}

Review all ${targetEntries.length} entries above. Fix any leftover English words, spelling mistakes, grammatical errors, or awkward phrasing, and return the JSON object with "corrections".`;

  return { systemPrompt, userPrompt };
}

/**
 * Executes a non-destructive AI Proofreading & Linguistic Review pass on a job.
 * - Preserves `entry.aiTranslatedText` so the user can always revert any change.
 * - Validates every AI revision before applying it (rejects empty or corrupted output).
 * - Automatically restores formatting tags and RTL BiDi punctuation markers.
 */
export async function proofreadSubtitleJob(params: {
  jobId: string;
  scope?: 'smart' | 'all';
  sequences?: number[];
  customAdapter?: AIProviderAdapter;
}): Promise<{
  job: TranslationJob;
  summary: ProofreadResultSummary;
}> {
  const { jobId, scope = 'smart', sequences, customAdapter } = params;
  const job = getJob(jobId);
  if (!job) {
    throw new Error(`Translation job "${jobId}" not found.`);
  }

  const aiAdapter =
    customAdapter ||
    (job.userAIConfig?.apiKey
      ? createAdapterFromUserConfig(job.userAIConfig)
      : getAIProviderAdapter());
  if (!aiAdapter.isConfigured()) {
    throw new Error(aiAdapter.getMissingConfigMessage());
  }

  const effectiveSourceLang =
    job.sourceLanguage === 'auto'
      ? job.detectedSourceLanguage || 'en'
      : job.sourceLanguage;
  const isArabic = job.targetLanguage.toLowerCase() === 'ar';

  const allEntriesMap = new Map<number, SubtitleEntry>();
  for (const e of job.entries) {
    allEntriesMap.set(e.sequence, e);
  }

  // 1. Determine which entries to proofread
  const detection = detectEntriesNeedingProofread(
    job.entries,
    job.targetLanguage
  );

  let targetSequenceList: number[] = [];
  let effectiveScope: 'smart' | 'all' = scope;

  if (Array.isArray(sequences) && sequences.length > 0) {
    targetSequenceList = sequences;
  } else if (scope === 'smart') {
    if (detection.sequences.length > 0) {
      targetSequenceList = detection.sequences;
    } else {
      // If smart scan found 0 obvious English leftovers/warnings, proofread all dialogue entries (up to 90 entries) so the user still gets a thorough grammatical & spelling review
      effectiveScope = 'all';
      targetSequenceList = job.entries
        .filter((e) => !e.isSoundEffect)
        .slice(0, 90)
        .map((e) => e.sequence);
    }
  } else {
    targetSequenceList = job.entries
      .filter((e) => !e.isSoundEffect)
      .map((e) => e.sequence);
  }

  const targetEntries = targetSequenceList
    .map((seq) => allEntriesMap.get(seq))
    .filter((e): e is SubtitleEntry => Boolean(e));

  const changes: ProofreadChangeItem[] = [];
  const PROOFREAD_BATCH_SIZE = 30;

  appendJobLog(
    job,
    job.stage,
    `Starting AI Proofreading & Linguistic Review pass (${effectiveScope} mode) on ${targetEntries.length} subtitle entries...`,
    'info'
  );
  saveJob(job);

  for (let i = 0; i < targetEntries.length; i += PROOFREAD_BATCH_SIZE) {
    const batchSlice = targetEntries.slice(i, i + PROOFREAD_BATCH_SIZE);
    const prompts = buildProofreadBatchPrompts({
      targetEntries: batchSlice,
      allEntriesMap,
      reasonsBySequence: detection.reasonsBySequence,
      sourceLanguage: effectiveSourceLang,
      targetLanguage: job.targetLanguage,
      arabicDialect: job.arabicDialect,
      preferences: job.preferences,
      contextProfile: job.contextProfile,
      glossary: job.glossary,
    });

    const { data: batchResponse } = await aiAdapter.generateStructured(
      {
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        temperature: 0.15,
      },
      ProofreadBatchResponseSchema
    );

    const correctionsBySeq = new Map<
      number,
      { revisedText: string; reason: string }
    >();
    for (const item of batchResponse.corrections) {
      if (
        !isNaN(item.sequence) &&
        item.revisedText &&
        item.revisedText.trim().length > 0
      ) {
        correctionsBySeq.set(item.sequence, {
          revisedText: item.revisedText.trim(),
          reason: item.reason || 'تدقيق لغوي ونحوي',
        });
      }
    }

    // Apply verified corrections with strict fail-safe guards
    for (const entry of batchSlice) {
      const candidate = correctionsBySeq.get(entry.sequence);
      if (!candidate) continue;

      const rawRevised = stripBidiControlChars(candidate.revisedText).trim();
      if (!rawRevised) continue;

      // Fail-safe guard: For Arabic target, never accept a revision that strips all Arabic characters
      if (isArabic && !/[\u0600-\u06FF]/.test(rawRevised)) {
        continue;
      }

      // Normalize punctuation, restore/balance formatting tags (<i>, <b>, {\an8}), and anchor RTL BiDi marks
      const normalizedRevised = isArabic
        ? normalizeArabicSubtitleText(rawRevised, entry.originalText)
        : preserveOuterFormattingTags(rawRevised, entry.originalText);

      const prevClean = stripBidiControlChars(entry.translatedText || '').trim();
      const nextClean = stripBidiControlChars(normalizedRevised).trim();

      if (nextClean && nextClean !== prevClean) {
        // Preserve previous translation in aiTranslatedText so user can always Undo/Restore
        if (!entry.aiTranslatedText) {
          entry.aiTranslatedText = entry.translatedText;
        }
        entry.translatedText = normalizedRevised;
        entry.status = 'repaired';
        entry.translationNotes = candidate.reason;

        changes.push({
          sequence: entry.sequence,
          originalText: entry.originalText,
          previousTranslation: prevClean,
          revisedTranslation: nextClean,
          reason: candidate.reason,
        });
      } else if (entry.translatedText) {
        // Ensure RTL BiDi fix and tag normalization are applied even if wording didn't change
        entry.translatedText = normalizedRevised;
      }
    }
  }

  // Re-run the 11-point QA validator to refresh the quality report and clear resolved warnings
  const qaResult = validateAndRepairTranslations({
    originalEntries: job.entries,
    translatedEntries: job.entries,
    glossary: job.glossary,
    sourceLanguage: effectiveSourceLang,
    targetLanguage: job.targetLanguage,
  });

  job.entries = qaResult.repairedEntries;
  job.validationReport = qaResult.report;
  job.translatedCount = qaResult.report.translatedEntryCount;

  // Count how many entries (if any) still contain leftover English words
  const remainingEnglishCount = isArabic
    ? job.entries.filter(
        (e) =>
          !e.isSoundEffect &&
          extractResidualLatinWords(e.translatedText || '').length > 0
      ).length
    : 0;

  appendJobLog(
    job,
    job.stage,
    `AI Proofreading completed: Reviewed ${targetEntries.length} entries, corrected ${changes.length} entries (QA Score: ${job.validationReport.qualityScore}%).`,
    'success'
  );
  saveJob(job);

  return {
    job,
    summary: {
      scopeUsed: effectiveScope,
      totalEntriesInJob: job.totalEntries,
      reviewedCount: targetEntries.length,
      correctedCount: changes.length,
      remainingEnglishCount,
      changes,
    },
  };
}
