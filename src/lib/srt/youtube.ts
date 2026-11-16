/**
 * YouTube Subtitle & Transcript Utilities
 *
 * Pure, client- and server-safe helpers for:
 *  1. Extracting & validating 11-character YouTube Video IDs from any URL format.
 *  2. Parsing YouTube captions from JSON3, TimedText XML (srv1/srv3), SRT/VTT,
 *     or copy-pasted YouTube "Show transcript" text.
 *  3. De-overlapping and merging fragmented YouTube auto-generated captions (ASR)
 *     into clean, cinema-grade TimedCue entries.
 */

import { type TimedCue, parseFlexibleTimeToMs, parseTimedSubtitle } from './sync';

const YT_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts a validated 11-character YouTube video ID from a URL or raw ID string.
 * Supports youtu.be, youtube.com/watch, /embed, /shorts, /live, and mobile URLs.
 */
export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YT_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|music\.)/, '');

    if (host === 'youtu.be') {
      const seg = url.pathname.split('/').filter(Boolean)[0] || '';
      return YT_ID_REGEX.test(seg) ? seg : null;
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const vParam = url.searchParams.get('v');
      if (vParam && YT_ID_REGEX.test(vParam)) {
        return vParam;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (
        parts.length >= 2 &&
        ['embed', 'shorts', 'live', 'v', 'e'].includes(parts[0].toLowerCase())
      ) {
        const candidate = parts[1];
        return YT_ID_REGEX.test(candidate) ? candidate : null;
      }
    }
  } catch {
    // Fall through to regex fallback
  }

  const fallbackMatch = trimmed.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)/i
  );
  return fallbackMatch && YT_ID_REGEX.test(fallbackMatch[1]) ? fallbackMatch[1] : null;
}

/**
 * Decodes HTML entities commonly present in YouTube XML and JSON3 caption tracks.
 */
export function decodeYouTubeHtmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;

  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    });
}

export interface RawCaptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Cleans, de-overlaps, and merges fragmented YouTube auto-captions into natural subtitle cues.
 */
export function mergeYouTubeAutoCaptionsToCues(
  rawSegments: RawCaptionSegment[],
  options: { mergeFragments?: boolean } = {}
): TimedCue[] {
  const shouldMerge = options.mergeFragments ?? true;

  // 1. Clean text, decode entities, and filter out empty segments
  const cleaned: RawCaptionSegment[] = [];
  for (const seg of rawSegments) {
    const text = decodeYouTubeHtmlEntities(seg.text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!text) continue;
    const startMs = Math.max(0, Math.round(seg.startMs));
    const endMs = Math.max(startMs + 400, Math.round(seg.endMs));
    cleaned.push({ startMs, endMs, text });
  }

  if (cleaned.length === 0) return [];

  // 2. Sort by startMs and resolve overlapping timestamps + rolling ASR duplicates
  cleaned.sort((a, b) => a.startMs - b.startMs);

  const deoverlapped: RawCaptionSegment[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const current = { ...cleaned[i] };
    const prev = deoverlapped[deoverlapped.length - 1];

    if (prev) {
      // Skip exact duplicate consecutive text within 2 seconds
      if (
        prev.text.toLowerCase() === current.text.toLowerCase() &&
        current.startMs - prev.startMs < 2000
      ) {
        prev.endMs = Math.max(prev.endMs, current.endMs);
        continue;
      }

      // If YouTube rolling caption repeats previous line as a prefix, strip the repeated prefix
      if (
        current.text.length > prev.text.length + 2 &&
        current.text.toLowerCase().startsWith(prev.text.toLowerCase() + ' ') &&
        current.startMs < prev.endMs + 300
      ) {
        current.text = current.text.slice(prev.text.length).trim();
      }

      // Clamp previous endMs so two cues never overlap on screen
      if (prev.endMs > current.startMs) {
        prev.endMs = Math.max(prev.startMs + 250, current.startMs);
      }
    }

    if (current.text) {
      deoverlapped.push(current);
    }
  }

  if (!shouldMerge) {
    return deoverlapped.map((seg, idx) => ({
      index: idx + 1,
      startMs: seg.startMs,
      endMs: Math.max(seg.startMs + 500, seg.endMs),
      text: seg.text,
    }));
  }

  // 3. Merge fragmented ASR words/clauses into natural readable subtitle cues
  const merged: RawCaptionSegment[] = [];
  for (const seg of deoverlapped) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...seg });
      continue;
    }

    const gapMs = seg.startMs - prev.endMs;
    const combinedDurationMs = seg.endMs - prev.startMs;
    const combinedChars = prev.text.length + 1 + seg.text.length;
    const prevEndsSentence = /[.?!؟…»"]$/.test(prev.text.trim());
    const isBracketedEffect =
      /^\[[^\]]+\]$/.test(prev.text.trim()) || /^\[[^\]]+\]$/.test(seg.text.trim());
    const startsNewSpeaker = /^-\s/.test(seg.text.trim());

    if (
      !prevEndsSentence &&
      !isBracketedEffect &&
      !startsNewSpeaker &&
      gapMs <= 450 &&
      prev.text.length < 48 &&
      combinedChars <= 84 &&
      combinedDurationMs <= 6200
    ) {
      prev.text = `${prev.text} ${seg.text}`.replace(/\s+/g, ' ').trim();
      prev.endMs = seg.endMs;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.map((seg, idx) => ({
    index: idx + 1,
    startMs: seg.startMs,
    endMs: Math.max(seg.startMs + 600, seg.endMs),
    text: seg.text,
  }));
}

