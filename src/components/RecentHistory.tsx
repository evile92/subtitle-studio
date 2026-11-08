'use client';

import React from 'react';
import {
  History,
  FileEdit,
  Play,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { JobSummary } from '@/types/subtitle';
import { getLanguageName } from '@/lib/languages';

interface RecentHistoryProps {
  jobs: JobSummary[];
  onOpenJob: (jobId: string) => void;
  onResumeJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
}

export function RecentHistory({
  jobs,
  onOpenJob,
  onResumeJob,
  onDeleteJob,
}: RecentHistoryProps) {
  const { uiLang, t } = useApp();

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <span>
            {t.history.title} ({jobs.length})
          </span>
        </h2>
      </div>

      {jobs.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          {t.history.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isCompleted = job.stage === 'completed';
            const isFailed = job.stage === 'failed';

            return (
              <div
                key={job.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 hover:border-indigo-300 dark:hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                        {getLanguageName(
                          job.detectedSourceLanguage || job.sourceLanguage,
                          uiLang
                        )}{' '}
                        {uiLang === 'ar' ? '←' : '→'}{' '}
                        {getLanguageName(job.targetLanguage, uiLang)}
                      </span>

                      {isCompleted ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          <bdi dir="ltr">100%</bdi>
                        </span>
                      ) : isFailed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3" />
                          <bdi dir="ltr">
                            {job.progressPercent}% ({job.translatedCount}/{job.totalEntries})
                          </bdi>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                          <Clock className="w-3 h-3" />
                          <bdi dir="ltr">{job.progressPercent}%</bdi>
                        </span>
                      )}

                      {job.qualityScore !== undefined && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{uiLang === 'ar' ? 'الجودة:' : 'QA:'}</span>
                          <bdi dir="ltr">{job.qualityScore}%</bdi>
                        </span>
                      )}
                    </div>

                    <bdi
                      dir="ltr"
                      className="font-bold text-sm text-slate-900 dark:text-white truncate max-w-full sm:max-w-md text-left"
                    >
                      {job.fileName}
                    </bdi>
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                    <span>
                      {uiLang === 'ar'
                        ? `تمت ترجمة ${job.translatedCount} من أصل ${job.totalEntries} سطر`
                        : `${job.translatedCount} / ${job.totalEntries} entries`}
                    </span>
                    <span>•</span>
                    <bdi dir="ltr">{new Date(job.updatedAt).toLocaleString()}</bdi>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {!isCompleted && (
                    <button
                      type="button"
                      onClick={() => onResumeJob(job.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{t.history.resumeButton}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenJob(job.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400 flex items-center gap-1.5"
                  >
                    <FileEdit className="w-3.5 h-3.5" />
                    <span>{t.history.openButton}</span>
                  </button>

                  {job.translatedCount > 0 && (
                    <a
                      href={`/api/jobs/${job.id}/export?bom=${
                        job.targetLanguage === 'ar' ? 'true' : 'false'
                      }`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600"
                      title={t.actions.exportSrt}
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => onDeleteJob(job.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    title={t.history.deleteButton}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
