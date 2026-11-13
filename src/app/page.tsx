'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Sparkles,
  Play,
  AlertCircle,
  ShieldCheck,
  Layers,
  BookOpen,
  Languages,
  Loader2,
  Mail,
} from 'lucide-react';

function GithubIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}
import { useApp } from '@/context/AppContext';
import {
  ArabicDialect,
  SubtitleEntry,
  TranslationJob,
  TranslationPreferencesConfig,
} from '@/types/subtitle';
import { ServerAIConfigState } from '@/lib/ai/types';
import {
  applyUserConfigToAIState,
  getActiveUserClientAIConfig,
  loadStoredUserConfig,
} from '@/lib/storage/client-config';
import {
  appendClientJobLog,
  createClientJobFromSrt,
  deleteClientJob,
  getClientJob,
  getClientJobSummariesSnapshot,
  getLastActiveClientJobSnapshot,
  getServerActiveJobSnapshot,
  getServerJobSummariesSnapshot,
  saveClientJob,
  subscribeClientJobs,
} from '@/lib/storage/client-job-store';
import { createContextualBatches } from '@/lib/translation/chunker';
import { validateAndRepairTranslations } from '@/lib/translation/validator';
import { Navbar } from '@/components/Navbar';
import { UploadedFileState, UploadZone } from '@/components/UploadZone';
import { LanguageSelectors } from '@/components/LanguageSelectors';
import { TranslationPreferences } from '@/components/TranslationPreferences';
import { ProgressTracker } from '@/components/ProgressTracker';
import { SubtitleWorkspace } from '@/components/SubtitleWorkspace';
import { RecentHistory } from '@/components/RecentHistory';
import { SubtitleSyncTool } from '@/components/SubtitleSyncTool';
import { SettingsModal } from '@/components/SettingsModal';
import { PrivacyModal } from '@/components/PrivacyModal';

