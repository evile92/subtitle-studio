import type { SubtitleEntry, SupportedFormat } from '@/types/subtitle';
import { detectLanguageFromText } from '@/lib/languages';

export interface ParseResult {
  isValid: boolean;
  format: SupportedFormat;
  entries: SubtitleEntry[];
  totalEntries: number;
  detectedLanguage: string;
  detectedLanguageConfidence: number;
  totalDurationSeconds: number;
  speakerCount: number;
  formattedEntryCount: number;
  errors: string[];
  warnings: string[];
}

export interface SubtitleFormatParser {
  format: SupportedFormat;
  extensions: string[];
  parse(rawContent: string): ParseResult;
}

const SRT_TIMESTAMP_LINE_REGEX =
  /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/;

/**
 * Converts an SRT timestamp ("00:01:23,450" or "00:01:23.450") into milliseconds.
 * Note: We NEVER alter the original timestamp string stored in entry.startTime / entry.endTime.
 */
export function timestampToMs(ts: string): number {
  const normalized = ts.trim().replace('.', ',');
  const [hms, msPart = '0'] = normalized.split(',');
  const parts = hms.split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 0;
  const [hours, minutes, seconds] = parts;
  const ms = parseInt(msPart.padEnd(3, '0').slice(0, 3), 10) || 0;
  return ((hours * 3600 + minutes * 60 + seconds) * 1000) + ms;
}

/**
 * Extracts formatting tags (HTML-style `<i>`, `<b>`, `<u>`, `<font...>` and ASS-style `{\an8}`)
 */
export function extractFormattingTags(text: string): string[] {
  const tags: string[] = [];
  const htmlTagRegex = /<\/?[a-zA-Z][^>]*>/g;
  const assTagRegex = /\{\\[^}]+\}/g;

  let match: RegExpExecArray | null;
  while ((match = htmlTagRegex.exec(text)) !== null) {
    tags.push(match[0]);
  }
  while ((match = assTagRegex.exec(text)) !== null) {
    tags.push(match[0]);
  }
  return tags;
}

/**
 * Extracts speaker labels if present at the start of a line, such as:
 * "JOHN: What are you doing?"
 * "[SARAH]: Wait for me!"
 * "- MAN 1: Hold on."
 */
export function extractSpeakerLabel(text: string): string | undefined {
  const stripped = text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, '').trim();
  const firstLine = stripped.split(/\r?\n/)[0] || '';

  // Match "[SPEAKER]: ..." or "SPEAKER: ..."
  const bracketSpeaker = firstLine.match(/^-\s*\[([A-Za-z0-9\u0600-\u06FF\s_.-]{2,25})\]\s*:\s*\S/)
    || firstLine.match(/^\[([A-Za-z0-9\u0600-\u06FF\s_.-]{2,25})\]\s*:\s*\S/);
  if (bracketSpeaker) {
    return bracketSpeaker[1].trim();
  }

  const colonSpeaker = firstLine.match(/^(?:-\s*)?([A-Z\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF\s]{1,22}):\s+\S/);
  if (colonSpeaker) {
    const candidate = colonSpeaker[1].trim();
    // Avoid matching time expressions or common non-speaker prefixes
    if (!/^(http|https|note|scene|chapter|part)$/i.test(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Checks whether an entry is primarily a sound effect or music cue
 * e.g. "[dramatic music]", "(sighs)", "♪ Never gonna give you up ♪"
 */
export function detectSoundEffect(text: string): boolean {
  const stripped = text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, '').trim();
  if (!stripped) return false;
  if (/^[♪♫].*[♪♫]?$/s.test(stripped)) return true;
  if (/^\[[^\]]+\]$/.test(stripped) || /^\([^)]+\)$/.test(stripped)) return true;
  return false;
}

/**
 * Strips formatting tags for plain-text analysis while keeping dialogue intact.
 */
export function stripFormattingTags(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .trim();
}

/**
 * Validates raw file content before or during parsing to reject binary files,
 * non-SRT files, or corrupted payloads with clear error messages.
 */
