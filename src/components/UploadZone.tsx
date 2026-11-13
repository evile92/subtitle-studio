'use client';

import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
  X,
  Clock,
  Hash,
  Languages,
  Sparkles,
  Users,
  Code2,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { parseSrtContent, ParseResult } from '@/lib/srt/parser';
import { decodeSubtitleBytes } from '@/lib/srt/sync';
import { getLanguageName } from '@/lib/languages';
import { SAMPLE_SUBTITLE_FILES, SampleSubtitleFile } from '@/lib/sample-subtitles';

export interface UploadedFileState {
  fileName: string;
  fileSize: number;
  content: string;
  parseResult: ParseResult;
}

interface UploadZoneProps {
  uploadedFile: UploadedFileState | null;
  onFileAccepted: (fileState: UploadedFileState) => void;
  onClearFile: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function UploadZone({
  uploadedFile,
  onFileAccepted,
  onClearFile,
}: UploadZoneProps) {
  const { uiLang, t } = useApp();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const processRawFileContent = async (
    fileName: string,
    fileSize: number,
    content: string
  ) => {
    setErrorMessage(null);
    setIsValidating(true);

    try {
      // 1. Instant client-side structural verification
      const localParsed = parseSrtContent(content, fileName);
      if (!localParsed.isValid) {
        setErrorMessage(
          localParsed.errors[0] ||
            'Invalid or corrupted SRT file. Please verify the file contains valid timestamps and dialogue.'
        );
        setIsValidating(false);
        return;
      }

      // 2. Server-side validation verification
      try {
        const res = await fetch('/api/validate-srt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, content }),
        });
        const data = await res.json();
        if (!res.ok || !data.isValid) {
          setErrorMessage(
            data?.errors?.[0] || data?.error || 'Server rejected the uploaded SRT file.'
          );
          setIsValidating(false);
          return;
        }
      } catch {
        // Fallback to localParsed if offline during validation check
      }

      onFileAccepted({
        fileName,
        fileSize,
        content,
        parseResult: localParsed,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleFileObject = async (file: File) => {
    setErrorMessage(null);
    if (!file.name.toLowerCase().endsWith('.srt')) {
      setErrorMessage(
        uiLang === 'ar'
          ? `صيغة الملف "${file.name}" غير مدعومة حالياً. يرجى رفع ملف ترجمة بصيغة (.srt).`
          : `Unsupported file extension for "${file.name}". Please upload a valid SubRip (.srt) file.`
      );
      return;
    }

    if (file.size === 0) {
      setErrorMessage(
        uiLang === 'ar'
          ? 'الملف المرفوع فارغ ولا يحتوي على أي مقاطع ترجمة.'
          : 'The selected SRT file is empty (0 bytes).'
      );
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setErrorMessage(
        uiLang === 'ar'
          ? 'حجم الملف يتجاوز الحد الأقصى المسموح به (15 ميجابايت).'
          : 'File exceeds the maximum allowed upload size of 15 MB.'
      );
      return;
    }

    const buffer = await file.arrayBuffer();
    const text = decodeSubtitleBytes(buffer);
    await processRawFileContent(file.name, file.size, text);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileObject(file);
    }
  };

  const handleSampleSelect = async (sample: SampleSubtitleFile) => {
    const byteSize = new Blob([sample.content]).size;
    await processRawFileContent(sample.fileName, byteSize, sample.content);
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-5 sm:p-6 shadow-xs transition-all">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold inline-flex items-center justify-center">
              1
            </span>
            <span>{t.steps.step1Title}</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t.steps.step1Desc}
          </p>
        </div>

        {uploadedFile && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {t.upload.replaceButton}
            </button>
            <button
              type="button"
              onClick={onClearFile}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              title={t.upload.clearButton}
              aria-label={t.upload.clearButton}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".srt,application/x-subrip,text/plain"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileObject(f);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Validation Error Banner */}
      {errorMessage && (
        <div className="mb-4 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs sm:text-sm">
            <p className="font-semibold text-rose-900 dark:text-rose-200">
              {t.upload.invalidTitle}
            </p>
            <p className="text-rose-700 dark:text-rose-300 mt-0.5">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 hover:text-rose-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!uploadedFile ? (
        <div>
          {/* Drag and Drop Area */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-all ${
              isDragging
                ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 scale-[0.995]'
                : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/60 dark:bg-slate-950/40'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-3 shadow-xs">
              <UploadCloud className="w-6 h-6" />
            </div>
            <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
              {isValidating ? 'Validating SRT structure...' : t.upload.dropTitle}
            </p>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              {t.upload.dropSubtitle}
            </p>
            <div className="mt-4">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors">
                <FileText className="w-4 h-4" />
                {t.upload.selectButton}
              </span>
            </div>
          </div>

          {/* Built-in Sample Scripts for Instant Testing */}
          <div className="mt-4 pt-4 border-t border-slate-200/70 dark:border-slate-800/70">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>{t.upload.samplePrompt}</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {SAMPLE_SUBTITLE_FILES.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => handleSampleSelect(sample)}
                  className="text-start p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/60 dark:bg-slate-950/50 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 transition-all group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                      {uiLang === 'ar' ? sample.titleAr : sample.titleEn}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      .SRT
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {uiLang === 'ar' ? sample.descriptionAr : sample.descriptionEn}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Uploaded File Metadata Summary Card */
        <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t.upload.validBadge}
                  </span>
                </div>
                <p className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white truncate mt-0.5">
                  <bdi dir="ltr">{uploadedFile.fileName}</bdi>
                </p>
              </div>
            </div>

            <bdi
              dir="ltr"
              className="text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            >
              {formatFileSize(uploadedFile.fileSize)}
            </bdi>
          </div>

          {/* Detailed Parsed Subtitle Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Hash className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.upload.fileStats.entriesCount}</span>
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
                {uploadedFile.parseResult.totalEntries.toLocaleString()}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.upload.fileStats.duration}</span>
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
                {formatDuration(uploadedFile.parseResult.totalDurationSeconds)}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Languages className="w-3.5 h-3.5 text-indigo-500" />
                <span>{t.upload.fileStats.detectedLang}</span>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">
                {getLanguageName(uploadedFile.parseResult.detectedLanguage, uiLang)}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                {uploadedFile.parseResult.speakerCount > 0 ? (
                  <>
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{t.upload.fileStats.speakersDetected}</span>
                  </>
                ) : (
                  <>
                    <Code2 className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{t.upload.fileStats.formattedLines}</span>
                  </>
                )}
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
                {uploadedFile.parseResult.speakerCount > 0
                  ? uploadedFile.parseResult.speakerCount
                  : uploadedFile.parseResult.formattedEntryCount}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