export default function HomePage() {
  const { uiLang, t } = useApp();

  const [activeView, setActiveView] = useState<
    'dashboard' | 'progress' | 'workspace' | 'history' | 'sync'
  >('dashboard');

  // Step 1: Uploaded SRT file state
  const [uploadedFile, setUploadedFile] = useState<UploadedFileState | null>(null);

  // Step 2 & 3: Languages & Arabic Dialect
  const [sourceLanguage, setSourceLanguage] = useState<string>('auto');
  const [targetLanguage, setTargetLanguage] = useState<string>('ar');
  const [arabicDialect, setArabicDialect] = useState<ArabicDialect>('msa');

  // Step 4: Translation Preferences
  const [preferences, setPreferences] = useState<TranslationPreferencesConfig>({
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
    customInstructions: '',
  });

  // Active Job & Recent Jobs History (hydrated via external localStorage store)
  const restoredActiveJob = useSyncExternalStore(
    subscribeClientJobs,
    getLastActiveClientJobSnapshot,
    getServerActiveJobSnapshot
  );
  const recentJobs = useSyncExternalStore(
    subscribeClientJobs,
    getClientJobSummariesSnapshot,
    getServerJobSummariesSnapshot
  );
  const [activeJobOverride, setActiveJobOverride] = useState<
    TranslationJob | null | undefined
  >(undefined);
  const activeJob =
    activeJobOverride === undefined ? restoredActiveJob : activeJobOverride;
  const setActiveJob = setActiveJobOverride;

  const [isProcessingJob, setIsProcessingJob] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const isPipelineRunningRef = useRef(false);
  const pipelineAbortControllerRef = useRef<AbortController | null>(null);
  const userAbortedRef = useRef(false);
  const deletedDuringRunIdsRef = useRef<Set<string>>(new Set());
  const [startError, setStartError] = useState<string | null>(null);

  // AI Provider Configuration & Modals
  const [aiConfig, setAiConfig] = useState<ServerAIConfigState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Load initial non-secret server AI status and merge with browser BYOK config
  useEffect(() => {
    let cancelled = false;

    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        const merged = applyUserConfigToAIState(data, loadStoredUserConfig());
        setAiConfig(merged);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Executes the translation pipeline step-by-step from the client browser using stateless API calls.
   * Immune to serverless container resets, 404 polling errors, and execution timeouts on Vercel.
   * Checkpoints progress into browser localStorage after every single step and batch.
   */
  const runClientDrivenPipeline = async (initialJob: TranslationJob) => {
    const job: TranslationJob = {
      ...initialJob,
      entries: initialJob.entries.map((e) => ({ ...e })),
      batches: initialJob.batches.map((b) => ({ ...b })),
      glossary: [...initialJob.glossary],
      logs: [...initialJob.logs],
      warnings: [...initialJob.warnings],
      errorMessage: undefined,
    };

    const userAIConfig = getActiveUserClientAIConfig() || job.userAIConfig;
    job.userAIConfig = userAIConfig;

    const controller = new AbortController();
    pipelineAbortControllerRef.current = controller;
    userAbortedRef.current = false;
    deletedDuringRunIdsRef.current.delete(job.id);
    setIsCancelling(false);
    setIsProcessingJob(true);
    setActiveJob({ ...job });

    const throwIfAborted = () => {
      if (controller.signal.aborted) {
        throw new DOMException('Aborted by user', 'AbortError');
      }
    };

    try {
      const effectiveSourceLang =
        job.sourceLanguage === 'auto'
          ? job.detectedSourceLanguage || 'en'
          : job.sourceLanguage;

      // STAGE 3: Global Storyline & Glossary Context Analysis (12% -> 25%)
      // Uses sequential 350-entry segment passes + synthesis so 100% of long films are analyzed
      // without hitting serverless execution timeouts.
      if (!job.contextProfile) {
        const ANALYSIS_SEGMENT_SIZE = 350;
        const segments: SubtitleEntry[][] = [];
        for (let i = 0; i < job.entries.length; i += ANALYSIS_SEGMENT_SIZE) {
          segments.push(job.entries.slice(i, i + ANALYSIS_SEGMENT_SIZE));
        }

        job.progressPercent = 13;
        appendClientJobLog(
          job,
          'analyzing_storyline',
          `Starting full-file contextual storyline analysis across all ${job.totalEntries} subtitle entries (${segments.length} pass${segments.length > 1 ? 'es' : ''})...`,
          'info'
        );
        saveClientJob(job);
        setActiveJob({ ...job });

        const partialAnalyses: unknown[] = [];
        let previousStoryline = '';
        let previousCharactersSummary = '';
        let finalAnalyzeData: {
          contextProfile?: TranslationJob['contextProfile'];
          glossary?: TranslationJob['glossary'];
          detectedSourceLanguage?: string;
          provider?: TranslationJob['aiProviderUsed'];
          model?: string;
        } = {};

        for (let sIdx = 0; sIdx < segments.length; sIdx++) {
          throwIfAborted();
          const seg = segments[sIdx];
          const firstSeq = seg[0]?.sequence ?? 1;
          const lastSeq = seg[seg.length - 1]?.sequence ?? seg.length;

          if (segments.length > 1) {
            job.progressPercent = 13 + Math.round(((sIdx + 0.5) / (segments.length + 1)) * 10);
            appendClientJobLog(
              job,
              'analyzing_storyline',
              `Analyzing script segment ${sIdx + 1} of ${segments.length} (entries #${firstSeq}–#${lastSeq})...`,
              'info'
            );
            saveClientJob(job);
            setActiveJob({ ...job });
          }

          const segRes = await fetch('/api/pipeline/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              mode: 'segment',
              segmentEntries: seg,
              segmentIndex: sIdx,
              totalSegments: segments.length,
              totalEntriesInFile: job.totalEntries,
              previousStoryline: previousStoryline || undefined,
              previousCharactersSummary: previousCharactersSummary || undefined,
              sourceLanguage: effectiveSourceLang,
              targetLanguage: job.targetLanguage,
              arabicDialect: job.arabicDialect,
              preferences: job.preferences,
              userAIConfig,
            }),
          });

          const segData = await segRes.json().catch(() => ({}));
          if (!segRes.ok) {
            throw new Error(
              segData.error || `Failed to analyze script segment ${sIdx + 1} of ${segments.length}.`
            );
          }

          partialAnalyses.push(segData.partialAnalysis);
          finalAnalyzeData = segData;

          if (segData.contextProfile?.subjectAndStoryline) {
            previousStoryline = segData.contextProfile.subjectAndStoryline;
          }
          if (Array.isArray(segData.contextProfile?.characters)) {
            previousCharactersSummary = segData.contextProfile.characters
              .map((c: { name: string; gender: string; translatedName: string }) => `${c.name} (${c.gender}): ${c.translatedName}`)
              .slice(0, 30)
              .join(', ');
          }
        }

        if (segments.length > 1) {
          throwIfAborted();
          job.progressPercent = 23;
          appendClientJobLog(
            job,
            'analyzing_storyline',
            `Synthesizing master Context Profile & Glossary across all ${job.totalEntries} analyzed entries...`,
            'info'
          );
          saveClientJob(job);
          setActiveJob({ ...job });

          const synthRes = await fetch('/api/pipeline/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              mode: 'synthesize',
              partialAnalyses,
              totalEntriesInFile: job.totalEntries,
              sourceLanguage: effectiveSourceLang,
              targetLanguage: job.targetLanguage,
              arabicDialect: job.arabicDialect,
              preferences: job.preferences,
              userAIConfig,
            }),
          });

          const synthData = await synthRes.json().catch(() => ({}));
          if (!synthRes.ok) {
            throw new Error(
              synthData.error || 'Failed to synthesize full-file context profile.'
            );
          }
          finalAnalyzeData = synthData;
        }

        job.contextProfile = finalAnalyzeData.contextProfile;
        job.aiProviderUsed = finalAnalyzeData.provider;
        job.aiModelUsed = finalAnalyzeData.model;

        if (finalAnalyzeData.detectedSourceLanguage && job.sourceLanguage === 'auto') {
          job.detectedSourceLanguage = finalAnalyzeData.detectedSourceLanguage;
        }

        if (Array.isArray(finalAnalyzeData.glossary)) {
          const existingKeys = new Set(
            job.glossary.map((g) => g.sourceTerm.toLowerCase())
          );
          for (const item of finalAnalyzeData.glossary) {
            if (
              item.sourceTerm &&
              item.targetTerm &&
              !existingKeys.has(item.sourceTerm.toLowerCase())
            ) {
              job.glossary.push(item);
              existingKeys.add(item.sourceTerm.toLowerCase());
            }
          }
        }

        job.progressPercent = 24;
        appendClientJobLog(
          job,
          'analyzing_storyline',
          `Completed 100% full-script storyline analysis (${job.totalEntries}/${job.totalEntries} entries covered across ${segments.length} segment${segments.length > 1 ? 's' : ''}). Identified ${
            job.contextProfile?.characters.length || 0
          } characters and ${job.glossary.length} glossary terms.`,
          'success'
        );
        saveClientJob(job);
        setActiveJob({ ...job });
      }

      // STAGE 4: Building Context & Batch Organization (26%)
      if (!job.batches || job.batches.length === 0) {
        job.batches = createContextualBatches(job.entries, {
          batchSize: job.preferences.batchSize,
          contextOverlapSize: job.preferences.contextOverlapSize,
        });
        job.totalBatches = job.batches.length;
      }

      job.progressPercent = 26;
      appendClientJobLog(
        job,
        'building_context',
        `Prepared character voice profiles, persistent glossary (${job.glossary.length} terms), and ${job.batches.length} context-linked batches.`,
        'info'
      );
      saveClientJob(job);
      setActiveJob({ ...job });

      // STAGE 5: Sequential Stateless Batch Translation (28% -> 88%)
      const entryMap = new Map<number, SubtitleEntry>();
      for (const e of job.entries) {
        entryMap.set(e.sequence, e);
      }

      appendClientJobLog(
        job,
        'translating_batches',
        `Translating ${job.totalEntries} subtitles across ${job.batches.length} context-linked batches...`,
        'info'
      );
      saveClientJob(job);
      setActiveJob({ ...job });

      for (let bIdx = 0; bIdx < job.batches.length; bIdx++) {
        throwIfAborted();
        const batch = job.batches[bIdx];
        job.currentBatch = bIdx + 1;

        const allEntriesAlreadyTranslated = batch.entrySequences.every((seq) => {
          const entry = entryMap.get(seq);
          return Boolean(
            entry && entry.translatedText && entry.translatedText.trim().length > 0
          );
        });

        if (batch.status === 'completed' && allEntriesAlreadyTranslated) {
          continue;
        }

        batch.status = 'processing';
        batch.attempts = (batch.attempts || 0) + 1;
        saveClientJob(job);
        setActiveJob({ ...job });

        const batchEntries = batch.entrySequences
          .map((seq) => entryMap.get(seq))
          .filter((e): e is SubtitleEntry => Boolean(e));
        const precedingEntries = batch.precedingContextSequences
          .map((seq) => entryMap.get(seq))
          .filter((e): e is SubtitleEntry => Boolean(e));
        const followingEntries = batch.followingContextSequences
          .map((seq) => entryMap.get(seq))
          .filter((e): e is SubtitleEntry => Boolean(e));

        const batchRes = await fetch('/api/pipeline/translate-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            batchEntries,
            precedingEntries,
            followingEntries,
            sourceLanguage:
              job.sourceLanguage === 'auto'
                ? job.detectedSourceLanguage || 'en'
                : job.sourceLanguage,
            targetLanguage: job.targetLanguage,
            arabicDialect: job.arabicDialect,
            preferences: job.preferences,
            contextProfile: job.contextProfile,
            glossary: job.glossary,
            userAIConfig,
          }),
        });

        const batchData = await batchRes.json().catch(() => ({}));
        if (!batchRes.ok) {
          throw new Error(
            batchData.error ||
              `Failed to translate batch ${bIdx + 1} of ${job.batches.length}.`
          );
        }

        if (Array.isArray(batchData.translations)) {
          for (const item of batchData.translations) {
            const targetEntry = entryMap.get(item.sequence);
            if (targetEntry && item.translatedText) {
              if (!targetEntry.isEditedByUser) {
                targetEntry.translatedText = item.translatedText;
              }
              targetEntry.aiTranslatedText =
                item.aiTranslatedText || item.translatedText;
              targetEntry.status = targetEntry.isEditedByUser
                ? 'edited'
                : 'translated';
            }
          }
        }

        if (Array.isArray(batchData.newGlossaryTerms)) {
          const existingSet = new Set(
            job.glossary.map((g) => g.sourceTerm.toLowerCase())
          );
          for (const newTerm of batchData.newGlossaryTerms) {
            if (
              newTerm.sourceTerm &&
              newTerm.targetTerm &&
              !existingSet.has(newTerm.sourceTerm.toLowerCase())
            ) {
              job.glossary.push({
                id: `dyn-${job.glossary.length + 1}`,
                sourceTerm: newTerm.sourceTerm.trim(),
                targetTerm: newTerm.targetTerm.trim(),
                category: newTerm.category || 'terminology',
              });
              existingSet.add(newTerm.sourceTerm.toLowerCase());
            }
          }
        }

        batch.status = 'completed';
        batch.completedAt = new Date().toISOString();

        job.translatedCount = job.entries.filter(
          (e) => e.translatedText && e.translatedText.trim().length > 0
        ).length;
        const completedBatchesCount = job.batches.filter(
          (b) => b.status === 'completed'
        ).length;
        job.progressPercent =
          28 + Math.round((completedBatchesCount / job.batches.length) * 60);

        appendClientJobLog(
          job,
          'translating_batches',
          `Completed batch ${bIdx + 1} of ${job.batches.length} (entries #${batch.startSequence}–#${batch.endSequence}). Translated ${job.translatedCount}/${job.totalEntries} entries.`,
          'info'
        );

        saveClientJob(job);
        setActiveJob({ ...job });
      }

      // STAGE 6 & 7: Consistency & 11-Point QA Validation + Auto-Repair (90% -> 100%)
      job.progressPercent = 92;
      appendClientJobLog(
        job,
        'checking_consistency',
        `Checking character name consistency, gender agreement, and glossary adherence across all ${job.totalEntries} entries...`,
        'info'
      );
      setActiveJob({ ...job });

      job.progressPercent = 96;
      appendClientJobLog(
        job,
        'validating_formatting',
        `Running 11-point SRT structural validation and automatic tag/timestamp verification...`,
        'info'
      );

      const qaResult = validateAndRepairTranslations({
        originalEntries: job.entries.map((e) => ({ ...e })),
        translatedEntries: job.entries,
        glossary: job.glossary,
        sourceLanguage:
          job.sourceLanguage === 'auto'
            ? job.detectedSourceLanguage || 'en'
            : job.sourceLanguage,
        targetLanguage: job.targetLanguage,
      });

      job.entries = qaResult.repairedEntries;
      job.validationReport = qaResult.report;
      job.translatedCount = qaResult.report.translatedEntryCount;

      if (qaResult.report.autoRepairedCount > 0) {
        appendClientJobLog(
          job,
          'validating_formatting',
          `Automatically repaired ${qaResult.report.autoRepairedCount} minor formatting or terminology discrepancies.`,
          'info'
        );
      }

      job.stage = 'completed';
      job.progressPercent = 100;
      job.completedAt = new Date().toISOString();

      const statusMsg = qaResult.report.isFullyValidated
        ? `Translation completed and 100% structurally validated (${job.translatedCount}/${job.totalEntries} entries, Quality Score: ${qaResult.report.qualityScore}%).`
        : `Translation completed with ${qaResult.report.unresolvedWarningsCount} warnings requiring review.`;

      appendClientJobLog(
        job,
        'completed',
        statusMsg,
        qaResult.report.unresolvedErrorsCount > 0 ? 'warning' : 'success'
      );

      saveClientJob(job);
      setActiveJob({ ...job });
      setActiveView('workspace');
    } catch (err) {
      if (deletedDuringRunIdsRef.current.has(job.id)) {
        return;
      }

      for (const b of job.batches) {
        if (b.status === 'processing') {
          b.status = 'pending';
        }
      }

      const wasAborted =
        userAbortedRef.current ||
        controller.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      const completedCount = job.batches.filter(
        (b) => b.status === 'completed'
      ).length;

      if (wasAborted) {
        job.stage = 'paused';
        job.errorMessage = undefined;
        appendClientJobLog(
          job,
          'paused',
          `Translation paused by user. Completed batches (${completedCount}/${job.batches.length}) are saved and ready to resume anytime.`,
          'warning'
        );
      } else {
        const message =
          err instanceof Error ? err.message : 'Translation pipeline interrupted.';
        job.stage = 'failed';
        job.errorMessage = message;
        appendClientJobLog(
          job,
          'failed',
          `Pipeline interrupted: ${message}. Completed batches (${completedCount}/${job.batches.length}) are safely saved in your browser and can be resumed without losing any tokens.`,
          'error'
        );
      }

      saveClientJob(job);
      setActiveJob({ ...job });
    } finally {
      pipelineAbortControllerRef.current = null;
      userAbortedRef.current = false;
      setIsCancelling(false);
      isPipelineRunningRef.current = false;
      setIsProcessingJob(false);
    }
  };

  const handleStartTranslation = async () => {
    if (!uploadedFile || isPipelineRunningRef.current) return;
    isPipelineRunningRef.current = true;
    setIsProcessingJob(true);
    setStartError(null);

    try {
      const userAIConfig = getActiveUserClientAIConfig();
      const createdJob = createClientJobFromSrt({
        fileName: uploadedFile.fileName,
        fileContent: uploadedFile.content,
        sourceLanguage,
        targetLanguage,
        arabicDialect: targetLanguage === 'ar' ? arabicDialect : undefined,
        preferences,
        userAIConfig,
      });

      setActiveJob(createdJob);
      setActiveView('progress');

      await runClientDrivenPipeline(createdJob);
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : 'Failed to start translation.'
      );
      isPipelineRunningRef.current = false;
      setIsProcessingJob(false);
    }
  };

  const handleResumeJob = async (jobId: string) => {
    if (isPipelineRunningRef.current) return;
    setStartError(null);
    const saved = getClientJob(jobId);
    if (!saved) return;
    if (saved.stage === 'completed') {
      setActiveJob(saved);
      setActiveView('workspace');
      return;
    }

    isPipelineRunningRef.current = true;
    setIsProcessingJob(true);
    setActiveJob(saved);
    setActiveView('progress');
    await runClientDrivenPipeline(saved);
  };

  const handleOpenJobInWorkspace = async (jobId: string) => {
    const saved = getClientJob(jobId);
    if (saved) {
      setActiveJob(saved);
      setActiveView(saved.stage === 'completed' ? 'workspace' : 'progress');
    }
  };

  const handleCancelTranslation = () => {
    if (!isPipelineRunningRef.current || !pipelineAbortControllerRef.current) return;
    userAbortedRef.current = true;
    setIsCancelling(true);
    pipelineAbortControllerRef.current.abort();
  };

  const handleDeleteJob = async (jobId: string) => {
    if (isPipelineRunningRef.current && activeJob?.id === jobId) {
      deletedDuringRunIdsRef.current.add(jobId);
      userAbortedRef.current = true;
      pipelineAbortControllerRef.current?.abort();
    }
    deleteClientJob(jobId);
    if (activeJob?.id === jobId) {
      setActiveJob(null);
      setActiveView('dashboard');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <Navbar
        activeView={activeView}
        onNavigate={setActiveView}
        hasActiveJob={Boolean(activeJob)}
        aiConfig={aiConfig}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPrivacy={() => setPrivacyOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* VIEW 1: MAIN TRANSLATION DASHBOARD */}
        {activeView === 'dashboard' && (
          <div className="space-y-6">
            {/* Hero Banner with Dynamic Light/Dark Theme Support */}
            <div className="rounded-3xl bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/60 dark:from-indigo-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-white p-6 sm:p-8 border border-indigo-100 dark:border-indigo-500/20 shadow-sm dark:shadow-md relative overflow-hidden transition-colors">
              <div className="relative z-10 space-y-5">
                <div className="max-w-3xl space-y-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100/90 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-400/30">
                    <Sparkles className="w-3.5 h-3.5" />
                    {t.hero.badge}
                  </span>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight text-slate-900 dark:text-white">
                    {t.hero.title}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t.hero.subtitle}
                  </p>
                </div>

                {/* Feature Highlights */}
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                  {[
                    {
                      icon: BookOpen,
                      iconClass: 'text-indigo-600 dark:text-indigo-400',
                      label: uiLang === 'ar' ? 'تحليل القصة كاملة' : 'Full-Script Analysis',
                    },
                    {
                      icon: Languages,
                      iconClass: 'text-emerald-600 dark:text-emerald-400',
                      label: uiLang === 'ar' ? 'محرك تعريب احترافي' : 'Native Arabic Engine',
                    },
                    {
                      icon: Layers,
                      iconClass: 'text-amber-600 dark:text-amber-400',
                      label: uiLang === 'ar' ? 'نوافذ سياق متداخلة' : 'Context Window Chunks',
                    },
                    {
                      icon: ShieldCheck,
                      iconClass: 'text-sky-600 dark:text-sky-400',
                      label: uiLang === 'ar' ? 'حفظ 100% للتوقيت' : '100% SRT Sync Intact',
                    },
                  ].map(({ icon: Icon, iconClass, label }) => (
                    <div
                      key={label}
                      className="inline-flex items-center gap-2 whitespace-nowrap bg-white/85 dark:bg-white/5 px-3.5 py-2 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-xs dark:shadow-none"
                    >
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${iconClass}`} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Key Missing Notice if not configured */}
            {aiConfig && !aiConfig.isConfigured && (
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs sm:text-sm">
                    <p className="font-bold text-amber-900 dark:text-amber-200">
                      {uiLang === 'ar'
                        ? 'يرجى إعداد مفتاح مزود الذكاء الاصطناعي لبدء الترجمة الفعلية'
                        : 'Configure Your AI Provider Key to Enable Live Translation'}
                    </p>
                    <p className="text-amber-800 dark:text-amber-300 mt-0.5">
                      {aiConfig.missingConfigMessage}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                >
                  {t.nav.aiMissing}
                </button>
              </div>
            )}

            {/* Step 1: Upload Subtitle File */}
            <UploadZone
              uploadedFile={uploadedFile}
              onFileAccepted={(fileState) => {
                setUploadedFile(fileState);
                setStartError(null);
              }}
              onClearFile={() => setUploadedFile(null)}
            />

            {/* Step 2 & Step 3: Language & Arabic Variety Selectors */}
            <LanguageSelectors
              sourceLanguage={sourceLanguage}
              onChangeSourceLanguage={setSourceLanguage}
              detectedLanguage={uploadedFile?.parseResult.detectedLanguage}
              targetLanguage={targetLanguage}
              onChangeTargetLanguage={setTargetLanguage}
              arabicDialect={arabicDialect}
              onChangeArabicDialect={setArabicDialect}
            />

            {/* Step 4: Translation Style & Preferences */}
            <TranslationPreferences
              preferences={preferences}
              onChangePreferences={setPreferences}
            />

            {startError && (
              <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm text-rose-700 dark:text-rose-300">
                {startError}
              </div>
            )}

            {/* Primary Call-To-Action: Start Full-Context AI Translation */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
              <div className="min-w-0 flex-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                {uploadedFile ? (
                  uiLang === 'ar' ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span>
                        جاهز لتحليل وترجمة{' '}
                        <strong className="text-slate-900 dark:text-white">
                          {uploadedFile.parseResult.totalEntries.toLocaleString()}
                        </strong>{' '}
                        سطر ترجمة من الملف:
                      </span>
                      <bdi dir="ltr" className="font-bold text-slate-900 dark:text-white">
                        {uploadedFile.fileName}
                      </bdi>
                    </span>
                  ) : (
                    <span>
                      Ready to analyze and translate{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {uploadedFile.parseResult.totalEntries.toLocaleString()}
                      </strong>{' '}
                      subtitle entries from{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {uploadedFile.fileName}
                      </strong>
                      .
                    </span>
                  )
                ) : (
                  <span>{t.steps.step1Desc}</span>
                )}
              </div>

              <button
                type="button"
                disabled={!uploadedFile || isProcessingJob}
                onClick={handleStartTranslation}
                className="shrink-0 whitespace-nowrap px-4 sm:px-6 py-3.5 rounded-xl text-xs sm:text-sm md:text-base font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-45 disabled:pointer-events-none text-white shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 sm:gap-2.5 transition-all"
              >
                {isProcessingJob ? (
                  <>
                    <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                    <span>{t.actions.translating}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 shrink-0 fill-current" />
                    <span>{t.actions.startTranslation}</span>
                  </>
                )}
              </button>
            </div>

            {/* Recent Translation History Section */}
            {recentJobs.length > 0 && (
              <RecentHistory
                jobs={recentJobs.slice(0, 5)}
                isProcessing={isProcessingJob}
                onOpenJob={handleOpenJobInWorkspace}
                onResumeJob={handleResumeJob}
                onDeleteJob={handleDeleteJob}
              />
            )}
          </div>
        )}

        {/* VIEW 2: REAL-TIME TRANSLATION PROGRESS INTERFACE */}
        {activeView === 'progress' && activeJob && (
          <ProgressTracker
            job={activeJob}
            isProcessing={isProcessingJob}
            isCancelling={isCancelling}
            onCancelJob={handleCancelTranslation}
            onResumeJob={() => handleResumeJob(activeJob.id)}
            onOpenWorkspace={() => setActiveView('workspace')}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {/* VIEW 3: FULL SUBTITLE REVIEW WORKSPACE & EDITOR */}
        {activeView === 'workspace' && activeJob && (
          <SubtitleWorkspace
            key={activeJob.id}
            job={activeJob}
            onJobUpdated={(updated) => {
              setActiveJob(updated);
            }}
            onStartNewTranslation={() => setActiveView('dashboard')}
          />
        )}

        {/* VIEW 4: FULL RECENT TRANSLATION HISTORY */}
        {activeView === 'history' && (
          <RecentHistory
            jobs={recentJobs}
            isProcessing={isProcessingJob}
            onOpenJob={handleOpenJobInWorkspace}
            onResumeJob={handleResumeJob}
            onDeleteJob={handleDeleteJob}
          />
        )}

        {/* VIEW 5: SUBTITLE SYNC & RELEASE CONVERTER */}
        {activeView === 'sync' && <SubtitleSyncTool />}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-bold text-slate-800 dark:text-slate-200">Subtitle Studio</span>
            <span>•</span>
            <span>
              {uiLang === 'ar'
                ? 'منصة تعريب وترجمة ملفات الترجمة السينمائية والتلفزيونية'
                : 'Contextual AI Audiovisual Subtitle Localization Platform'}
            </span>
          </div>

          <div className="flex items-center justify-center gap-3">
            <a
              href="https://github.com/evile92/subtitle-studio"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub Repository"
              aria-label="GitHub Repository"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-all border border-slate-200/80 dark:border-slate-700/60 shadow-xs hover:scale-105"
            >
              <GithubIcon className="w-4 h-4" />
            </a>
            <a
              href="mailto:stellarspeakapp@gmail.com"
              title="stellarspeakapp@gmail.com"
              aria-label="stellarspeakapp@gmail.com"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-all border border-slate-200/80 dark:border-slate-700/60 shadow-xs hover:scale-105"
            >
              <Mail className="w-4 h-4" />
            </a>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        aiConfig={aiConfig}
        onConfigSaved={(updated) => setAiConfig(updated)}
      />

      <PrivacyModal
        isOpen={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
      />
    </div>
  );
}
