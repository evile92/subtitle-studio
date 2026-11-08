import type { SubtitleEntry } from '@/types/subtitle';
import { applyArabicRtlBidiFix } from '@/lib/translation/arabic-engine';

export interface FormatSrtOptions {
  useBom?: boolean;                 // Prepend UTF-8 BOM (\uFEFF) for legacy media player compatibility
  bilingual?: boolean;              // Include both original and translated dialogue stacked
  lineEnding?: '\n' | '\r\n';       // Standard LF or Windows CRLF
  fallbackToOriginal?: boolean;     // If an entry has no translation yet, fallback to originalText
  fixArabicRtlBidi?: boolean;       // Anchor Arabic lines with Unicode RLM (\u200F) for video players (default: true)
}

/**
 * Generates a structurally valid SubRip (.srt) string from SubtitleEntry[].
 * Strictly preserves sequence numbers, exact original start/end timestamps, and entry order.
 * Automatically anchors Arabic lines with Unicode Right-to-Left Marks (\u200F) so punctuation
 * (..., ., !, ؟, -) displays on the correct RTL side in MPC-HC, VLC, PotPlayer, and TVs.
 */
export function formatSrtContent(
  entries: SubtitleEntry[],
  options: FormatSrtOptions = {}
): string {
  const {
    useBom = false,
    bilingual = false,
    lineEnding = '\n',
    fallbackToOriginal = true,
    fixArabicRtlBidi = true,
  } = options;

  const blocks = entries.map((entry) => {
    const seqLine = String(entry.sequence);
    const timeLine = `${entry.startTime} --> ${entry.endTime}`;

    let translated =
      entry.translatedText !== undefined && entry.translatedText.trim() !== ''
        ? entry.translatedText.trim()
        : fallbackToOriginal
          ? entry.originalText
          : '';

    if (fixArabicRtlBidi && /[\u0600-\u06FF]/.test(translated)) {
      translated = applyArabicRtlBidiFix(translated);
    }

    let dialogueBlock = translated;
    if (bilingual && entry.originalText.trim() !== translated.trim()) {
      dialogueBlock = `${translated}${lineEnding}${entry.originalText.trim()}`;
    }

    // Normalize internal line endings inside the dialogue block
    const normalizedDialogue = dialogueBlock
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .join(lineEnding);

    return `${seqLine}${lineEnding}${timeLine}${lineEnding}${normalizedDialogue}`;
  });

  const body = blocks.join(`${lineEnding}${lineEnding}`) + lineEnding;
  return useBom ? `\uFEFF${body}` : body;
}
