import type { SubtitleEntry } from '@/types/subtitle';
import { stripFormattingTags } from '@/lib/srt/parser';
import { stripBidiControlChars } from './arabic-engine';

export interface ProofreadChangeItem {
  sequence: number;
  originalText: string;
  previousTranslation: string;
  revisedTranslation: string;
  reason: string;
}

export interface ProofreadResultSummary {
  scopeUsed: 'smart' | 'all';
  totalEntriesInJob: number;
  reviewedCount: number;
  correctedCount: number;
  remainingEnglishCount: number;
  changes: ProofreadChangeItem[];
}

function hasUnbalancedBrackets(text: string): boolean {
  let roundBalance = 0;
  let squareBalance = 0;
  for (const ch of text) {
    if (ch === '(') roundBalance += 1;
    else if (ch === ')') roundBalance -= 1;
    else if (ch === '[') squareBalance += 1;
    else if (ch === ']') squareBalance -= 1;
    if (roundBalance < 0 || squareBalance < 0) return true;
  }
  return roundBalance !== 0 || squareBalance !== 0;
}

function hasCollapsedSpeakerTurns(orig: string, trans: string): boolean {
  const origTurns = orig
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s+\S/.test(line)).length;
  if (origTurns < 2) return false;
  const transTurns = trans
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s*\S/.test(line)).length;
  return transTurns < 2;
}

/**
 * Strips formatting tags (`<i>`, `<b>`, `{\an8}`) and invisible BiDi characters
 * and checks if any 2+ letter Latin/English words remain in the translated text.
 */
export function extractResidualLatinWords(text: string): string[] {
  if (!text) return [];
  const clean = stripFormattingTags(stripBidiControlChars(text));
  return clean.match(/[A-Za-z]{2,}/g) || [];
}

/**
 * Scans all subtitle entries in a job to identify lines that have:
 * 1. Leftover English/Latin words inside an Arabic (or non-Latin) translation
 * 2. Untranslated or empty translations
 * 3. Active QA warnings
 * 4. Common grammatical/orthographic red flags (duplicate consecutive words, literal machine calques, broken brackets)
 */
export function detectEntriesNeedingProofread(
  entries: SubtitleEntry[],
  targetLanguage: string
): {
  sequences: number[];
  reasonsBySequence: Record<number, string[]>;
} {
  const isArabic = targetLanguage.toLowerCase() === 'ar';
  const sequences: number[] = [];
  const reasonsBySequence: Record<number, string[]> = {};

  for (const entry of entries) {
    if (entry.isSoundEffect) continue;

    const reasons: string[] = [];
    const rawTrans = stripBidiControlChars(entry.translatedText || '').trim();
    const cleanTrans = stripFormattingTags(rawTrans).trim();
    const cleanOrig = stripFormattingTags(entry.originalText || '').trim();

    if (!cleanTrans) {
      reasons.push('Empty translation');
    } else {
      // 1. Check for identical untranslated text
      if (
        cleanOrig.length > 3 &&
        cleanTrans.toLowerCase() === cleanOrig.toLowerCase() &&
        /[A-Za-z]{3,}/.test(cleanOrig)
      ) {
        reasons.push('Line left untranslated in source language');
      }

      // 2. Check for leftover English/Latin words inside Arabic translation
      if (isArabic) {
        const latinWords = extractResidualLatinWords(rawTrans);
        if (latinWords.length > 0) {
          reasons.push(
            `Contains leftover English word(s): ${latinWords.slice(0, 4).join(', ')}`
          );
        }

        // 3. Check for duplicate consecutive Arabic words (e.g. "في في", "من من", "هذا هذا")
        if (/(?<![\p{L}\p{N}\p{M}_])([\u0600-\u06FF]{2,})\s+\1(?![\p{L}\p{N}\p{M}_])/u.test(cleanTrans)) {
          reasons.push('Duplicate consecutive word detected');
        }

        // 4. Check for common spelling, defective-verb, or literal machine calque errors
        if (
          /(?:انشاء\s+الله|يأخذ مكان|يصنع معنى|قطعة من الكعكة|هل تقوم بممازحتي)|(?<![\p{L}\p{N}\p{M}_])(?:لاكن|هاذ[اه]|اللذ[ين]|اللتي|[يتن]محي)(?![\p{L}\p{N}\p{M}_])/u.test(
            cleanTrans
          )
        ) {
          reasons.push('Contains literal machine calque or common Arabic spelling mistake');
        }

        // 5. Check for archaic vocatives or high-signal literal idiom misses against source
        if (
          /\b(?:man|dude|bro|pal|buddy)\b/i.test(cleanOrig) &&
          /(?<![\p{L}\p{N}\p{M}_])يا\s+هذا(?![\p{L}\p{N}\p{M}_])/u.test(cleanTrans)
        ) {
          reasons.push('Stiff archaic vocative ("يا هذا") used for casual dialogue');
        }
        if (
          (/\bheaven\s+knows\b/i.test(cleanOrig) && /السماء\s+تعلم/u.test(cleanTrans)) ||
          (/\bwith\s+one\s+accord\b/i.test(cleanOrig) && /بكلمة\s+واحدة\s+متفقة/u.test(cleanTrans))
        ) {
          reasons.push('Literal idiom or lyric translation detected');
        }
        if (
          /\bnever\b.*\bagain\b/i.test(cleanOrig) &&
          /(?<![\p{L}\p{N}\p{M}_])أبد(?:\u064bا|ا\u064b?)(?![\p{L}\p{N}\p{M}_])/u.test(cleanTrans) &&
          !/(?:مجدد(?:\u064bا|ا\u064b?)|ثانية\u064b?|مرة\s+أخرى|من\s+جديد)/u.test(cleanTrans)
        ) {
          reasons.push('Missing repetition adverb ("again") in "never ... again" phrasing');
        }

        // 6. Check for unbalanced brackets or collapsed multi-speaker dash dialogue turns
        if (hasUnbalancedBrackets(cleanTrans)) {
          reasons.push('Unbalanced parentheses or square brackets detected');
        }
        if (hasCollapsedSpeakerTurns(cleanOrig, cleanTrans)) {
          reasons.push('Multi-speaker dialogue dash markers collapsed or missing');
        }
      } else if (hasUnbalancedBrackets(cleanTrans)) {
        reasons.push('Unbalanced parentheses or square brackets detected');
      }
    }

    // 8. Include any entry flagged by the 11-point QA validator
    if (
      (entry.warnings && entry.warnings.length > 0) ||
      entry.status === 'warning'
    ) {
      for (const w of entry.warnings || []) {
        if (!reasons.includes(w)) {
          reasons.push(w);
        }
      }
    }

    if (reasons.length > 0) {
      sequences.push(entry.sequence);
      reasonsBySequence[entry.sequence] = reasons;
    }
  }

  return { sequences, reasonsBySequence };
}
