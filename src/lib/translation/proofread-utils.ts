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
        if (/\b([\u0600-\u06FF]{2,})\s+\1\b/.test(cleanTrans)) {
          reasons.push('Duplicate consecutive word detected');
        }

        // 4. Check for awkward literal machine calques or common spelling errors
        if (
          /(يأخذ مكان|يصنع معنى|قطعة من الكعكة|هل تقوم بممازحتي|انشاء الله|ما اللعنة|بحق اللعنة|إثارة الدراما|تثير الدراما|أعدك بشدة|بهذه الطاقة|هذا اللعين|تلك اللعينة|تشفع لهذا|سأقدم استقالتي بعد أسبوعين|ضعفي الذي)/.test(
            cleanTrans
          )
        ) {
          reasons.push('Contains literal calque or unnatural Arabic phrasing');
        }

        // 5. Check for semantic confusion between modern slang, double-entendres, and sensory collocations
        if (/\bcringey?\b/i.test(cleanOrig) && /(مقزز|مقرف)/.test(cleanTrans)) {
          reasons.push("'Cringey' mistranslated as 'مقزز' instead of 'محرج / يثير الحرج'");
        }
        if (/\brock hard\b/i.test(cleanOrig) && /(متحمس|شغوف)/.test(cleanTrans)) {
          reasons.push("'Rock hard' comedic double-entendre sanitized/flattened to 'متحمس'");
        }
        if (/\bvulnerable\b/i.test(cleanOrig) && /(ضعف|ضعفي)/.test(cleanTrans)) {
          reasons.push("'Vulnerable' translated literally as weakness instead of emotional openness ('كشفت لك نفسي / فتحت لك قلبي')");
        }
        if (/\bstale\b/i.test(cleanOrig) && /(قديم|قديمة)/.test(cleanTrans)) {
          reasons.push("'Stale' food adjective translated as 'قديم' instead of 'بايت / غير طازج'");
        }
        if (/\bcasual\b/i.test(cleanOrig) && /(سطحي|سطحية)/.test(cleanTrans)) {
          reasons.push("'Casual' relationship translated as 'سطحية' instead of 'غير جدية / غير ملزمة'");
        }

        // 6. Check for high-risk English idioms/slang that require contextual subtext verification
        if (
          /\b(putting in my two weeks|two weeks'?\s*notice|wasted|hooking up|hooked up|hook up|tease her|tease him|makes up for that shit|seizure|super promise|rock hard|cringey|vulnerable|stale|super casual)\b/i.test(
            cleanOrig
          )
        ) {
          reasons.push('Contains colloquial idiom/slang/innuendo requiring contextual subtext verification');
        }

        // 7. Check for dual-speaker turn switches ("- ") or direct second-person address prone to speaker/addressee gender reversal
        if (
          (cleanOrig.includes('- ') && /\b(tell me|you want|can I do|with me)\b/i.test(cleanOrig)) ||
          /(أخبريني|تريدينني)/.test(cleanTrans)
        ) {
          reasons.push('Verify speaker-to-addressee gender agreement (التذكير والتأنيث للمخاطب)');
        }
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
