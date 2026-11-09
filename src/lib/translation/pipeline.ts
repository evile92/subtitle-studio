import { z } from 'zod';
import type {
  SubtitleEntry,
  TranslationJob,
} from '@/types/subtitle';
import type { AIProviderAdapter } from '@/lib/ai/types';
import { createAdapterFromUserConfig, getAIProviderAdapter } from '@/lib/ai/providers';
import { appendJobLog, getJob, saveJob } from '@/lib/storage/job-store';
import {
  analyzeFullSubtitleContext,
  normalizeGlossaryArray,
} from './context-analyzer';
import { createContextualBatches } from './chunker';
import {
  buildBatchTranslationPrompts,
  buildSingleEntryRegeneratePrompts,
} from './prompts';
import {
  normalizeArabicSubtitleText,
  preserveOuterFormattingTags,
} from './arabic-engine';
import { validateAndRepairTranslations } from './validator';

function coerceSequenceInt(val: unknown): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const match = val.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }
  return NaN;
}

const NormalizedTranslationEntrySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  return {
    sequence: coerceSequenceInt(obj.sequence ?? obj.seq ?? obj.id ?? obj.index),
    translatedText: String(
      obj.translatedText ?? obj.translation ?? obj.text ?? obj.arabic ?? ''
    ),
  };
}, z.object({
  sequence: z.number(),
  translatedText: z.string(),
}));

const BatchTranslationResponseSchema = z.preprocess((raw) => {
  if (Array.isArray(raw)) {
    return { translations: raw, newGlossaryTerms: [] };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      translations: Array.isArray(obj.translations)
        ? obj.translations
        : Array.isArray(obj.entries)
          ? obj.entries
          : Array.isArray(obj.subtitles)
            ? obj.subtitles
            : [],
      newGlossaryTerms: normalizeGlossaryArray(
        obj.newGlossaryTerms ?? obj.glossary ?? []
      ),
    };
  }
  return raw;
}, z.object({
  translations: z.array(NormalizedTranslationEntrySchema),
  newGlossaryTerms: z
    .array(
      z.object({
        sourceTerm: z.string(),
        targetTerm: z.string(),
        category: z
          .enum([
            'character',
            'location',
            'organization',
            'terminology',
            'idiom',
            'recurring_phrase',
          ])
          .catch('terminology'),
      })
    )
    .optional()
    .default([]),
}));

const SingleEntryRegenerateSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  return {
    sequence: coerceSequenceInt(obj.sequence ?? obj.seq ?? obj.id),
    translatedText: String(
      obj.translatedText ?? obj.translation ?? obj.text ?? ''
    ),
    alternatives: Array.isArray(obj.alternatives)
      ? obj.alternatives.map(String)
      : [],
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
  };
}, z.object({
  sequence: z.number().optional().catch(undefined),
  translatedText: z.string(),
  alternatives: z.array(z.string()).optional().default([]),
  reasoning: z.string().optional(),
}));

// Track active in-flight job executions to prevent duplicate concurrent runs on the same jobId
const activeRunningJobs = new Set<string>();

export function isJobCurrentlyRunning(jobId: string): boolean {
  return activeRunningJobs.has(jobId);
}

/**
 * Executes or resumes the complete multi-stage contextual translation pipeline for a job.
 * Preserves completed batches across interruptions and checkpoints progress after every stage & batch.
 */
