'use client';

import React, { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  MonitorPlay,
  Type,
  Eye,
  Clock,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SubtitleEntry } from '@/types/subtitle';
import { isRtlLanguage } from '@/lib/languages';
import { stripFormattingTags } from '@/lib/srt/parser';

interface SubtitlePreviewProps {
  entries: SubtitleEntry[];
  targetLanguage: string;
  selectedSequence: number;
  onSelectSequence: (seq: number) => void;
}

/**
 * Safely renders inline SRT formatting tags (`<i>`, `<b>`, `<u>`) and line breaks
 * inside the cinema subtitle preview overlay without dangerouslySetInnerHTML.
 */
function renderFormattedSubtitleLine(text: string): React.ReactNode {
  const cleanedAss = text.replace(/\{\\[^}]+\}/g, '');
  const lines = cleanedAss.split(/\r?\n/);

  return lines.map((line, lineIdx) => {
    const isItalic = /<i>/i.test(line);
    const isBold = /<b>/i.test(line);
    const isUnderline = /<u>/i.test(line);
    const plain = line.replace(/<\/?[a-zA-Z][^>]*>/g, '');

    return (
      <React.Fragment key={lineIdx}>
        {lineIdx > 0 && <br />}
        <span
          className={`${isItalic ? 'italic' : ''} ${isBold ? 'font-bold' : ''} ${
            isUnderline ? 'underline' : ''
          }`}
        >
          {plain}
        </span>
      </React.Fragment>
    );
  });
}

export function SubtitlePreview({
  entries,
  targetLanguage,
  selectedSequence,
  onSelectSequence,
}: SubtitlePreviewProps) {
  const { t } = useApp();
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOriginalBelow, setShowOriginalBelow] = useState(true);
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md');

  const currentIndex = Math.max(
    0,
    entries.findIndex((e) => e.sequence === selectedSequence)
  );
  const currentEntry = entries[currentIndex] || entries[0];
  const isTargetRtl = isRtlLanguage(targetLanguage);

  // Simulated playback timer advancing through entries
  useEffect(() => {
    if (!isPlaying || !currentEntry) return;
    const durationMs = Math.max(
      1800,
      Math.min(5000, currentEntry.endMs - currentEntry.startMs || 2500)
    );

    const timer = setTimeout(() => {
      if (currentIndex + 1 < entries.length) {
        onSelectSequence(entries[currentIndex + 1].sequence);
      } else {
        setIsPlaying(false);
      }
    }, durationMs);

    return () => clearTimeout(timer);
  }, [isPlaying, currentIndex, currentEntry, entries, onSelectSequence]);

  if (!currentEntry) return null;

  const durationSec = Math.max(
    0.5,
    (currentEntry.endMs - currentEntry.startMs) / 1000
  );
  const cleanTrans = stripFormattingTags(
    currentEntry.translatedText || currentEntry.originalText
  );
  const cps = Math.round(cleanTrans.length / durationSec);

  const fontSizeClass =
    fontSize === 'sm'
      ? 'text-base sm:text-lg'
      : fontSize === 'lg'
        ? 'text-xl sm:text-3xl'
        : 'text-lg sm:text-2xl';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <MonitorPlay className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>{t.workspace.preview.title}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.workspace.preview.subtitle}
          </p>
        </div>

        {/* Preview Controls: Dual Sub Toggle & Font Size */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOriginalBelow(!showOriginalBelow)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors ${
              showOriginalBelow
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{t.workspace.preview.showOriginalSub}</span>
          </button>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            <Type className="w-3.5 h-3.5 text-slate-400 ms-1.5 me-1" />
            {(['sm', 'md', 'lg'] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setFontSize(sz)}
                className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                  fontSize === sz
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 16:9 Cinema Viewport */}
      <div className="relative w-full aspect-video max-h-[380px] rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-black border border-slate-800 shadow-inner flex flex-col justify-between p-4 sm:p-8 select-none">
        {/* Top Cinema HUD Bar */}
        <div className="flex items-center justify-between gap-2 text-xs font-mono text-slate-400 z-10">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-xs px-3 py-1.5 rounded-lg border border-white/10">
            <span className="text-indigo-400 font-bold">#{currentEntry.sequence}</span>
            <span>•</span>
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>
              {currentEntry.startTime} → {currentEntry.endTime}
            </span>
          </div>

          <div
            className={`px-3 py-1.5 rounded-lg border backdrop-blur-xs ${
              cps > 22
                ? 'bg-amber-950/70 border-amber-700/60 text-amber-300'
                : 'bg-black/60 border-white/10 text-emerald-400'
            }`}
          >
            {t.workspace.preview.cpsLabel}: {cps} CPS ({durationSec.toFixed(1)}s)
          </div>
        </div>

        {/* Decorative Ambient Cinema Lighting */}
        <div className="my-auto flex items-center justify-center pointer-events-none opacity-25">
          <div className="w-48 h-48 rounded-full bg-indigo-500/20 blur-3xl" />
        </div>

        {/* Bottom Subtitle Overlay Box */}
        <div className="w-full flex flex-col items-center justify-end text-center z-10 space-y-2 pb-1">
          <div
            dir={isTargetRtl ? 'rtl' : 'ltr'}
            className={`max-w-[90%] sm:max-w-[82%] px-4 py-2 rounded-xl bg-black/80 backdrop-blur-xs text-white font-medium tracking-wide leading-relaxed shadow-lg border border-white/5 ${fontSizeClass}`}
            style={{
              textShadow: '0 2px 4px rgba(0,0,0,0.9)',
            }}
          >
            {renderFormattedSubtitleLine(
              currentEntry.translatedText || currentEntry.originalText
            )}
          </div>

          {showOriginalBelow && (
            <div
              dir="ltr"
              className="max-w-[85%] px-3 py-1 rounded-lg bg-black/65 text-slate-300 text-xs sm:text-sm leading-snug"
            >
              {renderFormattedSubtitleLine(currentEntry.originalText)}
            </div>
          )}
        </div>
      </div>

      {/* Transport Scrubber & Playback Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (currentIndex > 0) {
                onSelectSequence(entries[currentIndex - 1].sequence);
              }
            }}
            disabled={currentIndex <= 0}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            title={t.workspace.preview.prev}
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>{t.workspace.preview.pause}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>{t.workspace.preview.play}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (currentIndex + 1 < entries.length) {
                onSelectSequence(entries[currentIndex + 1].sequence);
              }
            }}
            disabled={currentIndex >= entries.length - 1}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            title={t.workspace.preview.next}
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Scrubber Slider */}
        <div className="flex-1 w-full flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500">
            #{entries[0]?.sequence || 1}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, entries.length - 1)}
            value={currentIndex}
            onChange={(e) => {
              const idx = Number(e.target.value);
              if (entries[idx]) {
                onSelectSequence(entries[idx].sequence);
              }
            }}
            className="flex-1 accent-indigo-600"
          />
          <span className="text-xs font-mono text-slate-500">
            #{entries[entries.length - 1]?.sequence || entries.length}
          </span>
        </div>
      </div>
    </div>
  );
}
