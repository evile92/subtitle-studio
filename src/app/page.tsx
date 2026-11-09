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
  TranslationJob,
  TranslationPreferencesConfig,
} from '@/types/subtitle';
import { ServerAIConfigState } from '@/lib/ai/types';
import {
  applyUserConfigToAIState,
  getActiveUserClientAIConfig,
  loadStoredUserConfig,
} from '@/lib/storage/client-config';
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

  const fetchRecentJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = await res.json();
        setRecentJobs(data.jobs || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Load initial config, recent jobs, and restore last active job if any
  useEffect(() => {
    fetchAIConfig();
    fetchRecentJobs();

    try {
      const savedJobId = localStorage.getItem('subtitle_studio_active_job_id');
      if (savedJobId) {
        fetch(`/api/jobs/${savedJobId}`)
          .then((r) => {
            if (r.status === 404) {
              localStorage.removeItem('subtitle_studio_active_job_id');
              return null;
            }
            return r.ok ? r.json() : null;
          })
          .then((data) => {
            if (data?.job) {
              setActiveJob(data.job);
            }
          })
          .catch(() => {});
      }
    } catch {
      // Ignore
    }
  }, [fetchAIConfig, fetchRecentJobs]);

  // Poll job status when a job is actively processing
  useEffect(() => {
    if (!activeJob || !isProcessingJob) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${activeJob.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.job) {
          setActiveJob(data.job);
          if (data.job.stage === 'completed') {
            setIsProcessingJob(false);
            fetchRecentJobs();
            setActiveView('workspace');
          } else if (data.job.stage === 'failed') {
            setIsProcessingJob(false);
            fetchRecentJobs();
          }
        }
      } catch {
        // Continue polling
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeJob, isProcessingJob, fetchRecentJobs]);

  const handleStartTranslation = async () => {
    if (!uploadedFile) return;
    setStartError(null);

    try {
      const userAIConfig = getActiveUserClientAIConfig();

      // 1. Create the job on the server
      const createRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: uploadedFile.fileName,
          fileContent: uploadedFile.content,
          sourceLanguage,
          targetLanguage,
          arabicDialect: targetLanguage === 'ar' ? arabicDialect : undefined,
          preferences,
          userAIConfig,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok || !createData.job) {
        setStartError(createData.error || 'Failed to create translation job.');
        return;
      }

      const createdJob: TranslationJob = createData.job;
      setActiveJob(createdJob);
      try {
        localStorage.setItem('subtitle_studio_active_job_id', createdJob.id);
      } catch {
        // Ignore
      }

      setActiveView('progress');
      setIsProcessingJob(true);

      // 2. Trigger the server-side contextual pipeline asynchronously
      const procRes = await fetch(`/api/jobs/${createdJob.id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true, userAIConfig }),
      });

      if (!procRes.ok) {
        const errData = await procRes.json().catch(() => ({}));
        if (errData.job) setActiveJob(errData.job);
        setIsProcessingJob(false);
      }
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : 'Failed to start translation.'
      );
      setIsProcessingJob(false);
    }
  };

  const handleResumeJob = async (jobId: string) => {
    setStartError(null);
    const res = await fetch(`/api/jobs/${jobId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.job) {
        setActiveJob(data.job);
        try {
          localStorage.setItem('subtitle_studio_active_job_id', data.job.id);
        } catch {
          // Ignore
        }
        setActiveView('progress');
        setIsProcessingJob(true);

        const userAIConfig = getActiveUserClientAIConfig();
        await fetch(`/api/jobs/${jobId}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ async: true, userAIConfig }),
        });
      }
    }
  };

  const handleOpenJobInWorkspace = async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.job) {
        setActiveJob(data.job);
        try {
          localStorage.setItem('subtitle_studio_active_job_id', data.job.id);
        } catch {
          // Ignore
        }
        setActiveView(data.job.stage === 'completed' ? 'workspace' : 'progress');
      }
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    try {
      if (localStorage.getItem('subtitle_studio_active_job_id') === jobId) {
        localStorage.removeItem('subtitle_studio_active_job_id');
      }
    } catch {
      // Ignore
    }
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
