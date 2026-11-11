'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Clock,
  Upload,
  Download,
  Gauge,
  Crosshair,
  FileText,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  FPS_PRESETS,
  ParsedTimedSubtitle,
  TimedCue,
  TimedSubtitleFormat,
  LinearTimeTransform,
  applyLinearTransform,
  decodeSubtitleBytes,
  fpsConversionScale,
  msToCueTimestamp,
  parseFlexibleTimeToMs,
  parseTimedSubtitle,
  serializeTimedSubtitle,
  syncFromReference,
  transformFromAnchors,
} from '@/lib/srt/sync';

type SyncMode = 'fps' | 'anchors' | 'reference';

interface LoadedFile {
  name: string;
  parsed: ParsedTimedSubtitle;
}

interface SyncComputation {
  cues: TimedCue[];
  transform?: LinearTimeTransform;
  method?: 'exact_copy' | 'linear_anchor';
  clampedCount: number;
  error?: string;
}

async function readSubtitleFile(file: File): Promise<LoadedFile> {
  const buffer = await file.arrayBuffer();
  const parsed = parseTimedSubtitle(decodeSubtitleBytes(buffer));
  return { name: file.name, parsed };
}

function previewText(text: string, max = 60): string {
  const flat = text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function SubtitleSyncTool() {
  const { uiLang } = useApp();
  const L = (en: string, ar: string) => (uiLang === 'ar' ? ar : en);

  const [source, setSource] = useState<LoadedFile | null>(null);
  const [reference, setReference] = useState<LoadedFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<SyncMode>('anchors');

  // FPS / offset mode
  const [sourceFps, setSourceFps] = useState<number>(23.976);
  const [targetFps, setTargetFps] = useState<number>(23.976);
  const [offsetSeconds, setOffsetSeconds] = useState<string>('0');

  // Anchor mode
  const [anchor1Idx, setAnchor1Idx] = useState<number>(0);
  const [anchor1Time, setAnchor1Time] = useState<string>('');
  const [useSecondAnchor, setUseSecondAnchor] = useState<boolean>(true);
  const [anchor2Idx, setAnchor2Idx] = useState<number>(0);
  const [anchor2Time, setAnchor2Time] = useState<string>('');

  const [outputFormat, setOutputFormat] = useState<TimedSubtitleFormat>('srt');

  const sourceInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  const handleSourceFile = async (file?: File) => {
    if (!file) return;
    setLoadError(null);
    try {
      const loaded = await readSubtitleFile(file);
      if (loaded.parsed.cues.length === 0) {
        setLoadError(L('No valid timed subtitle entries were found in this file.', 'لم يتم العثور على مقاطع ترجمة صالحة في هذا الملف.'));
        return;
      }
      setSource(loaded);
      setOutputFormat(loaded.parsed.format);
      setAnchor1Idx(0);
      setAnchor2Idx(loaded.parsed.cues.length - 1);
      setAnchor1Time('');
      setAnchor2Time('');
    } catch {
      setLoadError(L('Could not read this file.', 'تعذرت قراءة هذا الملف.'));
    }
  };

  const handleReferenceFile = async (file?: File) => {
    if (!file) return;
    setLoadError(null);
    try {
      const loaded = await readSubtitleFile(file);
      if (loaded.parsed.cues.length === 0) {
        setLoadError(L('The reference file has no valid timed entries.', 'ملف المرجع لا يحتوي على مقاطع صالحة.'));
        return;
      }
      setReference(loaded);
    } catch {
      setLoadError(L('Could not read the reference file.', 'تعذرت قراءة ملف المرجع.'));
    }
  };

  const computation: SyncComputation | null = useMemo(() => {
    if (!source) return null;
    const cues = source.parsed.cues;

    if (mode === 'fps') {
      const offset = Number(offsetSeconds.replace(',', '.'));
      if (!Number.isFinite(offset)) {
        return { cues, clampedCount: 0, error: L('Invalid offset value.', 'قيمة الإزاحة غير صالحة.') };
      }
      const transform: LinearTimeTransform = {
        scale: fpsConversionScale(sourceFps, targetFps),
        offsetMs: Math.round(offset * 1000),
      };
      const applied = applyLinearTransform(cues, transform);
      return { cues: applied.cues, transform, clampedCount: applied.clampedCount };
    }

    if (mode === 'anchors') {
      const t1 = parseFlexibleTimeToMs(anchor1Time);
      if (t1 === null) return null;
      const a1 = { subtitleMs: cues[anchor1Idx]?.startMs ?? 0, videoMs: t1 };

      let a2: { subtitleMs: number; videoMs: number } | undefined;
      if (useSecondAnchor && anchor2Time.trim()) {
        const t2 = parseFlexibleTimeToMs(anchor2Time);
        if (t2 === null) {
          return { cues, clampedCount: 0, error: L('Invalid time for the second line.', 'وقت السطر الثاني غير صالح.') };
        }
        if (anchor2Idx === anchor1Idx) {
          return { cues, clampedCount: 0, error: L('Choose two different lines.', 'اختر سطرين مختلفين.') };
        }
        a2 = { subtitleMs: cues[anchor2Idx]?.startMs ?? 0, videoMs: t2 };
      }

      const transform = transformFromAnchors(a1, a2);
      if (!(transform.scale > 0.5 && transform.scale < 2)) {
        return {
          cues,
          clampedCount: 0,
          error: L(
            'The entered times produce an unrealistic speed change. Please re-check both times.',
            'الأوقات المدخلة تنتج تغيراً غير منطقي في السرعة. راجع الوقتين مجدداً.'
          ),
        };
      }
      const applied = applyLinearTransform(cues, transform);
      return { cues: applied.cues, transform, clampedCount: applied.clampedCount };
    }

    if (!reference) return null;
    const result = syncFromReference(cues, reference.parsed.cues);
    return {
      cues: result.cues,
      transform: result.transform,
      method: result.method,
      clampedCount: result.clampedCount,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, reference, mode, sourceFps, targetFps, offsetSeconds, anchor1Idx, anchor1Time, useSecondAnchor, anchor2Idx, anchor2Time, uiLang]);

  const canDownload = Boolean(computation && !computation.error && computation.cues.length > 0);

  const handleDownload = () => {
    if (!source || !computation || computation.error) return;
    const content = serializeTimedSubtitle(computation.cues, outputFormat);
    const blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const base = source.name.replace(/\.(srt|vtt)$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.synced.${outputFormat}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const cues = source?.parsed.cues ?? [];
  const previewIndices =
    cues.length <= 6
      ? cues.map((_, i) => i)
      : [0, 1, 2, cues.length - 3, cues.length - 2, cues.length - 1];

  const cardClass =
    'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 sm:p-6 shadow-xs';
  const inputClass =
    'w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelClass = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5';

  const modeTabs: Array<{ id: SyncMode; icon: React.ElementType; title: string; desc: string }> = [
    {
      id: 'anchors',
      icon: Crosshair,
      title: L('Auto Sync by Spoken Lines', 'مزامنة تلقائية بالجمل'),
      desc: L('Enter when 1–2 lines are heard in your video', 'أدخل وقت سماع سطر أو سطرين في فيلمك'),
    },
    {
      id: 'fps',
      icon: Gauge,
      title: L('Frame Rate & Offset', 'معدل الإطارات والإزاحة'),
      desc: L('Convert FPS and shift the intro offset', 'تحويل سرعة الإطارات وإزاحة البداية'),
    },
    {
      id: 'reference',
      icon: FileText,
      title: L('Copy Timing from Reference', 'نسخ التوقيت من ملف مرجعي'),
      desc: L('Use a subtitle already synced to your video', 'استخدم ترجمة متزامنة مع نسختك'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/60 dark:from-indigo-950 dark:via-slate-900 dark:to-slate-950 border border-indigo-100 dark:border-indigo-500/20 p-6 sm:p-8">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100/90 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-400/30">
          <Clock className="w-3.5 h-3.5" />
          {L('Subtitle Sync & Release Converter', 'مزامنة الترجمة وتحويل النسخ')}
        </span>
        <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {L('Fix subtitles that run ahead of or behind the audio', 'أصلح الترجمة المتقدمة أو المتأخرة عن الصوت')}
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
          {L(
            'Re-time a subtitle made for one release (BluRay, WEB-DL, HDTV) to match another. Fixes both a constant delay (different intro length) and progressive drift (different frame rate). Text is never changed — everything runs locally in your browser.',
            'أعد توقيت ترجمة مصنوعة لنسخة معينة (BluRay أو WEB-DL أو HDTV) لتتطابق مع نسخة أخرى. يعالج التأخير الثابت (اختلاف مدة المقدمة) والانحراف التدريجي (اختلاف معدل الإطارات). لا يتم تغيير النص إطلاقاً، وكل المعالجة تتم محلياً في متصفحك.'
          )}
        </p>
      </div>

      {/* Step 1: Upload */}
      <div className={cardClass}>
        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">
          {L('1. Upload the out-of-sync subtitle', '1. ارفع ملف الترجمة غير المتزامن')}
        </h2>
        <input
          ref={sourceInputRef}
          type="file"
          accept=".srt,.vtt"
          className="hidden"
          onChange={(e) => {
            handleSourceFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {!source ? (
          <button
            type="button"
            onClick={() => sourceInputRef.current?.click()}
            className="w-full border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl py-8 flex flex-col items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors"
          >
            <Upload className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold">{L('Select .SRT or .VTT file', 'اختر ملف ‎.SRT أو ‎.VTT')}</span>
          </button>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 px-4 py-3">
            <div className="text-sm">
              <div className="font-semibold text-slate-900 dark:text-white break-all">{source.name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {source.parsed.format.toUpperCase()} • {cues.length} {L('entries', 'مقطع')} •{' '}
                <bdi dir="ltr">
                  {msToCueTimestamp(cues[0].startMs)} → {msToCueTimestamp(cues[cues.length - 1].endMs)}
                </bdi>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSource(null);
                setReference(null);
              }}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {loadError && (
          <p className="mt-3 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {loadError}
          </p>
        )}
      </div>

      {source && (
        <>
          {/* Step 2: Mode */}
          <div className={cardClass}>
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">
              {L('2. Choose a sync method', '2. اختر طريقة المزامنة')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {modeTabs.map((tab) => {
                const Icon = tab.icon;
                const active = mode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMode(tab.id)}
                    className={`text-start rounded-xl border p-3.5 transition-all ${
                      active
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      {tab.title}
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tab.desc}</p>
                  </button>
                );
              })}
            </div>

            {/* Anchor mode */}
            {mode === 'anchors' && (
              <div className="space-y-5">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {L(
                    'Play your video, find the moment the selected line is spoken, and type that time. One line fixes a constant delay; adding a second line near the end also fixes frame-rate drift. Avoid credit lines such as "Subtitles by…".',
                    'شغّل فيلمك، وابحث عن لحظة نطق السطر المختار، واكتب ذلك الوقت. سطر واحد يصلح التأخير الثابت، وإضافة سطر ثانٍ قرب النهاية يصلح أيضاً انحراف معدل الإطارات. تجنب أسطر الحقوق مثل "ترجمة فلان".'
                  )}
                </p>

                {[1, 2].map((n) => {
                  if (n === 2 && !useSecondAnchor) return null;
                  const idx = n === 1 ? anchor1Idx : anchor2Idx;
                  const setIdx = n === 1 ? setAnchor1Idx : setAnchor2Idx;
                  const time = n === 1 ? anchor1Time : anchor2Time;
                  const setTime = n === 1 ? setAnchor1Time : setAnchor2Time;
                  return (
                    <div key={n} className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3 items-end">
                      <div>
                        <label className={labelClass}>
                          {n === 1
                            ? L('Line A (near the beginning)', 'السطر الأول (قرب البداية)')
                            : L('Line B (near the end)', 'السطر الثاني (قرب النهاية)')}
                        </label>
                        <select
                          className={inputClass}
                          value={idx}
                          onChange={(e) => setIdx(Number(e.target.value))}
                        >
                          {cues.map((c, i) => (
                            <option key={c.index} value={i}>
                              #{c.index} [{msToCueTimestamp(c.startMs)}] {previewText(c.text)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>
                          {L('Heard in my video at', 'سُمع في فيلمي عند')}
                        </label>
                        <input
                          dir="ltr"
                          className={inputClass}
                          placeholder="00:01:14.500"
                          value={time}
                          onChange={(e) => setTime(e.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}

                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSecondAnchor}
                    onChange={(e) => setUseSecondAnchor(e.target.checked)}
                    className="rounded"
                  />
                  {L(
                    'Use a second line to also fix frame-rate drift (recommended)',
                    'استخدم سطراً ثانياً لإصلاح انحراف معدل الإطارات أيضاً (موصى به)'
                  )}
                </label>
              </div>
            )}

            {/* FPS mode */}
            {mode === 'fps' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>{L('Subtitle was made for', 'الترجمة مصنوعة لنسخة بسرعة')}</label>
                    <select className={inputClass} value={sourceFps} onChange={(e) => setSourceFps(Number(e.target.value))}>
                      {FPS_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>{L('My video plays at', 'فيلمي يعمل بسرعة')}</label>
                    <select className={inputClass} value={targetFps} onChange={(e) => setTargetFps(Number(e.target.value))}>
                      {FPS_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>
                      {L('Offset (seconds, + delays / − advances)', 'الإزاحة بالثواني (+ تأخير / − تقديم)')}
                    </label>
                    <input
                      dir="ltr"
                      className={inputClass}
                      value={offsetSeconds}
                      onChange={(e) => setOffsetSeconds(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[-5, -1, -0.5, -0.1, 0.1, 0.5, 1, 5].map((step) => (
                    <button
                      key={step}
                      type="button"
                      dir="ltr"
                      onClick={() => {
                        const cur = Number(offsetSeconds.replace(',', '.')) || 0;
                        setOffsetSeconds(String(Math.round((cur + step) * 1000) / 1000));
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                    >
                      {step > 0 ? `+${step}s` : `${step}s`}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl p-3 leading-relaxed">
                  {L(
                    'Note: most BluRay and WEB-DL movie releases are both 23.976 fps, so the difference is usually only a constant offset. If the delay grows over time, the frame rates differ — or use "Auto Sync by Spoken Lines" to detect both automatically.',
                    'ملاحظة: معظم نسخ BluRay وWEB-DL للأفلام تعمل بنفس السرعة 23.976، لذلك يكون الفرق غالباً إزاحة ثابتة فقط. إذا كان التأخير يزداد مع مرور الوقت فهذا يعني اختلاف معدل الإطارات، أو استخدم "المزامنة التلقائية بالجمل" لاكتشاف الاثنين تلقائياً.'
                  )}
                </p>
              </div>
            )}

            {/* Reference mode */}
            {mode === 'reference' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {L(
                    'Upload any subtitle (any language) that is already in sync with your video. If both files have the same number of entries, timings are copied exactly; otherwise the first and last lines are aligned, correcting offset and frame-rate drift.',
                    'ارفع أي ملف ترجمة (بأي لغة) متزامن مسبقاً مع فيلمك. إذا تطابق عدد المقاطع في الملفين يتم نسخ التوقيت حرفياً، وإلا تتم محاذاة أول وآخر سطر لتصحيح الإزاحة وانحراف معدل الإطارات.'
                  )}
                </p>
                <input
                  ref={referenceInputRef}
                  type="file"
                  accept=".srt,.vtt"
                  className="hidden"
                  onChange={(e) => {
                    handleReferenceFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => referenceInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                >
                  <Upload className="w-4 h-4" />
                  {reference ? reference.name : L('Select synced reference file', 'اختر الملف المرجعي المتزامن')}
                </button>
                {reference && computation?.method && (
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {computation.method === 'exact_copy'
                      ? L(
                          `Entry counts match (${cues.length}) — timings copied exactly.`,
                          `عدد المقاطع متطابق (${cues.length}) — تم نسخ التوقيت حرفياً.`
                        )
                      : L(
                          `Entry counts differ (${cues.length} vs ${reference.parsed.cues.length}) — aligned using first and last lines. Verify a line in the middle of the movie.`,
                          `عدد المقاطع مختلف (${cues.length} مقابل ${reference.parsed.cues.length}) — تمت المحاذاة بأول وآخر سطر. تحقق من سطر في منتصف الفيلم.`
                        )}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Result */}
          <div className={cardClass}>
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">
              {L('3. Preview & download', '3. المعاينة والتحميل')}
            </h2>

            {!computation && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {mode === 'reference'
                  ? L('Upload a reference file to continue.', 'ارفع ملفاً مرجعياً للمتابعة.')
                  : L('Enter the time heard in your video for Line A.', 'أدخل وقت سماع السطر الأول في فيلمك.')}
              </p>
            )}

            {computation?.error && (
              <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {computation.error}
              </p>
            )}

            {computation && !computation.error && (
              <div className="space-y-4">
                {computation.transform && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span dir="ltr" className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                      {L('Offset', 'الإزاحة')}: {computation.transform.offsetMs >= 0 ? '+' : ''}
                      {(computation.transform.offsetMs / 1000).toFixed(3)}s
                    </span>
                    <span dir="ltr" className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                      {L('Speed factor', 'معامل السرعة')}: ×{computation.transform.scale.toFixed(5)}
                    </span>
                  </div>
                )}

                {computation.clampedCount > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {L(
                      `${computation.clampedCount} entries moved before 00:00:00 and were clamped to the start.`,
                      `${computation.clampedCount} مقطع أصبح قبل 00:00:00 وتم تثبيته عند البداية.`
                    )}
                  </p>
                )}

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 text-start">#</th>
                        <th className="px-3 py-2 text-start">{L('Before', 'قبل')}</th>
                        <th className="px-3 py-2 text-start">{L('After', 'بعد')}</th>
                        <th className="px-3 py-2 text-start">{L('Text', 'النص')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {previewIndices.map((i) => (
                        <tr key={i} className="text-slate-800 dark:text-slate-200">
                          <td className="px-3 py-2">{cues[i].index}</td>
                          <td className="px-3 py-2 font-mono text-rose-600 dark:text-rose-400" dir="ltr">
                            {msToCueTimestamp(cues[i].startMs)}
                          </td>
                          <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400" dir="ltr">
                            {msToCueTimestamp(computation.cues[i].startMs)}
                          </td>
                          <td className="px-3 py-2">
                            <bdi>{previewText(cues[i].text, 70)}</bdi>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <select
                    className={`${inputClass} w-auto`}
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(e.target.value as TimedSubtitleFormat)}
                  >
                    <option value="srt">SRT</option>
                    <option value="vtt">WebVTT</option>
                  </select>
                  <button
                    type="button"
                    disabled={!canDownload}
                    onClick={handleDownload}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {L('Download synced subtitle', 'تحميل الترجمة المتزامنة')}
                  </button>
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {L(`${cues.length} entries — text unchanged`, `${cues.length} مقطع — النص دون تغيير`)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