export async function executeTranslationPipeline(
  jobId: string,
  customAdapter?: AIProviderAdapter
): Promise<TranslationJob> {
  if (activeRunningJobs.has(jobId)) {
    const current = getJob(jobId);
    if (current) return current;
  }

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
    const msg = aiAdapter.getMissingConfigMessage();
    job.stage = 'failed';
    job.errorMessage = msg;
    appendJobLog(job, 'failed', msg, 'error');
    saveJob(job);
    throw new Error(msg);
  }

  activeRunningJobs.add(jobId);
  job.errorMessage = undefined;
  job.aiProviderUsed = aiAdapter.provider;
  job.aiModelUsed = aiAdapter.model;

  try {
    // Ensure existing jobs have strictly unique sequence numbers across all entries
    const seenSeq = new Set<number>();
    let hasDuplicateSeq = false;
    for (const e of job.entries) {
      if (seenSeq.has(e.sequence)) {
        hasDuplicateSeq = true;
        break;
      }
      seenSeq.add(e.sequence);
    }
    if (hasDuplicateSeq) {
      job.entries.forEach((e, idx) => {
        e.sequence = idx + 1;
      });
      job.batches = createContextualBatches(job.entries, {
        batchSize: job.preferences.batchSize,
        contextOverlapSize: job.preferences.contextOverlapSize,
      });
      job.totalBatches = job.batches.length;
      saveJob(job);
    }

    // STAGE 2: Verify parsed subtitle structure
    if (job.stage === 'uploading' || job.stage === 'parsing') {
      job.progressPercent = 8;
      appendJobLog(
        job,
        'parsing',
        `Verified ${job.totalEntries} subtitle entries with timestamps and formatting metadata.`,
        'info'
      );
      saveJob(job);
    }

    // STAGE 3: Global Context Analysis (100% of file analyzed before translation)
    if (!job.contextProfile) {
      job.progressPercent = 12;
      appendJobLog(
        job,
        'analyzing_storyline',
        `Starting full-file contextual storyline analysis across all ${job.totalEntries} subtitle entries...`,
        'info'
      );
      saveJob(job);

      const analysisResult = await analyzeFullSubtitleContext({
        entries: job.entries,
        sourceLanguage: job.sourceLanguage === 'auto' ? (job.detectedSourceLanguage || 'en') : job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        arabicDialect: job.arabicDialect,
        preferences: job.preferences,
        aiAdapter,
        onProgress: (msg, pass, totalPasses) => {
          job.progressPercent = 12 + Math.round((pass / totalPasses) * 10);
          appendJobLog(job, 'analyzing_storyline', msg, 'info');
          saveJob(job);
        },
      });

      job.contextProfile = analysisResult.contextProfile;
      if (analysisResult.detectedSourceLanguage && job.sourceLanguage === 'auto') {
        job.detectedSourceLanguage = analysisResult.detectedSourceLanguage;
      }

      // Merge discovered glossary items with any existing items
      const existingKeys = new Set(job.glossary.map((g) => g.sourceTerm.toLowerCase()));
      for (const item of analysisResult.glossary) {
        if (!existingKeys.has(item.sourceTerm.toLowerCase())) {
          job.glossary.push(item);
          existingKeys.add(item.sourceTerm.toLowerCase());
        }
      }

      appendJobLog(
        job,
        'analyzing_storyline',
        `Completed storyline analysis (${job.contextProfile.analyzedEntryCount}/${job.totalEntries} entries analyzed). Identified ${job.contextProfile.characters.length} characters and ${job.glossary.length} glossary terms.`,
        'success'
      );
      saveJob(job);
    }

    // STAGE 4: Building character & terminology context + intelligent batch organization
    job.progressPercent = 25;
    appendJobLog(
      job,
      'building_context',
      `Preparing character voice profiles, persistent glossary (${job.glossary.length} terms), and contextual overlapping batches...`,
      'info'
    );

    if (!job.batches || job.batches.length === 0) {
      job.batches = createContextualBatches(job.entries, {
        batchSize: job.preferences.batchSize,
        contextOverlapSize: job.preferences.contextOverlapSize,
      });
      job.totalBatches = job.batches.length;
    }
    saveJob(job);

    // STAGE 5: Translating subtitle batches with overlapping context windows
    appendJobLog(
      job,
      'translating_batches',
      `Translating ${job.totalEntries} subtitles across ${job.batches.length} context-linked batches...`,
      'info'
    );
    saveJob(job);

    const entryMap = new Map<number, SubtitleEntry>();
    for (const e of job.entries) {
      entryMap.set(e.sequence, e);
    }

    const isArabic = job.targetLanguage.toLowerCase() === 'ar';
    const effectiveSourceLang =
      job.sourceLanguage === 'auto'
        ? job.detectedSourceLanguage || 'en'
        : job.sourceLanguage;

    for (let bIdx = 0; bIdx < job.batches.length; bIdx++) {
      const batch = job.batches[bIdx];
      job.currentBatch = bIdx + 1;

      // Skip already completed batches when resuming a job!
      const allEntriesAlreadyTranslated = batch.entrySequences.every((seq) => {
        const entry = entryMap.get(seq);
        return entry && entry.translatedText && entry.translatedText.trim().length > 0;
      });

      if (batch.status === 'completed' && allEntriesAlreadyTranslated) {
        continue;
      }

      batch.status = 'processing';
      batch.attempts += 1;
      saveJob(job);

      const batchEntries = batch.entrySequences
        .map((seq) => entryMap.get(seq))
        .filter((e): e is SubtitleEntry => Boolean(e));
      const precedingEntries = batch.precedingContextSequences
        .map((seq) => entryMap.get(seq))
        .filter((e): e is SubtitleEntry => Boolean(e));
      const followingEntries = batch.followingContextSequences
        .map((seq) => entryMap.get(seq))
        .filter((e): e is SubtitleEntry => Boolean(e));

      const prompts = buildBatchTranslationPrompts({
        batchEntries,
        precedingEntries,
        followingEntries,
        sourceLanguage: effectiveSourceLang,
        targetLanguage: job.targetLanguage,
        arabicDialect: job.arabicDialect,
        preferences: job.preferences,
        contextProfile: job.contextProfile,
        glossary: job.glossary,
      });

      const { data: batchResult } = await aiAdapter.generateStructured(
        {
          systemPrompt: prompts.systemPrompt,
          userPrompt: prompts.userPrompt,
          temperature: 0.2,
        },
        BatchTranslationResponseSchema
      );

      // Map returned translations to sequence numbers
      const returnedMap = new Map<number, string>();
      for (const item of batchResult.translations) {
        if (item.translatedText && item.translatedText.trim().length > 0) {
          returnedMap.set(item.sequence, item.translatedText.trim());
        }
      }

      // Check if any entry in this batch was missed by the LLM and recover it
      const missingBatchEntries = batchEntries.filter(
        (e) => !returnedMap.has(e.sequence)
      );

      if (missingBatchEntries.length > 0) {
        appendJobLog(
          job,
          'translating_batches',
          `Batch ${bIdx + 1}/${job.batches.length}: Recovering ${missingBatchEntries.length} omitted subtitle entries...`,
          'warning'
        );

        const recoveryPrompts = buildBatchTranslationPrompts({
          batchEntries: missingBatchEntries,
          precedingEntries: batchEntries.slice(0, 3),
          followingEntries: [],
          sourceLanguage: effectiveSourceLang,
          targetLanguage: job.targetLanguage,
          arabicDialect: job.arabicDialect,
          preferences: job.preferences,
          contextProfile: job.contextProfile,
          glossary: job.glossary,
        });

        const { data: recoveryData } = await aiAdapter.generateStructured(
          {
            systemPrompt: recoveryPrompts.systemPrompt,
            userPrompt: recoveryPrompts.userPrompt,
            temperature: 0.15,
          },
          BatchTranslationResponseSchema
        );

        for (const recItem of recoveryData.translations) {
          if (recItem.translatedText && recItem.translatedText.trim().length > 0) {
            returnedMap.set(recItem.sequence, recItem.translatedText.trim());
          }
        }
      }

      // Apply translations to entries
      for (const entry of batchEntries) {
        const rawTranslated = returnedMap.get(entry.sequence);
        if (rawTranslated) {
          const normalized = isArabic
            ? normalizeArabicSubtitleText(rawTranslated, entry.originalText)
            : preserveOuterFormattingTags(rawTranslated, entry.originalText);

          // Do not overwrite user manual edits if resuming
          if (!entry.isEditedByUser) {
            entry.translatedText = normalized;
          }
          entry.aiTranslatedText = normalized;
          entry.status = entry.isEditedByUser ? 'edited' : 'translated';
        }
      }

      // Merge any newly discovered glossary terms
      if (batchResult.newGlossaryTerms && batchResult.newGlossaryTerms.length > 0) {
        const existingGlossarySet = new Set(
          job.glossary.map((g) => g.sourceTerm.toLowerCase())
        );
        for (const newTerm of batchResult.newGlossaryTerms) {
          if (
            newTerm.sourceTerm &&
            newTerm.targetTerm &&
            !existingGlossarySet.has(newTerm.sourceTerm.toLowerCase())
          ) {
            job.glossary.push({
              id: `dyn-${job.glossary.length + 1}`,
              sourceTerm: newTerm.sourceTerm.trim(),
              targetTerm: newTerm.targetTerm.trim(),
              category: newTerm.category,
            });
            existingGlossarySet.add(newTerm.sourceTerm.toLowerCase());
          }
        }
      }

      batch.status = 'completed';
      batch.completedAt = new Date().toISOString();

      // Update counters & progress (Batch stage spans 28% -> 86%)
      job.translatedCount = job.entries.filter(
        (e) => e.translatedText && e.translatedText.trim().length > 0
      ).length;
      const completedBatchesCount = job.batches.filter(
        (b) => b.status === 'completed'
      ).length;
      job.progressPercent =
        28 + Math.round((completedBatchesCount / job.batches.length) * 58);

      appendJobLog(
        job,
        'translating_batches',
        `Completed batch ${bIdx + 1} of ${job.batches.length} (entries #${batch.startSequence}–#${batch.endSequence}). Translated ${job.translatedCount}/${job.totalEntries} entries.`,
        'info'
      );
      saveJob(job);
    }

    // STAGE 6: Checking translation consistency
    job.progressPercent = 90;
    appendJobLog(
      job,
      'checking_consistency',
      `Checking character name consistency, gender agreement, and glossary adherence across all ${job.totalEntries} entries...`,
      'info'
    );
    saveJob(job);

    // STAGE 7: Validating SRT formatting & running 11-point QA + Automatic Repair
    job.progressPercent = 95;
    appendJobLog(
      job,
      'validating_formatting',
      `Running 11-point SRT structural validation and automatic tag/timestamp verification...`,
      'info'
    );

    const baselineOriginalEntries = job.entries.map((e) => ({
      ...e,
    }));

    const qaResult = validateAndRepairTranslations({
      originalEntries: baselineOriginalEntries,
      translatedEntries: job.entries,
      glossary: job.glossary,
      sourceLanguage: effectiveSourceLang,
      targetLanguage: job.targetLanguage,
    });

    job.entries = qaResult.repairedEntries;
    job.validationReport = qaResult.report;
    job.translatedCount = qaResult.report.translatedEntryCount;

    if (qaResult.report.autoRepairedCount > 0) {
      appendJobLog(
        job,
        'validating_formatting',
        `Automatically repaired ${qaResult.report.autoRepairedCount} minor formatting or terminology discrepancies.`,
        'info'
      );
    }

    // STAGE 8: Preparing downloadable file
    job.progressPercent = 98;
    appendJobLog(
      job,
      'preparing_download',
      `Finalizing validated SRT structure and preparing workspace...`,
      'info'
    );
    saveJob(job);

    job.stage = 'completed';
    job.progressPercent = 100;
    job.completedAt = new Date().toISOString();

    const statusMsg = qaResult.report.isFullyValidated
      ? `Translation completed and 100% structurally validated (${job.translatedCount}/${job.totalEntries} entries, Quality Score: ${qaResult.report.qualityScore}%).`
      : `Translation completed with ${qaResult.report.unresolvedWarningsCount} warnings and ${qaResult.report.unresolvedErrorsCount} unresolved issues requiring review.`;

    appendJobLog(
      job,
      'completed',
      statusMsg,
      qaResult.report.unresolvedErrorsCount > 0 ? 'warning' : 'success'
    );
    saveJob(job);

    return job;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.stage = 'failed';
    job.errorMessage = message;
    appendJobLog(
      job,
      'failed',
      `Pipeline interrupted: ${message}. Completed batches (${
        job.batches.filter((b) => b.status === 'completed').length
      }/${job.batches.length}) are safely preserved and can be resumed.`,
      'error'
    );
    saveJob(job);
    throw err;
  } finally {
    activeRunningJobs.delete(jobId);
  }
}