/**
 * Universal parser for YouTube caption data in any format:
 *  - Standard SRT or WebVTT
 *  - YouTube JSON3 (`{ events: [...] }`)
 *  - YouTube TimedText XML (`<transcript><text start="..." dur="...">` or `<timedtext><body><p t="..." d="...">`)
 *  - Copy-pasted YouTube "Show transcript" plain text (`0:04\nDialogue line` or `0:04 Dialogue line`)
 */
export function parseYouTubeTranscriptPayload(raw: string): TimedCue[] {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];

  // 1. Standard SRT / WebVTT
  if (trimmed.includes('-->')) {
    const parsed = parseTimedSubtitle(trimmed);
    if (parsed.cues.length > 0) return parsed.cues;
  }

  // 2. YouTube JSON3 format
  if (trimmed.startsWith('{') && trimmed.includes('"events"')) {
    try {
      const data = JSON.parse(trimmed) as {
        events?: Array<{
          tStartMs?: number;
          dDurationMs?: number;
          segs?: Array<{ utf8?: string }>;
        }>;
      };
      if (Array.isArray(data.events)) {
        const segments: RawCaptionSegment[] = [];
        for (const ev of data.events) {
          if (typeof ev.tStartMs !== 'number' || !Array.isArray(ev.segs)) continue;
          const text = ev.segs.map((s) => s.utf8 || '').join('').trim();
          if (!text) continue;
          const startMs = ev.tStartMs;
          const durMs = typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0 ? ev.dDurationMs : 2500;
          segments.push({ startMs, endMs: startMs + durMs, text });
        }
        if (segments.length > 0) {
          return mergeYouTubeAutoCaptionsToCues(segments);
        }
      }
    } catch {
      // Fall through to XML / plain text parsers
    }
  }

  // 3. YouTube TimedText XML (<text start="12.34" dur="2.5"> or <p t="12340" d="2500">)
  if (trimmed.startsWith('<') && (trimmed.includes('<text') || trimmed.includes('<p '))) {
    const segments: RawCaptionSegment[] = [];

    const textTagRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match: RegExpExecArray | null;
    while ((match = textTagRegex.exec(trimmed)) !== null) {
      const attrs = match[1];
      const body = match[2].replace(/<[^>]+>/g, '');
      const startAttr = attrs.match(/\bstart\s*=\s*["']([0-9.]+)["']/i);
      if (!startAttr) continue;
      const durAttr = attrs.match(/\bdur\s*=\s*["']([0-9.]+)["']/i);
      const startMs = Math.round(parseFloat(startAttr[1]) * 1000);
      const durMs = durAttr ? Math.round(parseFloat(durAttr[1]) * 1000) : 2500;
      if (Number.isFinite(startMs)) {
        segments.push({ startMs, endMs: startMs + Math.max(500, durMs), text: body });
      }
    }

    if (segments.length === 0) {
      const pTagRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
      while ((match = pTagRegex.exec(trimmed)) !== null) {
        const attrs = match[1];
        const body = match[2].replace(/<[^>]+>/g, '');
        const tAttr = attrs.match(/\bt\s*=\s*["'](\d+)["']/i);
        if (!tAttr) continue;
        const dAttr = attrs.match(/\bd\s*=\s*["'](\d+)["']/i);
        const startMs = parseInt(tAttr[1], 10);
        const durMs = dAttr ? parseInt(dAttr[1], 10) : 2500;
        if (Number.isFinite(startMs)) {
          segments.push({ startMs, endMs: startMs + Math.max(500, durMs), text: body });
        }
      }
    }

    if (segments.length > 0) {
      return mergeYouTubeAutoCaptionsToCues(segments);
    }
  }

  // 4. Copy-pasted YouTube "Show transcript" text
  // Supports both:
  //   0:04
  //   Hello world
  // and:
  //   0:04 Hello world
  const lines = trimmed
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const timestampLineRegex = /^((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)(?:\s+(.*))?$/;
  const rawEntries: Array<{ startMs: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(timestampLineRegex);
    if (!m) continue;
    const startMs = parseFlexibleTimeToMs(m[1]);
    if (startMs === null) continue;

    if (m[2] && m[2].trim()) {
      rawEntries.push({ startMs, text: m[2].trim() });
    } else {
      // Collect subsequent non-timestamp lines as the text for this timestamp
      const textParts: string[] = [];
      while (i + 1 < lines.length && !timestampLineRegex.test(lines[i + 1])) {
        i++;
        textParts.push(lines[i]);
      }
      if (textParts.length > 0) {
        rawEntries.push({ startMs, text: textParts.join(' ') });
      }
    }
  }

  if (rawEntries.length > 0) {
    const segments: RawCaptionSegment[] = rawEntries.map((entry, idx) => {
      const nextStart = rawEntries[idx + 1]?.startMs;
      const estimatedDur = Math.max(1600, Math.min(5000, entry.text.length * 75));
      const endMs =
        typeof nextStart === 'number' && nextStart > entry.startMs
          ? Math.min(nextStart, entry.startMs + estimatedDur)
          : entry.startMs + estimatedDur;
      return {
        startMs: entry.startMs,
        endMs: Math.max(entry.startMs + 500, endMs),
        text: entry.text,
      };
    });
    return mergeYouTubeAutoCaptionsToCues(segments);
  }

  return [];
}
