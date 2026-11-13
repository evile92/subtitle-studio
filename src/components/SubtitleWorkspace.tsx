'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Search,
  Download,
  RotateCcw,
  Sparkles,
  Copy,
  Check,
  Save,
  AlertTriangle,
  FileEdit,
  MonitorPlay,
  BookOpen,
  ShieldCheck,
  Loader2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Wand2,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  GlossaryItem,
  SubtitleEntry,
  TranslationJob,
} from '@/types/subtitle';
import {
  getArabicDialectOption,
  getLanguageName,
  isRtlLanguage,
} from '@/lib/languages';
import {
  detectEntriesNeedingProofread,
  extractResidualLatinWords,
  type ProofreadChangeItem,
  type ProofreadResultSummary,
} from '@/lib/translation/proofread-utils';
import { SubtitlePreview } from './SubtitlePreview';
import { ContextProfileView } from './ContextProfileView';
import { ValidationReportView } from './ValidationReportView';
import { getActiveUserClientAIConfig } from '@/lib/storage/client-config';
import {
  downloadClientJobSrt,
  saveClientJob,
} from '@/lib/storage/client-job-store';
import { validateAndRepairTranslations } from '@/lib/translation/validator';

interface SubtitleWorkspaceProps {
  job: TranslationJob;
  onJobUpdated: (updatedJob: TranslationJob) => void;
  onStartNewTranslation: () => void;
}

type WorkspaceTab = 'editor' | 'preview' | 'context' | 'validation';
type FilterMode = 'all' | 'warnings' | 'edited' | 'untranslated';

const PAGE_SIZE = 50;