export function validateRawSrtInput(
  rawContent: string,
  fileName?: string,
  maxSizeBytes: number = 15 * 1024 * 1024
): { valid: boolean; error?: string } {
  if (fileName && !fileName.toLowerCase().endsWith('.srt')) {
    return {
      valid: false,
      error: `Unsupported file format for "${fileName}". Please upload a valid SubRip (.srt) subtitle file.`,
    };
  }

  if (!rawContent || typeof rawContent !== 'string') {
    return {
      valid: false,
      error: 'The uploaded subtitle file is empty or unreadable.',
    };
  }

  const byteLength = Buffer.byteLength(rawContent, 'utf8');
  if (byteLength > maxSizeBytes) {
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds the maximum allowed limit of ${maxMb} MB.`,
    };
  }

  // Check for binary null bytes
  if (rawContent.includes('\u0000')) {
    return {
      valid: false,
      error: 'The uploaded file appears to be a binary file rather than a text-based SRT subtitle file.',
    };
  }

  const trimmed = rawContent.replace(/^\uFEFF/, '').trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: 'The uploaded SRT file contains no text content.',
    };
  }

  // Quick check for at least one SRT timestamp arrow "-->"
  if (!trimmed.includes('-->')) {
    return {
      valid: false,
      error: 'Invalid SRT structure: No subtitle timestamps ("HH:MM:SS,mmm --> HH:MM:SS,mmm") were found in the file.',
    };
  }

  return { valid: true };
}

/**
 * Stage A: Full SRT Parser
 * Parses every subtitle entry accurately without discarding dialogue or altering timestamps.
 */
export function parseSrtContent(rawContent: string, fileName?: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const preCheck = validateRawSrtInput(rawContent, fileName);
  if (!preCheck.valid) {
    return {
      isValid: false,
      format: 'srt',
      entries: [],
      totalEntries: 0,
      detectedLanguage: 'en',
      detectedLanguageConfidence: 0,
      totalDurationSeconds: 0,
      speakerCount: 0,
      formattedEntryCount: 0,
      errors: [preCheck.error || 'Invalid SRT file'],
      warnings: [],
    };
  }

  // Strip UTF-8 BOM if present and normalize line endings to \n for block parsing
  const content = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = content.split('\n');
  const entries: SubtitleEntry[] = [];
  const speakers = new Set<string>();
  let formattedEntryCount = 0;

  let i = 0;
  const n = lines.length;

  while (i < n) {
    // Skip leading blank lines
    while (i < n && lines[i].trim() === '') {
      i++;
    }
    if (i >= n) break;

    let sequenceNum: number | null = null;
    const firstLine = lines[i].trim();

    // Check if the current line is a sequence number followed by a timestamp line
    if (/^\d+$/.test(firstLine) && i + 1 < n && SRT_TIMESTAMP_LINE_REGEX.test(lines[i + 1].trim())) {
      sequenceNum = parseInt(firstLine, 10);
      i++;
    } else if (SRT_TIMESTAMP_LINE_REGEX.test(firstLine)) {
      // Missing sequence number before timestamp line — recover gracefully with warning
      sequenceNum = entries.length + 1;
      warnings.push(`Entry #${sequenceNum}: Missing sequence number header before timestamp "${firstLine}"; assigned sequence ${sequenceNum}.`);
    } else {
      // Malformed line — check if the next line has a timestamp or skip & warn
      let foundTimestampAhead = false;
      if (i + 1 < n && SRT_TIMESTAMP_LINE_REGEX.test(lines[i + 1].trim())) {
        const parsedSeq = parseInt(firstLine.replace(/[^\d]/g, ''), 10);
        sequenceNum = !isNaN(parsedSeq) ? parsedSeq : entries.length + 1;
        warnings.push(`Entry #${sequenceNum}: Non-standard sequence header "${firstLine}".`);
        foundTimestampAhead = true;
        i++;
      }
      if (!foundTimestampAhead) {
        warnings.push(`Line ${i + 1}: Skipped unrecognized header line "${firstLine.slice(0, 60)}".`);
        i++;
        continue;
      }
    }

    // Parse the timestamp line
    const tsLine = lines[i].trim();
    const tsMatch = tsLine.match(SRT_TIMESTAMP_LINE_REGEX);
    if (!tsMatch) {
      errors.push(`Line ${i + 1}: Invalid timestamp format "${tsLine}".`);
      i++;
      continue;
    }

    // Preserve exact original timestamp strings
    const startTime = tsMatch[1];
    const endTime = tsMatch[2];
    const startMs = timestampToMs(startTime);
    const endMs = timestampToMs(endTime);

    if (endMs < startMs) {
      warnings.push(`Subtitle #${sequenceNum}: End timestamp (${endTime}) is earlier than start timestamp (${startTime}).`);
    }

    i++; // Move to dialogue lines

    const dialogueLines: string[] = [];
    while (i < n) {
      // A blank line ends the subtitle block ONLY if the next non-blank line is a sequence number + timestamp (or EOF)
      if (lines[i].trim() === '') {
        // Look ahead to see if next non-empty line starts a new subtitle block
        let lookahead = i + 1;
        while (lookahead < n && lines[lookahead].trim() === '') {
          lookahead++;
        }
        if (
          lookahead >= n ||
          SRT_TIMESTAMP_LINE_REGEX.test(lines[lookahead].trim()) ||
          (/^\d+$/.test(lines[lookahead].trim()) &&
            lookahead + 1 < n &&
            SRT_TIMESTAMP_LINE_REGEX.test(lines[lookahead + 1].trim()))
        ) {
          i = lookahead;
          break;
        }
      }
      dialogueLines.push(lines[i]);
      i++;
    }

    const originalText = dialogueLines.join('\n').trimEnd();
    const cleanText = stripFormattingTags(originalText);
    const formattingTags = extractFormattingTags(originalText);
    const speakerLabel = extractSpeakerLabel(originalText);
    const isSoundEffect = detectSoundEffect(originalText);

    if (speakerLabel) {
      speakers.add(speakerLabel.toUpperCase());
    }
    if (formattingTags.length > 0) {
      formattedEntryCount++;
    }

    entries.push({
      sequence: sequenceNum ?? entries.length + 1,
      startTime,
      endTime,
      startMs,
      endMs,
      originalText,
      cleanText,
      speakerLabel,
      formattingTags,
      isSoundEffect,
      status: 'pending',
    });
  }

  if (entries.length === 0) {
    return {
      isValid: false,
      format: 'srt',
      entries: [],
      totalEntries: 0,
      detectedLanguage: 'en',
      detectedLanguageConfidence: 0,
      totalDurationSeconds: 0,
      speakerCount: 0,
      formattedEntryCount: 0,
      errors: errors.length > 0 ? errors : ['No valid subtitle blocks could be parsed from the uploaded SRT file.'],
      warnings,
    };
  }

  // Ensure sequence numbers are strictly unique across the file (handles merged 2-CD or forced+main SRT files)
  const seenSeqs = new Set<number>();
  let hasDuplicateSequences = false;
  for (const e of entries) {
    if (seenSeqs.has(e.sequence)) {
      hasDuplicateSequences = true;
      break;
    }
    seenSeqs.add(e.sequence);
  }
  if (hasDuplicateSequences) {
    warnings.push(
      `Detected duplicate sequence numbers in the uploaded SRT file; normalized sequence numbers sequentially (1–${entries.length}) so no entries are overwritten.`
    );
    for (let idx = 0; idx < entries.length; idx++) {
      entries[idx].sequence = idx + 1;
    }
  }

  // Detect language from a representative sample of entries
  const sampleText = entries
    .slice(0, Math.min(80, entries.length))
    .map((e) => e.cleanText)
    .join(' ');
  const langDetection = detectLanguageFromText(sampleText);

  const maxEndMs = entries.reduce((max, e) => Math.max(max, e.endMs), 0);

  return {
    isValid: true,
    format: 'srt',
    entries,
    totalEntries: entries.length,
    detectedLanguage: langDetection.code,
    detectedLanguageConfidence: langDetection.confidence,
    totalDurationSeconds: Math.round(maxEndMs / 1000),
    speakerCount: speakers.size,
    formattedEntryCount,
    errors,
    warnings,
  };
}

export const srtFormatParser: SubtitleFormatParser = {
  format: 'srt',
  extensions: ['.srt'],
  parse: parseSrtContent,
};
