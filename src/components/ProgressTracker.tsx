'use client';

import React from 'react';
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Play,
  FileEdit,
  ShieldCheck,
  Terminal,
  Sparkles,
  Layers,
  Hash,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { PipelineStage, TranslationJob } from '@/types/subtitle';
import { getLanguageName } from '@/lib/languages';

interface ProgressTrackerProps {
  job: TranslationJob;
  isProcessing: boolean;
  onResumeJob: () => void;
  onOpenWorkspace: () => void;
  onOpenSettings: () => void;
}

const ORDERED_STAGES: PipelineStage[] = [
  'uploading',
  'parsing',
  'analyzing_storyline',
  'building_context',
  'translating_batches',
  'checking_consistency',
  'validating_formatting',
  'preparing_download',
];

export function ProgressTracker({
  job,
  isProcessing,
  onResumeJob,
  onOpenWorkspace,
  onOpenSettings,
}: ProgressTrackerProps) {
  const { uiLang, t } = useApp();

  const currentStageIndex =
    job.stage === 'completed'
      ? ORDERED_STAGES.length
      : ORDERED_STAGES.indexOf(job.stage);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
      {/* Header & Overall Progress Percentage */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200/80 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {getLanguageName(job.detectedSourceLanguage || job.sourceLanguage, uiLang)}{' '}
              {uiLang === 'ar' ? '←' : '→'}{' '}
              {getLanguageName(job.targetLanguage, uiLang)}
            </span>
            <bdi
              dir="ltr"
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-xs sm:max-w-md">{job.fileName}</span>
            </bdi>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mt-2">
            {t.progress.title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t.progress.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-end">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              {t.progress.overallProgress}
            </span>
            <span className="text-2xl sm:text-3xl font-extrabold text-indigo-600 dark:text-indigo-400">
              {job.progressPercent}%
            </span>
          </div>

          {job.stage === 'completed' && (
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-2 transition-colors"
            >
              <FileEdit className="w-4 h-4" />
              <span>{t.actions.openWorkspace}</span>
            </button>
          )}

          {job.stage === 'failed' && !isProcessing && (
            <button
              type="button"
              onClick={onResumeJob}
              className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs flex items-center gap-2 transition-colors"
            >
              <Play className="w-4 h-4" />
              <span>{t.actions.resumeTranslation}</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            job.stage === 'failed'
              ? 'bg-amber-500'
              : job.stage === 'completed'
                ? 'bg-emerald-500'
                : 'bg-indigo-600'
          }`}
          style={{ width: `${Math.max(4, Math.min(100, job.progressPercent))}%` }}
        />
      </div>

      {/* Key Telemetry Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <span>{t.progress.currentStage}</span>
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">
            {t.progress.stages[job.stage]}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Hash className="w-4 h-4 text-indigo-500" />
            <span>{t.progress.translatedEntries}</span>
          </div>
          <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {job.translatedCount.toLocaleString()}{' '}
            <span className="text-sm font-normal text-slate-400">
              / {job.totalEntries.toLocaleString()}
            </span>
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Layers className="w-4 h-4 text-indigo-500" />
            <span>{t.progress.currentBatch}</span>
          </div>
          <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {job.currentBatch}
            <span className="text-sm font-normal text-slate-400">
              {' '}
              / {job.totalBatches}
            </span>
          </p>
        </div>
      </div>

      {/* Error or Missing AI Configuration Alert */}
      {job.errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm">
              <p className="font-bold text-rose-900 dark:text-rose-200">
                {t.progress.stages.failed}
              </p>
              <p className="text-rose-700 dark:text-rose-300 mt-0.5">
                {job.errorMessage}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {job.errorMessage.includes('API key') && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700 hover:bg-rose-100"
              >
                {t.nav.aiMissing}
              </button>
            )}
            <button
              type="button"
              disabled={isProcessing}
              onClick={onResumeJob}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:pointer-events-none text-white"
            >
              {t.actions.resumeTranslation}
            </button>
          </div>
        </div>
      )}

      {/* 8-Stage Pipeline Checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {ORDERED_STAGES.map((stageKey, index) => {
          const isCompleted =
            job.stage === 'completed' ||
            (currentStageIndex > index && currentStageIndex !== -1);
          const isActive = job.stage === stageKey && isProcessing;

          return (
            <div
              key={stageKey}
              className={`p-3 rounded-xl border flex items-center gap-2.5 text-xs transition-all ${
                isCompleted
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/25 text-emerald-900 dark:text-emerald-200'
                  : isActive
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 text-indigo-950 dark:text-white font-semibold ring-2 ring-indigo-500/20'
                    : 'border-slate-200/70 dark:border-slate-800/70 bg-slate-50/40 dark:bg-slate-950/30 text-slate-400 dark:text-slate-500'
              }`}
            >
              {isCompleted ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : isActive ? (
                <Loader2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-700 shrink-0" />
              )}
              <span className="line-clamp-1">{t.progress.stages[stageKey]}</span>
            </div>
          );
        })}
      </div>

      {/* Live Pipeline Telemetry & Logs */}
      <div className="rounded-xl bg-slate-950 text-slate-200 p-4 border border-slate-800">
        <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800 text-xs text-slate-400">
          <span className="flex items-center gap-2 font-semibold text-slate-300">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            {t.progress.liveActivityLog}
          </span>
          {job.aiProviderUsed && (
            <bdi dir="ltr" className="font-mono text-[11px] text-indigo-300">
              {job.aiProviderUsed.toUpperCase()} • {job.aiModelUsed}
            </bdi>
          )}
        </div>
        <div
          dir="ltr"
          className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs text-left"
        >
          {job.logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2 leading-relaxed">
              <span className="text-slate-500 shrink-0">
                [{new Date(log.timestamp).toLocaleTimeString()}]
              </span>
              <span
                className={
                  log.level === 'error'
                    ? 'text-rose-400'
                    : log.level === 'warning'
                      ? 'text-amber-300'
                      : log.level === 'success'
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                }
              >
                {log.message}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Persistent Job Assurance Note */}
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span>{t.progress.leaveSafeNote}</span>
      </div>
    </div>
  );
}
