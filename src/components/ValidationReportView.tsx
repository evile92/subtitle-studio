'use client';

import React from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  ArrowUpRight,
  Clock,
  Hash,
  Code2,
  FileCheck2,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { ValidationReport } from '@/types/subtitle';

interface ValidationReportViewProps {
  report?: ValidationReport;
  onJumpToSequence: (seq: number) => void;
}

export function ValidationReportView({
  report,
  onJumpToSequence,
}: ValidationReportViewProps) {
  const { t } = useApp();

  if (!report) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
        Validation report will be generated automatically once translation completes.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Header Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                report.isFullyValidated
                  ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400'
              }`}
            >
              {report.isFullyValidated ? (
                <ShieldCheck className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                {t.workspace.validation.title}
              </h3>
              <p
                className={`text-xs sm:text-sm font-medium mt-0.5 ${
                  report.isFullyValidated
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {report.isFullyValidated
                  ? t.workspace.validation.fullyValidated
                  : t.workspace.validation.needsReview}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-end">
              <span className="text-xs text-slate-500 dark:text-slate-400 block">
                {t.workspace.validation.qualityScore}
              </span>
              <span
                className={`text-2xl sm:text-3xl font-extrabold ${
                  report.qualityScore >= 95
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : report.qualityScore >= 80
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {report.qualityScore}%
              </span>
            </div>
          </div>
        </div>

        {/* Structural Integrity Comparison Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <FileCheck2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>{t.workspace.validation.entryCountMatch}</span>
            </div>
            <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
              {report.translatedEntryCount} / {report.originalEntryCount}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Hash className="w-3.5 h-3.5 text-emerald-500" />
              <span>{t.workspace.validation.sequenceMatch}</span>
            </div>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {report.sequenceIntegrityMatch ? '100% Exact' : 'Mismatch'}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Clock className="w-3.5 h-3.5 text-emerald-500" />
              <span>{t.workspace.validation.timestampMatch}</span>
            </div>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {report.timestampIntegrityMatch ? '100% Exact' : 'Modified'}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Code2 className="w-3.5 h-3.5 text-indigo-500" />
              <span>{t.workspace.validation.tagsPreserved}</span>
            </div>
            <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
              {report.formattingTagsPreservedCount} / {report.formattingTagsTotalCount}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Wrench className="w-3.5 h-3.5 text-indigo-500" />
              <span>{t.workspace.validation.autoRepaired}</span>
            </div>
            <p className="text-base font-bold text-indigo-600 dark:text-indigo-400 mt-1">
              {report.autoRepairedCount}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>{t.workspace.validation.unresolvedIssues}</span>
            </div>
            <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
              {report.unresolvedErrorsCount + report.unresolvedWarningsCount}
            </p>
          </div>
        </div>
      </div>

      {/* Detailed Issues & Auto-Repair Log */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-3">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
          Detailed QA Inspection Log ({report.issues.length})
        </h4>

        {report.issues.length === 0 ? (
          <div className="p-6 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/50 flex items-center gap-3 text-xs sm:text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>
              Zero structural, formatting, or terminology discrepancies detected across all{' '}
              {report.originalEntryCount} subtitle entries.
            </span>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {report.issues.map((issue) => (
              <div
                key={issue.id}
                className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                  issue.autoRepaired
                    ? 'bg-indigo-50/30 dark:bg-indigo-950/20 border-indigo-200/70 dark:border-indigo-900/50'
                    : issue.severity === 'error'
                      ? 'bg-rose-50/50 dark:bg-rose-950/25 border-rose-200 dark:border-rose-900/60'
                      : 'bg-amber-50/50 dark:bg-amber-950/25 border-amber-200 dark:border-amber-900/60'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                        issue.autoRepaired
                          ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                          : issue.severity === 'error'
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {issue.autoRepaired ? 'Auto-Repaired' : issue.severity}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {issue.message}
                    </span>
                  </div>
                  {issue.repairDescription && (
                    <p className="text-indigo-700 dark:text-indigo-300">
                      ✓ {issue.repairDescription}
                    </p>
                  )}
                </div>

                {issue.sequence !== undefined && (
                  <button
                    type="button"
                    onClick={() => onJumpToSequence(issue.sequence!)}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-indigo-600 font-semibold flex items-center gap-1 shrink-0 self-start sm:self-center"
                  >
                    <span>
                      {t.workspace.validation.jumpToEntry}
                      {issue.sequence}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