export function SubtitleWorkspace({
  job,
  onJobUpdated,
  onStartNewTranslation,
}: SubtitleWorkspaceProps) {
  const { uiLang, t } = useApp();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('editor');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSequence, setSelectedSequence] = useState<number>(
    job.entries[0]?.sequence || 1
  );
  const editorListTopRef = useRef<HTMLDivElement | null>(null);

  // Local draft edits map: sequence -> edited text
  const [draftEdits, setDraftEdits] = useState<Record<number, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copiedSequence, setCopiedSequence] = useState<number | null>(null);

  // Contextual single-entry regeneration state
  const [regeneratingSeq, setRegeneratingSeq] = useState<number | null>(null);
  const [regenPromptSeq, setRegenPromptSeq] = useState<number | null>(null);
  const [customLineInstruction, setCustomLineInstruction] = useState('');
  const [regenAlternatives, setRegenAlternatives] = useState<
    Record<number, string[]>
  >({});
  const [regenError, setRegenError] = useState<string | null>(null);

  // Export dropdown state
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Second-pass AI Proofread & Linguistic Fix state
  const [isProofreading, setIsProofreading] = useState(false);
  const [proofreadProgress, setProofreadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [proofreadMenuOpen, setProofreadMenuOpen] = useState(false);
  const [proofreadSummary, setProofreadSummary] =
    useState<ProofreadResultSummary | null>(null);
  const [showProofreadDetails, setShowProofreadDetails] = useState(true);

  const isTargetRtl = isRtlLanguage(job.targetLanguage);
  const isSourceRtl = isRtlLanguage(
    job.detectedSourceLanguage || job.sourceLanguage
  );

  const warningEntriesCount = useMemo(
    () =>
      job.entries.filter(
        (e) => (e.warnings && e.warnings.length > 0) || e.status === 'warning'
      ).length,
    [job.entries]
  );

  const editedEntriesCount = useMemo(
    () =>
      job.entries.filter(
        (e) => e.isEditedByUser || draftEdits[e.sequence] !== undefined
      ).length,
    [job.entries, draftEdits]
  );

  const untranslatedEntriesCount = useMemo(
    () =>
      job.entries.filter(
        (e) =>
          !(draftEdits[e.sequence] ?? e.translatedText ?? '').trim()
      ).length,
    [job.entries, draftEdits]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return job.entries.filter((entry) => {
      const currentTrans =
        draftEdits[entry.sequence] ?? entry.translatedText ?? '';

      if (filterMode === 'warnings') {
        const hasWarn =
          (entry.warnings && entry.warnings.length > 0) ||
          entry.status === 'warning';
        if (!hasWarn) return false;
      } else if (filterMode === 'edited') {
        if (!entry.isEditedByUser && draftEdits[entry.sequence] === undefined) {
          return false;
        }
      } else if (filterMode === 'untranslated') {
        if (currentTrans.trim().length > 0) return false;
      }

      if (!q) return true;
      const seqMatch =
        `#${entry.sequence}` === q || String(entry.sequence).includes(q);
      const origMatch = entry.originalText.toLowerCase().includes(q);
      const transMatch = currentTrans.toLowerCase().includes(q);
      const speakerMatch = entry.speakerLabel?.toLowerCase().includes(q);

      return Boolean(seqMatch || origMatch || transMatch || speakerMatch);
    });
  }, [job.entries, draftEdits, filterMode, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * PAGE_SIZE;

  const paginatedEntries = useMemo(
    () => filteredEntries.slice(pageStartIndex, pageStartIndex + PAGE_SIZE),
    [filteredEntries, pageStartIndex]
  );

  const visiblePageNumbers = useMemo(() => {
    const pages: Array<number | 'ellipsis'> = [];
    if (totalPages <= 7) {
      for (let p = 1; p <= totalPages; p++) pages.push(p);
      return pages;
    }

    pages.push(1);
    const start = Math.max(2, safeCurrentPage - 1);
    const end = Math.min(totalPages - 1, safeCurrentPage + 1);
    if (start > 2) pages.push('ellipsis');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < totalPages - 1) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }, [safeCurrentPage, totalPages]);

  const handleFilterChange = (nextFilter: FilterMode) => {
    setFilterMode(nextFilter);
    setCurrentPage(1);
  };

  const handleSearchChange = (nextQuery: string) => {
    setSearchQuery(nextQuery);
    setCurrentPage(1);
  };

  const handlePageChange = (nextPage: number) => {
    const clamped = Math.max(1, Math.min(totalPages, nextPage));
    setCurrentPage(clamped);
    editorListTopRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const handleTextChange = (sequence: number, newValue: string) => {
    setDraftEdits((prev) => ({
      ...prev,
      [sequence]: newValue,
    }));
    setSaveSuccess(false);
  };

  const persistEntryUpdates = async (
    updates: Array<{
      sequence: number;
      translatedText: string;
      isEditedByUser?: boolean;
      restoreAi?: boolean;
    }>
  ) => {
    setIsSaving(true);
    try {
      const updatesBySeq = new Map<
        number,
        { translatedText: string; isEditedByUser?: boolean; restoreAi?: boolean }
      >();
      for (const item of updates) {
        if (typeof item.sequence === 'number') {
          updatesBySeq.set(item.sequence, item);
        }
      }

      const updatedEntries = job.entries.map((entry) => {
        const upd = updatesBySeq.get(entry.sequence);
        if (!upd) return { ...entry };
        if (upd.restoreAi && entry.aiTranslatedText) {
          return {
            ...entry,
            translatedText: entry.aiTranslatedText,
            isEditedByUser: false,
            status: 'translated' as const,
          };
        }
        return {
          ...entry,
          translatedText: String(upd.translatedText ?? ''),
          isEditedByUser: upd.isEditedByUser ?? true,
          status: 'edited' as const,
        };
      });

      const effectiveSource =
        job.sourceLanguage === 'auto'
          ? job.detectedSourceLanguage || 'en'
          : job.sourceLanguage;

      const qaResult = validateAndRepairTranslations({
        originalEntries: job.entries,
        translatedEntries: updatedEntries,
        glossary: job.glossary,
        sourceLanguage: effectiveSource,
        targetLanguage: job.targetLanguage,
      });

      const updatedJob: TranslationJob = {
        ...job,
        entries: qaResult.repairedEntries,
        validationReport: qaResult.report,
        translatedCount: qaResult.report.translatedEntryCount,
      };

      saveClientJob(updatedJob);
      onJobUpdated(updatedJob);

      setDraftEdits((prev) => {
        const next = { ...prev };
        for (const u of updates) {
          delete next[u.sequence];
        }
        return next;
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAllDrafts = async () => {
    const entriesToSave = Object.entries(draftEdits).map(
      ([seqStr, translatedText]) => ({
        sequence: Number(seqStr),
        translatedText,
        isEditedByUser: true,
      })
    );
    if (entriesToSave.length === 0) return;
    await persistEntryUpdates(entriesToSave);
  };

  const handleSingleEntryBlurSave = async (entry: SubtitleEntry) => {
    const draft = draftEdits[entry.sequence];
    if (draft === undefined || draft === entry.translatedText) return;
    await persistEntryUpdates([
      {
        sequence: entry.sequence,
        translatedText: draft,
        isEditedByUser: true,
      },
    ]);
  };

  const handleRestoreAiTranslation = async (entry: SubtitleEntry) => {
    await persistEntryUpdates([
      {
        sequence: entry.sequence,
        translatedText: entry.aiTranslatedText || entry.translatedText || '',
        isEditedByUser: false,
        restoreAi: true,
      },
    ]);
  };

  const handleCopyTranslation = async (sequence: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSequence(sequence);
      setTimeout(() => setCopiedSequence(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleRegenerateEntry = async (
    sequence: number,
    instruction?: string
  ) => {
    setRegeneratingSeq(sequence);
    setRegenError(null);
    try {
      const userAIConfig = getActiveUserClientAIConfig();
      const targetIdx = job.entries.findIndex((e) => e.sequence === sequence);
      const compactEntries =
        targetIdx !== -1
          ? job.entries.slice(
              Math.max(0, targetIdx - 6),
              Math.min(job.entries.length, targetIdx + 7)
            )
          : job.entries;

      const res = await fetch(`/api/jobs/${job.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence,
          customInstruction: instruction,
          userAIConfig,
          job: {
            ...job,
            entries: compactEntries,
            batches: [],
            logs: [],
          },
        }),
      });

      const rawText = await res.text();
      let data: {
        error?: string;
        entry?: SubtitleEntry;
        alternatives?: string[];
      } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          res.status === 504
            ? 'Server request timed out. Please try again.'
            : `Server returned an unexpected response (${res.status}).`
        );
      }

      if (!res.ok) {
        setRegenError(data.error || 'Failed to regenerate subtitle line.');
        return;
      }

      if (data.entry) {
        const updatedEntries = job.entries.map((e) =>
          e.sequence === sequence ? data.entry! : { ...e }
        );
        const effectiveSource =
          job.sourceLanguage === 'auto'
            ? job.detectedSourceLanguage || 'en'
            : job.sourceLanguage;

        const qaResult = validateAndRepairTranslations({
          originalEntries: job.entries,
          translatedEntries: updatedEntries,
          glossary: job.glossary,
          sourceLanguage: effectiveSource,
          targetLanguage: job.targetLanguage,
        });

        const updatedJob: TranslationJob = {
          ...job,
          entries: qaResult.repairedEntries,
          validationReport: qaResult.report,
          translatedCount: qaResult.report.translatedEntryCount,
        };
        saveClientJob(updatedJob);
        onJobUpdated(updatedJob);

        setDraftEdits((prev) => {
          if (prev[sequence] === undefined) return prev;
          const next = { ...prev };
          delete next[sequence];
          return next;
        });
      }

      if (Array.isArray(data.alternatives) && data.alternatives.length > 0) {
        setRegenAlternatives((prev) => ({
          ...prev,
          [sequence]: data.alternatives!,
        }));
      }
      setRegenPromptSeq(null);
      setCustomLineInstruction('');
    } catch (err) {
      setRegenError(
        err instanceof Error ? err.message : 'Failed to regenerate subtitle.'
      );
    } finally {
      setRegeneratingSeq(null);
    }
  };

  const handleUpdateGlossary = async (updatedGlossary: GlossaryItem[]) => {
    const cleanedGlossary = updatedGlossary.filter(
      (g) => g.sourceTerm && g.targetTerm
    );
    const effectiveSource =
      job.sourceLanguage === 'auto'
        ? job.detectedSourceLanguage || 'en'
        : job.sourceLanguage;

    const qaResult = validateAndRepairTranslations({
      originalEntries: job.entries,
      translatedEntries: job.entries,
      glossary: cleanedGlossary,
      sourceLanguage: effectiveSource,
      targetLanguage: job.targetLanguage,
    });

    const updatedJob: TranslationJob = {
      ...job,
      glossary: cleanedGlossary,
      entries: qaResult.repairedEntries,
      validationReport: qaResult.report,
    };

    saveClientJob(updatedJob);
    onJobUpdated(updatedJob);
  };

  const handleRunProofread = async (scope: 'smart' | 'all' = 'smart') => {
    setProofreadMenuOpen(false);
    setIsProofreading(true);
    setProofreadProgress(null);
    setRegenError(null);

    try {
      const userAIConfig = getActiveUserClientAIConfig();
      const effectiveSource =
        job.sourceLanguage === 'auto'
          ? job.detectedSourceLanguage || 'en'
          : job.sourceLanguage;
      const isArabic = job.targetLanguage.toLowerCase() === 'ar';

      const draftSnapshot = { ...draftEdits };
      const pendingDraftSeqs = Object.keys(draftSnapshot).map(Number);

      const workingEntries = job.entries.map((e) => {
        const draft = draftSnapshot[e.sequence];
        if (draft !== undefined) {
          return {
            ...e,
            translatedText: draft,
            isEditedByUser: true,
          };
        }
        return { ...e };
      });
      const entriesBySeq = new Map<number, SubtitleEntry>();
      for (const e of workingEntries) {
        entriesBySeq.set(e.sequence, e);
      }

      const detection = detectEntriesNeedingProofread(
        workingEntries,
        job.targetLanguage
      );

      let targetSequenceList: number[] = [];
      let effectiveScope: 'smart' | 'all' = scope;

      if (scope === 'smart') {
        if (detection.sequences.length > 0) {
          targetSequenceList = detection.sequences;
        } else {
          effectiveScope = 'all';
          targetSequenceList = workingEntries
            .filter((e) => !e.isSoundEffect)
            .map((e) => e.sequence);
        }
      } else {
        targetSequenceList = workingEntries
          .filter((e) => !e.isSoundEffect)
          .map((e) => e.sequence);
      }

      const targetEntries = targetSequenceList
        .map((seq) => entriesBySeq.get(seq))
        .filter((e): e is SubtitleEntry => Boolean(e));

      const PROOFREAD_BATCH_SIZE = 25;
      const totalBatches = Math.max(
        1,
        Math.ceil(targetEntries.length / PROOFREAD_BATCH_SIZE)
      );
      const allChanges: ProofreadChangeItem[] = [];

      for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
        setProofreadProgress({ current: bIdx + 1, total: totalBatches });

        const batchSlice = targetEntries.slice(
          bIdx * PROOFREAD_BATCH_SIZE,
          (bIdx + 1) * PROOFREAD_BATCH_SIZE
        );
        if (batchSlice.length === 0) continue;

        const contextEntries: SubtitleEntry[] = [];
        const includedContextSeqs = new Set(batchSlice.map((e) => e.sequence));
        for (const item of batchSlice) {
          for (const offset of [-2, -1, 1, 2]) {
            const neighbor = entriesBySeq.get(item.sequence + offset);
            if (neighbor && !includedContextSeqs.has(neighbor.sequence)) {
              contextEntries.push(neighbor);
              includedContextSeqs.add(neighbor.sequence);
            }
          }
        }

        const res = await fetch('/api/pipeline/proofread-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetEntries: batchSlice,
            contextEntries,
            reasonsBySequence: detection.reasonsBySequence,
            sourceLanguage: effectiveSource,
            targetLanguage: job.targetLanguage,
            arabicDialect: job.arabicDialect,
            preferences: job.preferences,
            contextProfile: job.contextProfile,
            glossary: job.glossary,
            userAIConfig,
          }),
        });

        const rawText = await res.text();
        let data: {
          error?: string;
          revisions?: Array<{
            sequence: number;
            revisedText: string;
            reason: string;
            changed: boolean;
            previousClean: string;
            nextClean: string;
          }>;
        } = {};

        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(
            res.status === 504
              ? `Batch ${bIdx + 1}/${totalBatches} timed out on the server. Previously completed proofread batches were saved.`
              : `Server returned an unexpected response on batch ${bIdx + 1}/${totalBatches}.`
          );
        }

        if (!res.ok) {
          throw new Error(
            data.error || `Failed to proofread batch ${bIdx + 1}/${totalBatches}.`
          );
        }

        if (Array.isArray(data.revisions)) {
          for (const rev of data.revisions) {
            const targetEntry = entriesBySeq.get(rev.sequence);
            if (!targetEntry) continue;

            if (rev.changed) {
              if (!targetEntry.aiTranslatedText) {
                targetEntry.aiTranslatedText = targetEntry.translatedText;
              }
              targetEntry.translatedText = rev.revisedText;
              targetEntry.status = 'repaired';
              targetEntry.translationNotes = rev.reason;

              allChanges.push({
                sequence: targetEntry.sequence,
                originalText: targetEntry.originalText,
                previousTranslation: rev.previousClean,
                revisedTranslation: rev.nextClean,
                reason: rev.reason,
              });
            } else if (targetEntry.translatedText) {
              targetEntry.translatedText = rev.revisedText;
            }
          }
        }

        const qaResult = validateAndRepairTranslations({
          originalEntries: job.entries,
          translatedEntries: workingEntries,
          glossary: job.glossary,
          sourceLanguage: effectiveSource,
          targetLanguage: job.targetLanguage,
        });

        const updatedJob: TranslationJob = {
          ...job,
          entries: qaResult.repairedEntries,
          validationReport: qaResult.report,
          translatedCount: qaResult.report.translatedEntryCount,
        };

        saveClientJob(updatedJob);
        onJobUpdated(updatedJob);

        if (pendingDraftSeqs.length > 0) {
          setDraftEdits((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const seq of pendingDraftSeqs) {
              if (next[seq] !== undefined && next[seq] === draftSnapshot[seq]) {
                delete next[seq];
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      }

      const remainingEnglishCount = isArabic
        ? workingEntries.filter(
            (e) =>
              !e.isSoundEffect &&
              extractResidualLatinWords(e.translatedText || '').length > 0
          ).length
        : 0;

      setProofreadSummary({
        scopeUsed: effectiveScope,
        totalEntriesInJob: job.totalEntries,
        reviewedCount: targetEntries.length,
        correctedCount: allChanges.length,
        remainingEnglishCount,
        changes: allChanges,
      });
      setShowProofreadDetails(true);
    } catch (err) {
      setRegenError(
        err instanceof Error ? err.message : 'Failed to run AI proofreading.'
      );
    } finally {
      setIsProofreading(false);
      setProofreadProgress(null);
    }
  };

  const triggerDownload = (options: { bom?: boolean; bilingual?: boolean } = {}) => {
    downloadClientJobSrt(job, {
      useBom: options.bom,
      bilingual: options.bilingual,
    });
    setExportMenuOpen(false);
  };

  const handleJumpToSequence = (seq: number) => {
    setActiveTab('editor');
    setFilterMode('all');
    setSearchQuery('');
    setSelectedSequence(seq);

    const targetIndex = job.entries.findIndex((e) => e.sequence === seq);
    setCurrentPage(targetIndex !== -1 ? Math.floor(targetIndex / PAGE_SIZE) + 1 : 1);

    setTimeout(() => {
      const el = document.getElementById(`subtitle-row-${seq}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  return (
    <div className="space-y-6">
      {/* Top Workspace Action Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800">
              {getLanguageName(job.detectedSourceLanguage || job.sourceLanguage, uiLang)}{' '}
              {uiLang === 'ar' ? '←' : '→'}{' '}
              {getLanguageName(job.targetLanguage, uiLang)}
              {job.targetLanguage === 'ar' && job.arabicDialect
                ? ` (${getArabicDialectOption(job.arabicDialect).nativeLabel})`
                : ''}
            </span>
            {job.validationReport && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ${
                  job.validationReport.isFullyValidated
                    ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>
                  {uiLang === 'ar' ? 'الجودة:' : 'QA:'} {job.validationReport.qualityScore}%
                </span>
              </span>
            )}
            <bdi
              dir="ltr"
              className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate max-w-md"
            >
              {job.fileName}
            </bdi>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {uiLang === 'ar'
              ? `تمت ترجمة ${job.translatedCount} من ${job.totalEntries} مقطعاً • ${job.glossary.length} مصطلحاً نشطاً في المسرد`
              : `${job.translatedCount} / ${job.totalEntries} entries translated • ${job.glossary.length} glossary terms active`}
          </p>
        </div>

        {/* Save Changes & Export SRT Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {Object.keys(draftEdits).length > 0 && (
            <button
              type="button"
              onClick={handleSaveAllDrafts}
              disabled={isSaving}
              className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs transition-colors"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>
                {t.workspace.entryActions.saveChanges} ({Object.keys(draftEdits).length})
              </span>
            </button>
          )}

          {saveSuccess && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 px-2">
              <Check className="w-4 h-4" />
              {t.workspace.entryActions.saved}
            </span>
          )}

          {/* Second-Pass AI Proofread & Linguistic Fix Dropdown Button */}
          <div className="relative">
            <div className="inline-flex rounded-xl shadow-xs">
              <button
                type="button"
                disabled={isProofreading}
                onClick={() => handleRunProofread('smart')}
                className="px-3.5 py-2.5 rounded-s-xl text-xs sm:text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-1.5 transition-colors"
              >
                {isProofreading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>
                  {isProofreading
                    ? `${t.workspace.proofread.running}${
                        proofreadProgress
                          ? ` (${proofreadProgress.current}/${proofreadProgress.total})`
                          : ''
                      }`
                    : t.workspace.proofread.button}
                </span>
              </button>
              <button
                type="button"
                disabled={isProofreading}
                onClick={() => setProofreadMenuOpen(!proofreadMenuOpen)}
                className="px-2 py-2.5 rounded-e-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white border-s border-emerald-500 transition-colors"
                aria-label="Proofread options"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {proofreadMenuOpen && (
              <div className="absolute end-0 mt-2 w-72 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-1.5 z-30 space-y-1">
                <button
                  type="button"
                  onClick={() => handleRunProofread('smart')}
                  className="w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>{t.workspace.proofread.smartMode}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRunProofread('all')}
                  className="w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Wand2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>{t.workspace.proofread.fullMode}</span>
                </button>
              </div>
            )}
          </div>

          {/* Export Dropdown Button */}
          <div className="relative">
            <div className="inline-flex rounded-xl shadow-xs">
              <button
                type="button"
                onClick={() => triggerDownload({ bom: job.targetLanguage === 'ar' })}
                className="px-4 py-2.5 rounded-s-xl text-xs sm:text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>{t.actions.exportSrt}</span>
              </button>
              <button
                type="button"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="px-2.5 py-2.5 rounded-e-xl bg-indigo-700 hover:bg-indigo-800 text-white border-s border-indigo-500 transition-colors"
                aria-label="More export options"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {exportMenuOpen && (
              <div className="absolute end-0 mt-2 w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-1.5 z-30 space-y-1">
                <button
                  type="button"
                  onClick={() => triggerDownload({ bom: false })}
                  className="w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{t.actions.exportSrt} (UTF-8)</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerDownload({ bom: true })}
                  className="w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{t.actions.exportBomSrt}</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerDownload({ bom: true, bilingual: true })}
                  className="w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-purple-500" />
                  <span>{t.actions.exportBilingualSrt}</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onStartNewTranslation}
            className="px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {t.actions.newTranslation}
          </button>
        </div>
      </div>

      {/* Workspace Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('editor')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'editor'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-400'
          }`}
        >
          <FileEdit className="w-4 h-4" />
          <span>{t.workspace.tabs.editor}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'preview'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-400'
          }`}
        >
          <MonitorPlay className="w-4 h-4" />
          <span>{t.workspace.tabs.preview}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('context')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'context'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-400'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>{t.workspace.tabs.context}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('validation')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'validation'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-400'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{t.workspace.tabs.validation}</span>
          {warningEntriesCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-amber-500 text-white">
              {warningEntriesCount}
            </span>
          )}
        </button>
      </div>

      {regenError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
          <span>{regenError}</span>
          <button
            type="button"
            onClick={() => setRegenError(null)}
            className="font-bold underline"
          >
            {uiLang === 'ar' ? 'إغلاق' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Second-Pass AI Proofreading Results Banner */}
      {proofreadSummary && (
        <div className="rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/80 p-4 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-200">
                  {t.workspace.proofread.reportTitle}
                </h3>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
                  {t.workspace.proofread.reviewedLabel}:{' '}
                  <strong>{proofreadSummary.reviewedCount}</strong> •{' '}
                  {t.workspace.proofread.correctedLabel}:{' '}
                  <strong>{proofreadSummary.correctedCount}</strong>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {proofreadSummary.changes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowProofreadDetails(!showProofreadDetails)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100/50"
                >
                  {showProofreadDetails
                    ? t.workspace.proofread.hideChanges
                    : `${t.workspace.proofread.showChanges} (${proofreadSummary.changes.length})`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setProofreadSummary(null)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40"
              >
                {uiLang === 'ar' ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          </div>

          {proofreadSummary.changes.length === 0 ? (
            <p className="text-xs text-emerald-800 dark:text-emerald-300">
              {t.workspace.proofread.noIssuesFound}
            </p>
          ) : (
            showProofreadDetails && (
              <div className="max-h-72 overflow-y-auto space-y-2 pt-2 border-t border-emerald-200/70 dark:border-emerald-800/60">
                {proofreadSummary.changes.map((chg) => {
                  const matchingEntry = job.entries.find(
                    (e) => e.sequence === chg.sequence
                  );
                  return (
                    <div
                      key={chg.sequence}
                      className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-slate-800 text-xs space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                            {chg.reason}
                          </span>
                          {matchingEntry && (
                            <button
                              type="button"
                              onClick={() =>
                                persistEntryUpdates([
                                  {
                                    sequence: chg.sequence,
                                    translatedText: chg.previousTranslation,
                                    isEditedByUser: false,
                                  },
                                ])
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-indigo-600"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>{t.workspace.proofread.undoChange}</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleJumpToSequence(chg.sequence)}
                          className="font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <bdi dir="ltr">#{chg.sequence}</bdi>
                        </button>
                      </div>

                      <div
                        dir="ltr"
                        className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1.5 items-stretch"
                      >
                        {/* LEFT COLUMN: ORIGINAL ENGLISH SUBTITLE */}
                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/70 dark:border-slate-800 flex flex-col justify-between text-start">
                          <div>
                            <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                              {uiLang === 'ar'
                                ? 'النص الأصلي (الإنجليزية)'
                                : 'Original Subtitle (English)'}
                            </span>
                            <p
                              dir={isSourceRtl ? 'rtl' : 'ltr'}
                              className="text-slate-800 dark:text-slate-200 leading-relaxed text-xs sm:text-sm select-text"
                            >
                              {chg.originalText}
                            </p>
                          </div>
                        </div>

                        {/* RIGHT COLUMN: ARABIC REVISED & BEFORE */}
                        <div
                          dir={isTargetRtl ? 'rtl' : 'ltr'}
                          className="space-y-2 flex flex-col justify-between text-start"
                        >
                          <div className="p-2.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80">
                            <span className="block text-[10px] font-bold text-emerald-700 dark:text-emerald-300 mb-1">
                              {uiLang === 'ar'
                                ? 'الترجمة المصححة (العربية)'
                                : 'Corrected Translation (Arabic)'}
                            </span>
                            <p
                              dir={isTargetRtl ? 'rtl' : 'ltr'}
                              className="font-semibold text-slate-900 dark:text-white leading-relaxed text-xs sm:text-sm select-text"
                            >
                              {chg.revisedTranslation}
                            </p>
                          </div>

                          <div className="p-2 rounded-lg bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/40 text-[11px]">
                            <span className="block text-[10px] font-bold text-rose-600 dark:text-rose-400 mb-0.5">
                              {uiLang === 'ar'
                                ? 'الترجمة قبل التدقيق:'
                                : `${t.workspace.proofread.beforeLabel}:`}
                            </span>
                            <p
                              dir={isTargetRtl ? 'rtl' : 'ltr'}
                              className="text-slate-600 dark:text-slate-400 line-through opacity-80"
                            >
                              {chg.previousTranslation}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}

      {/* TAB 1: SYNCHRONIZED SIDE-BY-SIDE SUBTITLE EDITOR */}
      {activeTab === 'editor' && (
        <div className="space-y-5">
          {/* Docked Visual Subtitle Preview */}
          <SubtitlePreview
            entries={job.entries.map((e) => ({
              ...e,
              translatedText: draftEdits[e.sequence] ?? e.translatedText,
            }))}
            targetLanguage={job.targetLanguage}
            selectedSequence={selectedSequence}
            onSelectSequence={setSelectedSequence}
          />

          {/* Search & Filter Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute top-3 start-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t.workspace.searchPlaceholder}
                className="w-full ps-10 pe-4 py-2 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleFilterChange('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterMode === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {t.workspace.filters.all} ({job.entries.length})
              </button>

              <button
                type="button"
                onClick={() => handleFilterChange('warnings')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterMode === 'warnings'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {t.workspace.filters.warnings} ({warningEntriesCount})
              </button>

              <button
                type="button"
                onClick={() => handleFilterChange('edited')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterMode === 'edited'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {t.workspace.filters.edited} ({editedEntriesCount})
              </button>

              <button
                type="button"
                onClick={() => handleFilterChange('untranslated')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterMode === 'untranslated'
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {t.workspace.filters.untranslated} ({untranslatedEntriesCount})
              </button>
            </div>
          </div>

          <div ref={editorListTopRef} className="scroll-mt-4" />

          {/* Two-Panel Column Headers (Desktop: Left = Original English, Right = Translated Arabic) */}
          <div
            dir="ltr"
            className="hidden lg:grid lg:grid-cols-2 gap-4 px-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
          >
            <div className="text-left">{t.workspace.panels.originalHeader}</div>
            <div className={isTargetRtl || uiLang === 'ar' ? 'text-right' : 'text-left'}>
              {t.workspace.panels.translatedHeader}
            </div>
          </div>

          {/* Synchronized Side-by-Side Subtitle Rows */}
          <div className="space-y-3">
            {filteredEntries.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center space-y-3">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  {uiLang === 'ar'
                    ? 'لا توجد أسطر مطابقة للبحث أو الفلتر الحالي.'
                    : 'No subtitle lines match your current search or filter.'}
                </p>
                {(filterMode !== 'all' || searchQuery.trim() !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      handleFilterChange('all');
                      handleSearchChange('');
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    {uiLang === 'ar' ? 'إعادة ضبط الفلاتر' : 'Reset filters'}
                  </button>
                )}
              </div>
            ) : (
              paginatedEntries.map((entry) => {
              const currentText =
                draftEdits[entry.sequence] ?? entry.translatedText ?? '';
              const isSelected = selectedSequence === entry.sequence;
              const isEdited =
                entry.isEditedByUser || draftEdits[entry.sequence] !== undefined;
              const hasWarning =
                (entry.warnings && entry.warnings.length > 0) ||
                entry.status === 'warning';
              const isRegenerating = regeneratingSeq === entry.sequence;
              const alternatives = regenAlternatives[entry.sequence] || [];

              return (
                <div
                  key={entry.sequence}
                  id={`subtitle-row-${entry.sequence}`}
                  onClick={() => setSelectedSequence(entry.sequence)}
                  className={`rounded-2xl border transition-all p-4 ${
                    isSelected
                      ? 'bg-indigo-50/25 dark:bg-indigo-950/20 border-indigo-500 ring-2 ring-indigo-500/15'
                      : hasWarning
                        ? 'bg-amber-50/20 dark:bg-amber-950/15 border-amber-300 dark:border-amber-800/80'
                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800/90 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div
                    dir="ltr"
                    className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start"
                  >
                    {/* LEFT PANEL: ORIGINAL SUBTITLE (Always on Left) */}
                    <div
                      dir="ltr"
                      className="space-y-2 lg:pr-4 lg:border-r border-slate-200/70 dark:border-slate-800/70"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                            #{entry.sequence}
                          </span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {entry.startTime} → {entry.endTime}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {entry.speakerLabel && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                              {entry.speakerLabel}
                            </span>
                          )}
                          {entry.formattingTags.length > 0 && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-500">
                              {entry.formattingTags.join(' ')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        dir={isSourceRtl ? 'rtl' : 'ltr'}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/60 dark:border-slate-800/80 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed select-text text-start"
                      >
                        {entry.originalText}
                      </div>
                    </div>

                    {/* RIGHT PANEL: TRANSLATED SUBTITLE (Always on Right) */}
                    <div
                      dir={uiLang === 'ar' || isTargetRtl ? 'rtl' : 'ltr'}
                      className="space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {/* Entry Toolbar on Right in RTL */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRegenPromptSeq(
                                regenPromptSeq === entry.sequence
                                  ? null
                                  : entry.sequence
                              );
                            }}
                            disabled={isRegenerating}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 flex items-center gap-1 transition-colors"
                            title={t.workspace.entryActions.regenerate}
                          >
                            {isRegenerating ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Wand2 className="w-3 h-3" />
                            )}
                            <span>
                              {isRegenerating
                                ? t.workspace.entryActions.regenerating
                                : t.workspace.entryActions.regenerate}
                            </span>
                          </button>

                          {isEdited && entry.aiTranslatedText && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRestoreAiTranslation(entry);
                              }}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              title={t.workspace.entryActions.restoreAi}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyTranslation(entry.sequence, currentText);
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title={t.workspace.entryActions.copy}
                          >
                            {copiedSequence === entry.sequence ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {isEdited && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                              {t.workspace.entryActions.editedBadge}
                            </span>
                          )}
                          {hasWarning && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {entry.warnings?.[0] || t.workspace.entryActions.warningBadge}
                            </span>
                          )}
                        </div>

                        {/* Sequence & Timestamp isolated LTR on the Left */}
                        <bdi dir="ltr" className="text-xs font-mono text-slate-400">
                          #{entry.sequence} • {entry.startTime}
                        </bdi>
                      </div>

                      {/* Editable Subtitle Textarea */}
                      <textarea
                        dir={isTargetRtl ? 'rtl' : 'ltr'}
                        rows={Math.max(2, currentText.split('\n').length)}
                        value={currentText}
                        onChange={(e) =>
                          handleTextChange(entry.sequence, e.target.value)
                        }
                        onBlur={() => handleSingleEntryBlurSave(entry)}
                        className={`w-full p-3 rounded-xl text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none text-slate-900 dark:text-white leading-relaxed resize-y ${
                          isTargetRtl ? 'font-arabic text-right' : 'text-left'
                        }`}
                      />

                      {/* Contextual Regeneration Drawer for this Line */}
                      {regenPromptSeq === entry.sequence && (
                        <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 space-y-2">
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={customLineInstruction}
                              onChange={(e) =>
                                setCustomLineInstruction(e.target.value)
                              }
                              placeholder={
                                t.workspace.entryActions.customPromptPlaceholder
                              }
                              className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                            <button
                              type="button"
                              disabled={isRegenerating}
                              onClick={() =>
                                handleRegenerateEntry(
                                  entry.sequence,
                                  customLineInstruction
                                )
                              }
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-1.5 shrink-0"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>{t.workspace.entryActions.regenerate}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Alternative AI Phrasings if Regenerated */}
                      {alternatives.length > 0 && (
                        <div className="pt-1 space-y-1">
                          <span className="text-[11px] font-semibold text-slate-500">
                            {uiLang === 'ar'
                              ? 'بدائل سياقية مقترحة:'
                              : 'Suggested Contextual Alternatives:'}
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {alternatives.map((alt, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  handleTextChange(entry.sequence, alt);
                                  persistEntryUpdates([
                                    {
                                      sequence: entry.sequence,
                                      translatedText: alt,
                                      isEditedByUser: true,
                                    },
                                  ]);
                                }}
                                dir={isTargetRtl ? 'rtl' : 'ltr'}
                                className="px-2.5 py-1 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                              >
                                {alt}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
            )}
          </div>

          {/* Pagination Controls */}
          {filteredEntries.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {uiLang === 'ar'
                  ? `عرض ${pageStartIndex + 1}–${Math.min(
                      pageStartIndex + PAGE_SIZE,
                      filteredEntries.length
                    )} من أصل ${filteredEntries.length} سطر (صفحة ${safeCurrentPage} من ${totalPages})`
                  : `Showing ${pageStartIndex + 1}–${Math.min(
                      pageStartIndex + PAGE_SIZE,
                      filteredEntries.length
                    )} of ${filteredEntries.length} lines (Page ${safeCurrentPage} of ${totalPages})`}
              </div>

              {totalPages > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => handlePageChange(safeCurrentPage - 1)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />
                    <span>{uiLang === 'ar' ? 'السابق' : 'Prev'}</span>
                  </button>

                  {visiblePageNumbers.map((pageItem, idx) =>
                    pageItem === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-2 text-xs text-slate-400 select-none"
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={pageItem}
                        type="button"
                        onClick={() => handlePageChange(pageItem)}
                        aria-current={pageItem === safeCurrentPage ? 'page' : undefined}
                        className={`min-w-8 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          pageItem === safeCurrentPage
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {pageItem}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    disabled={safeCurrentPage >= totalPages}
                    onClick={() => handlePageChange(safeCurrentPage + 1)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <span>{uiLang === 'ar' ? 'التالي' : 'Next'}</span>
                    <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FULL VISUAL CINEMA PREVIEW */}
      {activeTab === 'preview' && (
        <SubtitlePreview
          entries={job.entries.map((e) => ({
            ...e,
            translatedText: draftEdits[e.sequence] ?? e.translatedText,
          }))}
          targetLanguage={job.targetLanguage}
          selectedSequence={selectedSequence}
          onSelectSequence={setSelectedSequence}
        />
      )}

      {/* TAB 3: GLOBAL STORYLINE CONTEXT & PERSISTENT GLOSSARY */}
      {activeTab === 'context' && (
        <ContextProfileView
          contextProfile={job.contextProfile}
          glossary={job.glossary}
          onUpdateGlossary={handleUpdateGlossary}
        />
      )}

      {/* TAB 4: 11-POINT QA VALIDATION REPORT */}
      {activeTab === 'validation' && (
        <ValidationReportView
          report={job.validationReport}
          onJumpToSequence={handleJumpToSequence}
        />
      )}
    </div>
  );
}
