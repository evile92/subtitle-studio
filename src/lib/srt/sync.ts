/**
 * Subtitle Sync & Release Converter
 *
 * Pure, client-safe timing utilities used to re-synchronize a subtitle file made for one
 * video release (e.g. BluRay) so it plays correctly on another release (e.g. WEB-DL / HDTV).
 *
 * Every correction is modeled as a linear time transform:
 *     newTime = oldTime * scale + offsetMs
 *  - `offsetMs` fixes a constant shift (different studio/platform intro length).
 *  - `scale` fixes progressive drift caused by a different frame rate (e.g. 23.976 vs 25 fps).
 *
 * Subtitle text is never modified — only timestamps are rewritten.
 */

export type TimedSubtitleFormat = 'srt' | 'vtt';

export interface TimedCue {
  /** 1-based position of the cue in the file */
  index: number;
  startMs: number;
  endMs: number;
  /** Raw subtitle text exactly as it appears in the file (formatting tags preserved) */
  text: string;
  /** WebVTT cue settings (e.g. "align:start position:10%") — preserved for VTT output */
  vttSettings?: string;
}

export interface ParsedTimedSubtitle {
  format: TimedSubtitleFormat;
  cues: TimedCue[];
}

export interface LinearTimeTransform {
  scale: number;
  offsetMs: number;
}

export interface ApplyTransformResult {
  cues: TimedCue[];
  /** Number of cues pushed before 00:00:00 that had to be clamped to zero */
  clampedCount: number;
}

export const FPS_PRESETS: Array<{ value: number; label: string }> = [
  { value: 23.976, label: '23.976 fps (BluRay / most WEB-DL)' },
  { value: 24, label: '24.000 fps (Cinema / some WEB-DL)' },
  { value: 25, label: '25.000 fps (PAL / European HDTV)' },
  { value: 29.97, label: '29.970 fps (NTSC TV)' },
  { value: 30, label: '30.000 fps' },
];

const CUE_TIMING_REGEX =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})(.*)$/;

/**
 * Converts "HH:MM:SS,mmm", "HH:MM:SS.mmm" or WebVTT "MM:SS.mmm" into milliseconds.
 */
export function cueTimestampToMs(ts: string): number {
  const parts = ts.trim().split(':');
  const secPart = parts.pop() ?? '0';
  const [secStr, fracStr = '0'] = secPart.split(/[,.]/);
  const seconds = parseInt(secStr, 10) || 0;
  const millis = parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10) || 0;
  const minutes = parts.length > 0 ? parseInt(parts.pop() as string, 10) || 0 : 0;
  const hours = parts.length > 0 ? parseInt(parts.pop() as string, 10) || 0 : 0;
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + millis;
}

/**
 * Formats milliseconds as "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (WebVTT).
 */