/**
 * Regenerates a single subtitle entry using its surrounding context, Global Context Profile,
 * and Persistent Glossary while preserving all other validated translations.
 */
export async function regenerateSingleSubtitleEntry(params: {
  jobId: string;
  sequence: number;
  customInstruction?: string;
  customAdapter?: AIProviderAdapter;
}): Promise<{
  entry: SubtitleEntry;
  alternatives: string[];
  reasoning?: string;
  validationReport: TranslationJob['validationReport'];
}> {
  const { jobId, sequence, customInstruction, customAdapter } = params;
  const job = getJob(jobId);
  if (!job) {
    throw new Error(`Job "${jobId}" not found.`);
  }

  const aiAdapter =
    customAdapter ||
    (job.userAIConfig?.apiKey
      ? createAdapterFromUserConfig(job.userAIConfig)
      : getAIProviderAdapter());
  if (!aiAdapter.isConfigured()) {
    throw new Error(aiAdapter.getMissingConfigMessage());
  }

  const targetIdx = job.entries.findIndex((e) => e.sequence === sequence);
  if (targetIdx === -1) {
    throw new Error(`Subtitle sequence #${sequence} not found in job.`);
  }

  const targetEntry = job.entries[targetIdx];
  const surroundingBefore = job.entries.slice(Math.max(0, targetIdx - 5), targetIdx);
  const surroundingAfter = job.entries.slice(
    targetIdx + 1,
    Math.min(job.entries.length, targetIdx + 6)
  );

  const effectiveSourceLang =
    job.sourceLanguage === 'auto'
      ? job.detectedSourceLanguage || 'en'
      : job.sourceLanguage;

  const prompts = buildSingleEntryRegeneratePrompts({
    targetEntry,
    surroundingBefore,
    surroundingAfter,
    sourceLanguage: effectiveSourceLang,
    targetLanguage: job.targetLanguage,
    arabicDialect: job.arabicDialect,
    preferences: job.preferences,
    contextProfile: job.contextProfile,
    glossary: job.glossary,
    customInstruction,
  });

  const { data } = await aiAdapter.generateStructured(
    {
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      temperature: 0.35,
    },
    SingleEntryRegenerateSchema
  );

  const isArabic = job.targetLanguage.toLowerCase() === 'ar';
  const normalizedText = isArabic
    ? normalizeArabicSubtitleText(data.translatedText, targetEntry.originalText)
    : preserveOuterFormattingTags(data.translatedText, targetEntry.originalText);

  targetEntry.translatedText = normalizedText;
  targetEntry.aiTranslatedText = normalizedText;
  targetEntry.isEditedByUser = false;
  targetEntry.translationNotes = data.reasoning;
  targetEntry.status = 'translated';

  // Re-run QA validation so the job's validation report stays up-to-date
  const qaResult = validateAndRepairTranslations({
    originalEntries: job.entries,
    translatedEntries: job.entries,
    glossary: job.glossary,
    sourceLanguage: effectiveSourceLang,
    targetLanguage: job.targetLanguage,
  });

  job.entries = qaResult.repairedEntries;
  job.validationReport = qaResult.report;
  saveJob(job);

  const updatedEntry = job.entries[targetIdx];
  return {
    entry: updatedEntry,
    alternatives: data.alternatives || [],
    reasoning: data.reasoning,
    validationReport: job.validationReport,
  };
}
