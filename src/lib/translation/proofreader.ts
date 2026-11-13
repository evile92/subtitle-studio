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
import { resolveRequestAIAdapter } from '@/lib/ai/providers';
import { getLanguageName } from '@/lib/languages';
import { appendJobLog, getJob, saveJob } from '@/lib/storage/job-store';
import {
  buildArabicLinguisticInstructions,
  normalizeArabicSubtitleText,
  preserveOuterFormattingTags,
  stripBidiControlChars,
} from './arabic-engine';
import {
  detectEntriesNeedingProofread,
  extractResidualLatinWords,
  type ProofreadChangeItem,
  type ProofreadResultSummary,
} from './proofread-utils';
import { validateAndRepairTranslations } from './validator';

export {
  detectEntriesNeedingProofread,
  extractResidualLatinWords,
  type ProofreadChangeItem,
  type ProofreadResultSummary,
};

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

export function buildProofreadBatchPrompts(params: {
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
          .map((g) => `- "${g.sourceTerm}" => "${g.targetTerm}" (${g.category}${g.gender ? `, gender: ${g.gender}` : ''})`)
          .join('\n')
      : '';

  const systemPrompt = `You are an Elite Chief Audiovisual Subtitle Proofreader, Grammarian, and Localization Editor reviewing subtitles translated from ${sourceLangName} into ${targetLangName}.

YOUR MISSION (SECOND-PASS CONTEXTUAL, GENDER & IDIOM QUALITY AUDIT):
Carefully inspect each subtitle entry's "originalText" and "currentTranslation" (along with its -2..+2 surrounding dialogue context and detected issues) and produce a polished, contextually accurate "revisedText".

STRICT PROOFREADING & CORRECTION RULES:
1. AUDIT SPEAKER & ADDRESSEE GENDER AGREEMENT (التذكير والتأنيث للمتحدث والمخاطب):
   - Check the surrounding dialogue context (-2, -1, +1, +2) to see WHO is speaking and WHOM they are addressing.
   - VOCATIVE INVERSION CHECK: When a previous line directly addresses a named character, that named character is the addressee of THAT line—so when they reply in the next turn, fix any false pronoun/verb gender copied onto their listener (e.g., masculine vs feminine "أخبرني / أخبريني", "تريدني / تريدينني").
   - SCENE CONTINUITY IN RAPID DIALOGUES: In tense confrontations or rapid exchanges where names are omitted across short lines, ensure addressee gender stays consistent with the scene rather than flipping unexpectedly to default masculine.
2. RECONSTRUCT CROSS-CUE SPLIT SENTENCES & FIX ISOLATED FRAGMENTS:
   - Whenever an entry begins mid-clause or reads syntactically broken, reconstruct the FULL English sentence across adjacent (-2, -1, +1, +2) cues and ensure each cue carries coherent, natural Arabic phrasing.
   - Fix orphaned literal fragments (e.g., "Seems impossible to face" continuing a prior clause -> "يبدو من المستحيل مواجهته", NEVER broken "مستحيلاً على المواجهة").
3. FIX LITERAL IDIOM MISTRANSLATIONS, SONG LYRICS (♪) & SUBTEXT:
   - Replace word-for-word idiom glosses with natural Arabic equivalents:
     * "Heaven knows" -> "يعلم الله" (NEVER "السماء تعلم").
     * "With one accord" -> "بصوت واحد / بقلب واحد" (NEVER "بكلمة واحدة متفقة").
     * "Break it all down" (when explaining) -> "لأشرح الأمر وأفصّله" (NOT literal "لأهدم كل شيء").
     * "In the fast lane" -> "في المسار السريع" (NOT invented "طريق النجاح السريع").
     * "Never ... again" -> "لن ... مجدداً / ثانيةً" (NEVER collapse into plain "لن ... أبداً" when "again" is meant).
   - Elevate song lyrics ("♪" / "♫") and letter prose from stiff prose to cohesive lyrical Arabic, keeping recurring refrains consistent and restoring authentic sensual, dramatic, or comedic subtext where awkward euphemisms distorted the meaning (subject to profanity/tone preferences).
   - Verify lexical distinctions: "cringey" (محرج) vs "gross" (مقزز), casual fling vs emotional romance, stale food (بايت) vs old, intoxicated vs unconscious.
4. REPLACE LITERAL CALQUES, ARCHAIC DICTION & ORTHOGRAPHIC/MORPHOLOGICAL ERRORS:
   - Remove stiff archaic vocatives like "يا هذا" for casual "man/dude/bro" -> natural "يا رجل / يا صاح" or omit.
   - Fix literal calques ("I super promise" -> "أعدك حقاً"; "what the hell/fuck" -> "ما الذي يحدث بحق الجحيم؟"; "causing drama" -> "إثارة المشاكل"; "with this energy" -> "بهذا الأسلوب"; "يأخذ مكان" -> "يجري / تدور أحداثه"; "يصنع معنى" -> "هذا منطقي").
   - Fix defective verb morphology ("تُمحي / يمحي" -> "تمحو / يمحو") and ensure faithful proper-noun transliteration (e.g., "Ole Miss" -> "أول ميس").
   - Eliminate leftover English/foreign words (except valid HTML/SRT tags like <i>, </i>, <b>, </b>, <u>, </u>, {\\an8}).
   - Fix hamza errors (همزة القطع والوصل), taa marbuta vs haa, alif maqsura vs yaa, dual/plural agreement, and typos ("انشاء الله" -> "إن شاء الله").
5. PRESERVE FORMATTING TAGS & STRUCTURE 100%:
   - Keep all inline tags (<i>...</i>, <b>...</b>, <u>...</u>, {\\an8}, ♪) intact.
   - Never merge or split subtitle entries, and never include timestamps or sequence numbers inside "revisedText".
   - If an entry's "currentTranslation" is already 100% accurate, natural, and gender-correct in context, return it unchanged in "revisedText".
${glossarySection}${arabicSection}

OUTPUT FORMAT:
Return ONLY a valid JSON object with the exact structure (fill "speakerToAddressee" first to verify gender agreement):
{
  "corrections": [
    {
      "sequence": <exact integer sequence number>,
      "speakerToAddressee": "<Speaker(M/F) -> Addressee(M/F/Plural)>",
      "revisedText": "<corrected and polished subtitle text in ${targetLangName}>",
      "reason": "<brief 4-10 word description in Arabic of what was fixed, or 'سليم لغوياً' if unchanged>"
    }
  ]
}`;

  const payload = targetEntries.map((entry) => {
    const prev2 = allEntriesMap.get(entry.sequence - 2);
    const prev1 = allEntriesMap.get(entry.sequence - 1);
    const next1 = allEntriesMap.get(entry.sequence + 1);
    const next2 = allEntriesMap.get(entry.sequence + 2);

    const precedingLines = [prev2, prev1]
      .filter((e): e is SubtitleEntry => Boolean(e))
      .map((e) => `[#${e.sequence}] ${e.originalText} -> ${stripBidiControlChars(e.translatedText || '')}`);

    const followingLines = [next1, next2]
      .filter((e): e is SubtitleEntry => Boolean(e))
      .map((e) => `[#${e.sequence}] ${e.originalText} -> ${stripBidiControlChars(e.translatedText || '')}`);

    return {
      sequence: entry.sequence,
      speaker: entry.speakerLabel || undefined,
      precedingDialogueContext: precedingLines.length > 0 ? precedingLines : undefined,
      originalText: entry.originalText,
      currentTranslation: stripBidiControlChars(entry.translatedText || ''),
      detectedIssues: reasonsBySequence[entry.sequence] || [
        'Audit speaker/addressee gender, idioms/subtext, literal calques, and Arabic fluency',
      ],
      followingDialogueContext: followingLines.length > 0 ? followingLines : undefined,
    };
  });

  const userPrompt = `=== SUBTITLE ENTRIES FOR SECOND-PASS PROOFREADING & CORRECTION (${targetEntries.length} entries) ===
${JSON.stringify(payload, null, 2)}

Review all ${targetEntries.length} entries above against their surrounding dialogue context. Fix any speaker/addressee gender reversals, literal idiom mistranslations, awkward calques, leftover English words, or grammatical errors, and return the JSON object with "corrections".`;

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
  jobData?: TranslationJob;
}): Promise<{
  job: TranslationJob;
  summary: ProofreadResultSummary;
}> {
  const { jobId, scope = 'smart', sequences, customAdapter, jobData } = params;
  const job = getJob(jobId) || jobData;
  if (!job) {
    throw new Error(`Translation job "${jobId}" not found.`);
  }

  const aiAdapter = customAdapter || resolveRequestAIAdapter(job.userAIConfig);
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

/**
 * Stateless single-batch AI proofreader for client-driven sequential proofreading on Vercel.
 * Reviews up to 25-30 entries in a single fast request (~2-4s) so full-file proofreading
 * never hits serverless function timeouts.
 */
export async function proofreadSingleBatchStateless(params: {
  targetEntries: SubtitleEntry[];
  contextEntries?: SubtitleEntry[];
  reasonsBySequence?: Record<number, string[]>;
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  contextProfile?: GlobalContextProfile;
  glossary: GlossaryItem[];
  aiAdapter: AIProviderAdapter;
}): Promise<{
  revisions: Array<{
    sequence: number;
    revisedText: string;
    reason: string;
    changed: boolean;
    previousClean: string;
    nextClean: string;
  }>;
}> {
  const {
    targetEntries,
    contextEntries = [],
    reasonsBySequence = {},
    sourceLanguage,
    targetLanguage,
    arabicDialect,
    preferences,
    contextProfile,
    glossary,
    aiAdapter,
  } = params;

  const isArabic = targetLanguage.toLowerCase() === 'ar';
  const allEntriesMap = new Map<number, SubtitleEntry>();
  for (const e of contextEntries) {
    allEntriesMap.set(e.sequence, e);
  }
  for (const e of targetEntries) {
    allEntriesMap.set(e.sequence, e);
  }

  const prompts = buildProofreadBatchPrompts({
    targetEntries,
    allEntriesMap,
    reasonsBySequence,
    sourceLanguage,
    targetLanguage,
    arabicDialect,
    preferences,
    contextProfile,
    glossary,
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

  const revisions: Array<{
    sequence: number;
    revisedText: string;
    reason: string;
    changed: boolean;
    previousClean: string;
    nextClean: string;
  }> = [];

  for (const entry of targetEntries) {
    const candidate = correctionsBySeq.get(entry.sequence);
    if (!candidate) continue;

    const rawRevised = stripBidiControlChars(candidate.revisedText).trim();
    if (!rawRevised) continue;

    if (isArabic && !/[\u0600-\u06FF]/.test(rawRevised)) {
      continue;
    }

    const normalizedRevised = isArabic
      ? normalizeArabicSubtitleText(rawRevised, entry.originalText)
      : preserveOuterFormattingTags(rawRevised, entry.originalText);

    const prevClean = stripBidiControlChars(entry.translatedText || '').trim();
    const nextClean = stripBidiControlChars(normalizedRevised).trim();

    if (nextClean) {
      revisions.push({
        sequence: entry.sequence,
        revisedText: normalizedRevised,
        reason: candidate.reason,
        changed: nextClean !== prevClean,
        previousClean: prevClean,
        nextClean,
      });
    }
  }

  return { revisions };
}