export function msToCueTimestamp(totalMs: number, format: TimedSubtitleFormat = 'srt'): string {
  const safe = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  const sep = format === 'vtt' ? '.' : ',';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds
  ).padStart(2, '0')}${sep}${String(millis).padStart(3, '0')}`;
}

/**
 * Parses a flexible user-entered video time into milliseconds.
 * Accepts: "74.5" (seconds), "1:14", "01:14.5", "00:01:14,500".
 * Returns null when the input cannot be parsed.
 */
export function parseFlexibleTimeToMs(input: string): number | null {
  const value = input.trim();
  if (!value) return null;

  if (!value.includes(':')) {
    const secs = Number(value.replace(',', '.'));
    return Number.isFinite(secs) && secs >= 0 ? Math.round(secs * 1000) : null;
  }

  const parts = value.split(':');
  if (parts.length > 3 || parts.some((p) => p.trim() === '')) return null;

  const secs = Number(parts.pop()!.replace(',', '.'));
  const mins = Number(parts.pop() ?? '0');
  const hrs = Number(parts.pop() ?? '0');
  if (![secs, mins, hrs].every((n) => Number.isFinite(n) && n >= 0)) return null;

  return Math.round((hrs * 3600 + mins * 60 + secs) * 1000);
}

/**
 * Parses SRT or WebVTT content into timed cues without altering any subtitle text.
 */
export function parseTimedSubtitle(raw: string): ParsedTimedSubtitle {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const format: TimedSubtitleFormat = /^\s*WEBVTT/.test(normalized) ? 'vtt' : 'srt';
  const blocks = normalized.split(/\n[ \t]*\n/);
  const cues: TimedCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    const match = lines[timingIdx].match(CUE_TIMING_REGEX);
    if (!match) continue;

    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .replace(/\s+$/, '');

    cues.push({
      index: cues.length + 1,
      startMs: cueTimestampToMs(match[1]),
      endMs: cueTimestampToMs(match[2]),
      text,
      vttSettings: format === 'vtt' && match[3]?.trim() ? match[3].trim() : undefined,
    });
  }

  return { format, cues };
}

/**
 * Applies `newTime = oldTime * scale + offsetMs` to every cue.
 * Cues pushed before zero are clamped (and counted) so the output is always a valid file.
 */
export function applyLinearTransform(
  cues: TimedCue[],
  transform: LinearTimeTransform
): ApplyTransformResult {
  let clampedCount = 0;

  const result = cues.map((cue) => {
    let startMs = Math.round(cue.startMs * transform.scale + transform.offsetMs);
    let endMs = Math.round(cue.endMs * transform.scale + transform.offsetMs);

    if (startMs < 0 || endMs < 0) {
      clampedCount++;
      startMs = Math.max(0, startMs);
      endMs = Math.max(0, endMs);
    }
    if (endMs < startMs) endMs = startMs;

    return { ...cue, startMs, endMs };
  });

  return { cues: result, clampedCount };
}

/**
 * Frame-rate conversion scale.
 * A subtitle timed for a `sourceFps` release played on a `targetFps` release:
 *   e.g. 23.976 -> 25 (PAL speed-up) makes the movie shorter, so timestamps shrink by 23.976 / 25.
 */
export function fpsConversionScale(sourceFps: number, targetFps: number): number {
  if (!(sourceFps > 0) || !(targetFps > 0)) return 1;
  return sourceFps / targetFps;
}

/**
 * Builds a transform from one or two anchor points (subtitle time -> real video time).
 * - One anchor: fixes constant offset only.
 * - Two anchors: fixes offset AND frame-rate drift.
 */
export function transformFromAnchors(
  anchor1: { subtitleMs: number; videoMs: number },
  anchor2?: { subtitleMs: number; videoMs: number }
): LinearTimeTransform {
  if (!anchor2 || anchor2.subtitleMs === anchor1.subtitleMs) {
    return { scale: 1, offsetMs: anchor1.videoMs - anchor1.subtitleMs };
  }
  const scale = (anchor2.videoMs - anchor1.videoMs) / (anchor2.subtitleMs - anchor1.subtitleMs);
  const offsetMs = anchor1.videoMs - anchor1.subtitleMs * scale;
  return { scale, offsetMs };
}

export interface ReferenceSyncResult {
  cues: TimedCue[];
  method: 'exact_copy' | 'linear_anchor' | 'cadence_correlation';
  transform?: LinearTimeTransform;
  confidence?: number;
  clampedCount: number;
}

const CREDIT_OR_WATERMARK_REGEX =
  /(?:subtitles?\s+by|synced\s+by|synched\s+by|transcribed\s+by|ripped\s+by|encoded\s+by|opensubtitles|subscene|yts\.|yify|addic7ed|podnapisi|www\.|https?:\/\/|ترجم[ةه]\s*(?:و\s*إعداد|و\s*تعديل|و\s*مزامن[ةه]|:)|إعداد\s*وترجم[ةه]|حقوق\s*الترجم[ةه]|مزامن[ةه]\s*وتعديل|تابعونا\s*على)/i;

/**
 * Detects whether a subtitle cue is likely non-dialogue (translator credit, watermark,
 * empty cue, pure music lyric ♪, or sound-effect tag like "[Music]" / "(Applause)").
 */
export function isLikelyNonDialogueCue(text: string): boolean {
  const plain = text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .trim();

  if (!plain) return true;
  if (/^[♪♫♬\s.,!?؟…\-–—*#]+$/.test(plain)) return true;
  if (/^[♪♫]/.test(plain) || /[♪♫]$/.test(plain)) return true;

  // Entirely bracketed sound effects / SDH cues such as "[Music]", "(applause)", "[موسيقى]"
  const lines = plain
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (
    lines.length > 0 &&
    lines.every(
      (line) =>
        (/^\[[^\]]+\]$/.test(line) || /^\([^)]+\)$/.test(line)) &&
        line.length <= 45
    )
  ) {
    return true;
  }

  if (CREDIT_OR_WATERMARK_REGEX.test(plain)) return true;

  return false;
}

/**
 * Finds the best first and last spoken-dialogue cue indices for anchor syncing,
 * automatically skipping translator credits, "[Music]" tags, and song cues at the edges.
 */
export function findRecommendedAnchorIndices(cues: TimedCue[]): {
  firstIdx: number;
  lastIdx: number;
} {
  if (cues.length === 0) return { firstIdx: 0, lastIdx: 0 };
  if (cues.length === 1) return { firstIdx: 0, lastIdx: 0 };

  const headLimit = Math.min(cues.length - 1, Math.max(8, Math.floor(cues.length * 0.2)));
  let firstIdx = 0;
  for (let i = 0; i <= headLimit; i++) {
    if (!isLikelyNonDialogueCue(cues[i].text)) {
      firstIdx = i;
      break;
    }
  }

  const tailLimit = Math.max(firstIdx + 1, Math.floor(cues.length * 0.8));
  let lastIdx = cues.length - 1;
  for (let i = cues.length - 1; i >= tailLimit; i--) {
    if (!isLikelyNonDialogueCue(cues[i].text)) {
      lastIdx = i;
      break;
    }
  }

  if (lastIdx <= firstIdx) {
    lastIdx = cues.length - 1;
  }

  return { firstIdx, lastIdx };
}

/**
 * Returns all cues active at `currentTimeMs` (used by the live YouTube video overlay).
 */
export function findActiveCuesAtTime(cues: TimedCue[], currentTimeMs: number): TimedCue[] {
  if (cues.length === 0 || currentTimeMs < 0) return [];
  const active: TimedCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.endMs >= currentTimeMs && cue.startMs <= currentTimeMs) {
      active.push(cue);
    }
  }
  return active;
}

/**
 * Computes the speech-interval overlap score (0..1) between transformed target cues
 * and reference cues using 200ms time buckets.
 */
function scoreDialogueOverlap(
  targetCues: TimedCue[],
  refBuckets: Uint8Array,
  bucketMs: number,
  maxBucketIdx: number,
  transform: LinearTimeTransform
): number {
  let matchedBuckets = 0;
  let totalTargetBuckets = 0;

  for (let i = 0; i < targetCues.length; i++) {
    const c = targetCues[i];
    const startMs = c.startMs * transform.scale + transform.offsetMs;
    const endMs = c.endMs * transform.scale + transform.offsetMs;
    const bStart = Math.floor(startMs / bucketMs);
    const bEnd = Math.ceil(endMs / bucketMs);
    const span = Math.max(1, Math.min(25, bEnd - bStart));
    totalTargetBuckets += span;

    if (bEnd < 0 || bStart > maxBucketIdx) continue;
    const clampedStart = Math.max(0, bStart);
    const clampedEnd = Math.min(maxBucketIdx, bStart + span);
    for (let b = clampedStart; b < clampedEnd; b++) {
      if (refBuckets[b]) matchedBuckets++;
    }
  }

  return totalTargetBuckets > 0 ? matchedBuckets / totalTargetBuckets : 0;
}

/**
 * Re-times `target` cues using a `reference` subtitle that is already in sync with the video
 * (such as YouTube's built-in captions or another release subtitle).
 * - Identical cue count: timings are copied 1-to-1 (exact match).
 * - Different cue count: filters out non-dialogue credit/music cues and uses dialogue cadence
 *   cross-correlation + anchor fitting to recover both intro offset and frame-rate drift even
 *   when one file has extra intro/outro lines or different segmentation.
 */
export function syncFromReference(target: TimedCue[], reference: TimedCue[]): ReferenceSyncResult {
  if (target.length === 0 || reference.length === 0) {
    return { cues: target, method: 'linear_anchor', clampedCount: 0 };
  }

  if (target.length === reference.length) {
    return {
      cues: target.map((cue, i) => ({
        ...cue,
        startMs: reference[i].startMs,
        endMs: reference[i].endMs,
      })),
      method: 'exact_copy',
      confidence: 1,
      clampedCount: 0,
    };
  }

  const targetBounds = findRecommendedAnchorIndices(target);
  const refBounds = findRecommendedAnchorIndices(reference);

  const anchorTransform = transformFromAnchors(
    { subtitleMs: target[targetBounds.firstIdx].startMs, videoMs: reference[refBounds.firstIdx].startMs },
    {
      subtitleMs: target[targetBounds.lastIdx].startMs,
      videoMs: reference[refBounds.lastIdx].startMs,
    }
  );

  const dialogueTarget = target.filter((c) => !isLikelyNonDialogueCue(c.text));
  const dialogueRef = reference.filter((c) => !isLikelyNonDialogueCue(c.text));

  // For short snippets (< 8 dialogue cues), filtered first/last dialogue anchors are exact
  if (dialogueTarget.length < 8 || dialogueRef.length < 8) {
    const applied = applyLinearTransform(target, anchorTransform);
    return {
      cues: applied.cues,
      method: 'linear_anchor',
      transform: anchorTransform,
      clampedCount: applied.clampedCount,
    };
  }

  const BUCKET_MS = 200;
  const maxRefEndMs = dialogueRef[dialogueRef.length - 1].endMs + 120_000;
  const maxBucketIdx = Math.min(250_000, Math.ceil(maxRefEndMs / BUCKET_MS));
  const refBuckets = new Uint8Array(maxBucketIdx + 1);

  for (let i = 0; i < dialogueRef.length; i++) {
    const bStart = Math.max(0, Math.floor(dialogueRef[i].startMs / BUCKET_MS));
    const bEnd = Math.min(maxBucketIdx, Math.ceil(dialogueRef[i].endMs / BUCKET_MS));
    for (let b = bStart; b <= bEnd; b++) {
      refBuckets[b] = 1;
    }
  }

  // Sample up to 240 dialogue cues (first 120 + last 120) for fast, high-precision correlation
  const sampleTarget =
    dialogueTarget.length <= 240
      ? dialogueTarget
      : [...dialogueTarget.slice(0, 120), ...dialogueTarget.slice(-120)];

  let bestTransform: LinearTimeTransform =
    anchorTransform.scale > 0.75 && anchorTransform.scale < 1.3
      ? anchorTransform
      : { scale: 1, offsetMs: reference[refBounds.firstIdx].startMs - target[targetBounds.firstIdx].startMs };

  const baselineScore = scoreDialogueOverlap(
    sampleTarget,
    refBuckets,
    BUCKET_MS,
    maxBucketIdx,
    bestTransform
  );
  let bestScore = baselineScore;
  let usedCorrelation = false;

  const candidateScales = [
    1,
    fpsConversionScale(23.976, 25),
    fpsConversionScale(25, 23.976),
    fpsConversionScale(23.976, 24),
    fpsConversionScale(24, 23.976),
    fpsConversionScale(23.976, 29.97),
    fpsConversionScale(29.97, 23.976),
  ];
  if (anchorTransform.scale > 0.8 && anchorTransform.scale < 1.25) {
    candidateScales.push(anchorTransform.scale);
  }

  // Generate candidate transforms by pairing early/late dialogue cues and testing standard FPS scales
  const earlyT = dialogueTarget.slice(0, Math.min(8, dialogueTarget.length));
  const earlyR = dialogueRef.slice(0, Math.min(12, dialogueRef.length));
  const lateT = dialogueTarget.slice(-Math.min(8, dialogueTarget.length));
  const lateR = dialogueRef.slice(-Math.min(12, dialogueRef.length));

  for (const scale of candidateScales) {
    const testedOffsets = new Set<number>();
    for (const tc of earlyT) {
      for (const rc of earlyR) {
        const off = Math.round((rc.startMs - tc.startMs * scale) / 200) * 200;
        if (Math.abs(off) <= 600_000) testedOffsets.add(off);
      }
    }
    for (const tc of lateT) {
      for (const rc of lateR) {
        const off = Math.round((rc.startMs - tc.startMs * scale) / 200) * 200;
        if (Math.abs(off) <= 600_000) testedOffsets.add(off);
      }
    }

    for (const offsetMs of testedOffsets) {
      const score = scoreDialogueOverlap(sampleTarget, refBuckets, BUCKET_MS, maxBucketIdx, {
        scale,
        offsetMs,
      });
      if (score > bestScore + 0.015) {
        bestScore = score;
        bestTransform = { scale, offsetMs };
        usedCorrelation = true;
      }
    }
  }

  //Also test pairing early + late anchors across the first/last few genuine dialogue cues
  for (let i = 0; i < Math.min(5, earlyT.length); i++) {
    for (let j = 0; j < Math.min(8, earlyR.length); j++) {
      for (let k = 0; k < Math.min(5, lateT.length); k++) {
        for (let m = 0; m < Math.min(8, lateR.length); m++) {
          const cand = transformFromAnchors(
            { subtitleMs: earlyT[i].startMs, videoMs: earlyR[j].startMs },
            { subtitleMs: lateT[k].startMs, videoMs: lateR[m].startMs }
          );
          if (cand.scale < 0.85 || cand.scale > 1.18) continue;
          const score = scoreDialogueOverlap(sampleTarget, refBuckets, BUCKET_MS, maxBucketIdx, cand);
          if (score > bestScore + 0.015) {
            bestScore = score;
            bestTransform = cand;
            usedCorrelation = true;
          }
        }
      }
    }
  }

  // Fine local refinement (±1200ms in 100ms steps) around the winning transform
  const centerOffset = bestTransform.offsetMs;
  for (let delta = -1200; delta <= 1200; delta += 100) {
    const candidate = { scale: bestTransform.scale, offsetMs: centerOffset + delta };
    const score = scoreDialogueOverlap(sampleTarget, refBuckets, BUCKET_MS, maxBucketIdx, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestTransform = candidate;
    }
  }

  const applied = applyLinearTransform(target, bestTransform);
  return {
    cues: applied.cues,
    method: usedCorrelation ? 'cadence_correlation' : 'linear_anchor',
    transform: bestTransform,
    confidence: Math.min(1, Number(bestScore.toFixed(3))),
    clampedCount: applied.clampedCount,
  };
}

/**
 * Serializes cues back into a valid SRT or WebVTT file (cues renumbered sequentially).
 */
export function serializeTimedSubtitle(cues: TimedCue[], format: TimedSubtitleFormat): string {
  if (format === 'vtt') {
    const body = cues
      .map(
        (c) =>
          `${msToCueTimestamp(c.startMs, 'vtt')} --> ${msToCueTimestamp(c.endMs, 'vtt')}${
            c.vttSettings ? ` ${c.vttSettings}` : ''
          }\n${c.text}`
      )
      .join('\n\n');
    return `WEBVTT\n\n${body}\n`;
  }

  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${msToCueTimestamp(c.startMs, 'srt')} --> ${msToCueTimestamp(c.endMs, 'srt')}\n${c.text}`
      )
      .join('\n\n') + '\n'
  );
}

/**
 * Decodes an uploaded subtitle file. Tries strict UTF-8 first, then falls back to
 * Windows-1256, the legacy encoding used by many older Arabic subtitle files.
 */
export function decodeSubtitleBytes(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('windows-1256').decode(buffer);
    } catch {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }
}
