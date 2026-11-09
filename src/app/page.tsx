'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Play,
  AlertCircle,
  ShieldCheck,
  Layers,
  BookOpen,
  Languages,
  Loader2,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  ArabicDialect,
  JobSummary,
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
  getLastActiveClientJob,
  listClientJobSummaries,
  saveClientJob,
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
import { SettingsModal } from '@/components/SettingsModal';
import { PrivacyModal } from '@/components/PrivacyModal';

export default function HomePage() {
  const { uiLang, t } = useApp();

  const [activeView, setActiveView] = useState<
    'dashboard' | 'progress' | 'workspace' | 'history'
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

  // Active Job & Recent Jobs History
  const [activeJob, setActiveJob] = useState<TranslationJob | null>(null);
  const [isProcessingJob, setIsProcessingJob] = useState(false);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [startError, setStartError] = useState<string | null>(null);

  // AI Provider Configuration & Modals
  const [aiConfig, setAiConfig] = useState<ServerAIConfigState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const fetchAIConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      const data = res.ok ? await res.json() : null;
      const merged = applyUserConfigToAIState(data, loadStoredUserConfig());
      setAiConfig(merged);
    } catch {
      const fallback = applyUserConfigToAIState(null, loadStoredUserConfig());
      setAiConfig(fallback);
    }
  }, []);

  const fetchRecentJobs = useCallback(() => {
    const summaries = listClientJobSummaries();
    setRecentJobs(summaries);
  }, []);

  // Load initial config, recent jobs, and restore last active job from client storage
  useEffect(() => {
    fetchAIConfig();
    fetchRecentJobs();

    const restored = getLastActiveClientJob();
    if (restored) {
      setActiveJob(restored);
    }
  }, [fetchAIConfig, fetchRecentJobs]);

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

    setIsProcessingJob(true);
    setActiveJob({ ...job });

    try {
      const effectiveSourceLang =
        job.sourceLanguage === 'auto'
          ? job.detectedSourceLanguage || 'en'
          : job.sourceLanguage;

      // STAGE 3: Global Storyline & Glossary Context Analysis (12% -> 25%)
      if (!job.contextProfile) {
        job.progressPercent = 14;
        appendClientJobLog(
          job,
          'analyzing_storyline',
          `Starting full-file contextual storyline analysis across all ${job.totalEntries} subtitle entries...`,
          'info'
        );
        saveClientJob(job);
        setActiveJob({ ...job });

        const analyzeRes = await fetch('/api/pipeline/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: job.entries,
            sourceLanguage: effectiveSourceLang,
            targetLanguage: job.targetLanguage,
            arabicDialect: job.arabicDialect,
            preferences: job.preferences,
            userAIConfig,
          }),
        });

        const analyzeData = await analyzeRes.json().catch(() => ({}));
        if (!analyzeRes.ok) {
          throw new Error(
            analyzeData.error || 'Failed to analyze subtitle storyline context.'
          );
        }

        job.contextProfile = analyzeData.contextProfile;
        job.aiProviderUsed = analyzeData.provider;
        job.aiModelUsed = analyzeData.model;

        if (analyzeData.detectedSourceLanguage && job.sourceLanguage === 'auto') {
          job.detectedSourceLanguage = analyzeData.detectedSourceLanguage;
        }

        if (Array.isArray(analyzeData.glossary)) {
          const existingKeys = new Set(
            job.glossary.map((g) => g.sourceTerm.toLowerCase())
          );
          for (const item of analyzeData.glossary) {
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
          `Completed storyline analysis (${job.totalEntries}/${job.totalEntries} entries covered). Identified ${
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
        fetchRecentJobs();
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
      fetchRecentJobs();
      setIsProcessingJob(false);
      setActiveView('workspace');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Translation pipeline interrupted.';
      job.stage = 'failed';
      job.errorMessage = message;
      const completedCount = job.batches.filter(
        (b) => b.status === 'completed'
      ).length;
      appendClientJobLog(
        job,
        'failed',
        `Pipeline interrupted: ${message}. Completed batches (${completedCount}/${job.batches.length}) are safely saved in your browser and can be resumed without losing any tokens.`,
        'error'
      );
      saveClientJob(job);
      setActiveJob({ ...job });
      fetchRecentJobs();
      setIsProcessingJob(false);
    }
  };

  const handleStartTranslation = async () => {
    if (!uploadedFile) return;
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
      fetchRecentJobs();
      setActiveView('progress');

      await runClientDrivenPipeline(createdJob);
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : 'Failed to start translation.'
      );
      setIsProcessingJob(false);
    }
  };

  const handleResumeJob = async (jobId: string) => {
    setStartError(null);
    const saved = getClientJob(jobId);
    if (saved) {
      setActiveJob(saved);
      setActiveView('progress');
      await runClientDrivenPipeline(saved);
    }
  };

  const handleOpenJobInWorkspace = async (jobId: string) => {
    const saved = getClientJob(jobId);
    if (saved) {
      setActiveJob(saved);
      setActiveView(saved.stage === 'completed' ? 'workspace' : 'progress');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    deleteClientJob(jobId);
    if (activeJob?.id === jobId) {
      setActiveJob(null);
      setActiveView('dashboard');
    }
    fetchRecentJobs();
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
            {/* Hero Banner */}
            <div className="rounded-3xl bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 text-white p-6 sm:p-8 border border-indigo-500/20 shadow-md relative overflow-hidden">
              <div className="max-w-3xl space-y-3 relative z-10">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t.hero.badge}
                </span>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight">
                  {t.hero.title}
                </h1>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {t.hero.subtitle}
                </p>

                {/* Feature Highlights */}
                <div className="pt-2 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs text-slate-300">
                  <div className="flex items-center gap-1.5 bg-white/5 px-3 py-2 rounded-xl border border-white/10">
                    <BookOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>{uiLang === 'ar' ? 'تحليل القصة كاملة' : 'Full-Script Analysis'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/5 px-3 py-2 rounded-xl border border-white/10">
                    <Languages className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{uiLang === 'ar' ? 'محرك تعريب احترافي' : 'Native Arabic Engine'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/5 px-3 py-2 rounded-xl border border-white/10">
                    <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{uiLang === 'ar' ? 'نوافذ سياق متداخلة' : 'Context Window Chunks'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/5 px-3 py-2 rounded-xl border border-white/10">
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>{uiLang === 'ar' ? 'حفظ 100% للتوقيت' : '100% SRT Sync Intact'}</span>
                  </div>
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
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
              <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
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
                className="px-6 py-3.5 rounded-xl text-sm sm:text-base font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-45 disabled:pointer-events-none text-white shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2.5 transition-all"
              >
                {isProcessingJob ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t.actions.translating}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-current" />
                    <span>{t.actions.startTranslation}</span>
                  </>
                )}
              </button>
            </div>

            {/* Recent Translation History Section */}
            {recentJobs.length > 0 && (
              <RecentHistory
                jobs={recentJobs.slice(0, 5)}
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
            onResumeJob={() => handleResumeJob(activeJob.id)}
            onOpenWorkspace={() => setActiveView('workspace')}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {/* VIEW 3: FULL SUBTITLE REVIEW WORKSPACE & EDITOR */}
        {activeView === 'workspace' && activeJob && (
          <SubtitleWorkspace
            job={activeJob}
            onJobUpdated={(updated) => {
              setActiveJob(updated);
              fetchRecentJobs();
            }}
            onStartNewTranslation={() => setActiveView('dashboard')}
          />
        )}

        {/* VIEW 4: FULL RECENT TRANSLATION HISTORY */}
        {activeView === 'history' && (
          <RecentHistory
            jobs={recentJobs}
            onOpenJob={handleOpenJobInWorkspace}
            onResumeJob={handleResumeJob}
            onDeleteJob={handleDeleteJob}
          />
        )}
      </main>

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
