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
  method: 'exact_copy' | 'linear_anchor';
  transform?: LinearTimeTransform;
  clampedCount: number;
}

/**
 * Re-times `target` cues using a `reference` subtitle that is already in sync with the video.
 * - Identical cue count: timings are copied 1-to-1 (exact match, e.g. same release in another language).
 * - Different cue count: a linear transform is fitted from the first and last cue of each file,
 *   which corrects both intro offset and frame-rate drift.
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
      clampedCount: 0,
    };
  }

  const transform = transformFromAnchors(
    { subtitleMs: target[0].startMs, videoMs: reference[0].startMs },
    {
      subtitleMs: target[target.length - 1].startMs,
      videoMs: reference[reference.length - 1].startMs,
    }
  );
  const applied = applyLinearTransform(target, transform);
  return { cues: applied.cues, method: 'linear_anchor', transform, clampedCount: applied.clampedCount };
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
