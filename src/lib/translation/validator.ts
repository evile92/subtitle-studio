import type {
  GlossaryItem,
  SubtitleEntry,
  ValidationIssue,
  ValidationReport,
} from '@/types/subtitle';
import { formatSrtContent } from '@/lib/srt/formatter';
import { extractFormattingTags, parseSrtContent, stripFormattingTags } from '@/lib/srt/parser';
import {
  normalizeArabicSubtitleText,
  preserveOuterFormattingTags,
} from './arabic-engine';

export interface ValidateAndRepairOptions {
  originalEntries: SubtitleEntry[];
  translatedEntries: SubtitleEntry[];
  glossary: GlossaryItem[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface ValidateAndRepairResult {
  repairedEntries: SubtitleEntry[];
  report: ValidationReport;
}

/**
 * 11-Point Translation Quality Assurance & Non-Destructive Automatic Repair Engine.
 */
export function validateAndRepairTranslations(
  options: ValidateAndRepairOptions
): ValidateAndRepairResult {
  const {
    originalEntries,
    translatedEntries,
    glossary,
    sourceLanguage,
    targetLanguage,
  } = options;

  const issues: ValidationIssue[] = [];
  const isArabicTarget = targetLanguage.toLowerCase() === 'ar';
  const sameLang = sourceLanguage.toLowerCase() === targetLanguage.toLowerCase();

  // Map translatedEntries by sequence, detecting duplicates (Check #2)
  const translatedBySeq = new Map<number, SubtitleEntry>();
  const seenSequences = new Set<number>();

  for (const entry of translatedEntries) {
    if (seenSequences.has(entry.sequence)) {
      issues.push({
        id: `dup-${entry.sequence}-${issues.length + 1}`,
        sequence: entry.sequence,
        type: 'duplicate_entry',
        severity: 'warning',
        message: `Subtitle #${entry.sequence}: Duplicate subtitle entry detected in translated output.`,
        autoRepaired: true,
        repairDescription: `Deduplicated entry #${entry.sequence} while keeping the primary translated block.`,
      });
      continue;
    }
    seenSequences.add(entry.sequence);
    translatedBySeq.set(entry.sequence, { ...entry });
  }

  const repairedEntries: SubtitleEntry[] = [];
  let formattingTagsTotalCount = 0;
  let formattingTagsPreservedCount = 0;
  let emptyTranslationsCount = 0;
  let untranslatedCount = 0;

  for (let idx = 0; idx < originalEntries.length; idx++) {
    const orig = originalEntries[idx];
    let candidate = translatedBySeq.get(orig.sequence);
    const entryWarnings: string[] = [];

    // Check #1: Missing subtitle entries
    if (!candidate) {
      // Check if an entry at the same positional index exists with a wrong sequence number (Check #3)
      const positionalCandidate = translatedEntries[idx];
      if (positionalCandidate && !seenSequences.has(orig.sequence)) {
        candidate = {
          ...orig,
          translatedText: positionalCandidate.translatedText,
          aiTranslatedText: positionalCandidate.aiTranslatedText,
        };
        issues.push({
          id: `seq-${orig.sequence}-${issues.length + 1}`,
          sequence: orig.sequence,
          type: 'sequence_mismatch',
          severity: 'warning',
          message: `Subtitle #${orig.sequence}: Sequence number was altered to ${positionalCandidate.sequence}.`,
          autoRepaired: true,
          repairDescription: `Restored original sequence number #${orig.sequence}.`,
        });
      } else {
        candidate = { ...orig };
        issues.push({
          id: `missing-${orig.sequence}-${issues.length + 1}`,
          sequence: orig.sequence,
          type: 'missing_entry',
          severity: 'error',
          message: `Subtitle #${orig.sequence}: Missing from translated entries.`,
          autoRepaired: false,
        });
      }
    }

    // Check #3: Sequence number verification
    if (candidate.sequence !== orig.sequence) {
      issues.push({
        id: `seq-fix-${orig.sequence}-${issues.length + 1}`,
        sequence: orig.sequence,
        type: 'sequence_mismatch',
        severity: 'warning',
        message: `Subtitle #${orig.sequence}: Sequence number mismatch (${candidate.sequence} vs ${orig.sequence}).`,
        autoRepaired: true,
        repairDescription: `Locked sequence number to original #${orig.sequence}.`,
      });
      candidate.sequence = orig.sequence;
    }

    // Check #4: Timestamp integrity verification
    if (candidate.startTime !== orig.startTime || candidate.endTime !== orig.endTime) {
      issues.push({
        id: `ts-${orig.sequence}-${issues.length + 1}`,
        sequence: orig.sequence,
        type: 'timestamp_modified',
        severity: 'warning',
        message: `Subtitle #${orig.sequence}: Timestamp modified (${candidate.startTime} --> ${candidate.endTime}).`,
        autoRepaired: true,
        repairDescription: `Restored original timestamp (${orig.startTime} --> ${orig.endTime}).`,
      });
      candidate.startTime = orig.startTime;
      candidate.endTime = orig.endTime;
      candidate.startMs = orig.startMs;
      candidate.endMs = orig.endMs;
    }

    let text = (candidate.translatedText ?? '').trim();

    // Check #5: Empty translations
    if (!text) {
      emptyTranslationsCount++;
      entryWarnings.push('Empty translation');
      issues.push({
        id: `empty-${orig.sequence}-${issues.length + 1}`,
        sequence: orig.sequence,
        type: 'empty_translation',
        severity: 'error',
        message: `Subtitle #${orig.sequence}: Translation is empty.`,
        autoRepaired: false,
      });
    } else {
      // Check #7: Broken formatting tags & automatic tag restoration
      const origTags = extractFormattingTags(orig.originalText);
      if (origTags.length > 0) {
        formattingTagsTotalCount++;
      }

      const beforeTagRepair = text;
      text = isArabicTarget
        ? normalizeArabicSubtitleText(text, orig.originalText)
        : preserveOuterFormattingTags(text, orig.originalText);

      const afterTags = extractFormattingTags(text);
      if (origTags.length > 0) {
        if (afterTags.length >= origTags.length) {
          formattingTagsPreservedCount++;
        }
        if (beforeTagRepair !== text) {
          issues.push({
            id: `tag-${orig.sequence}-${issues.length + 1}`,
            sequence: orig.sequence,
            type: 'broken_formatting_tags',
            severity: 'info',
            message: `Subtitle #${orig.sequence}: Formatting tags or punctuation differed from source structure.`,
            autoRepaired: true,
            repairDescription: `Normalized formatting tags and punctuation on subtitle #${orig.sequence}.`,
          });
        }
      }

      // Check #6: Untranslated source-language dialogue
      const cleanOrig = stripFormattingTags(orig.originalText).trim();
      const cleanTrans = stripFormattingTags(text).trim();
      const wordCount = cleanOrig.split(/\s+/).filter(Boolean).length;

      if (
        !sameLang &&
        !orig.isSoundEffect &&
        wordCount >= 2 &&
        cleanOrig.toLowerCase() === cleanTrans.toLowerCase() &&
        /[a-zA-Z]{3,}/.test(cleanOrig)
      ) {
        untranslatedCount++;
        entryWarnings.push('Untranslated source dialogue');
        issues.push({
          id: `untrans-${orig.sequence}-${issues.length + 1}`,
          sequence: orig.sequence,
          type: 'untranslated_dialogue',
          severity: 'warning',
          message: `Subtitle #${orig.sequence}: Translation appears identical to source-language dialogue ("${cleanOrig.slice(0, 50)}").`,
          autoRepaired: false,
        });
      }

      // Check #8 & #9: Character name & recurring terminology consistency against Glossary
      for (const gItem of glossary) {
        if (!gItem.sourceTerm || !gItem.targetTerm) continue;
        if (gItem.sourceTerm.length < 3) continue;

        const escapedSource = gItem.sourceTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startBoundary = /^[\p{L}\p{N}_]/u.test(gItem.sourceTerm)
          ? '(?<![\\p{L}\\p{N}_])'
          : '';
        const endBoundary = /[\p{L}\p{N}_]$/u.test(gItem.sourceTerm)
          ? '(?![\\p{L}\\p{N}_])'
          : '';
        const pattern = `${startBoundary}${escapedSource}${endBoundary}`;
        const sourceTestRegex = new RegExp(pattern, 'iu');
        const sourceReplaceRegex = new RegExp(pattern, 'giu');

        if (sourceTestRegex.test(cleanOrig)) {
          // If the source term was left untranslated in the target text when a different targetTerm exists
          if (
            gItem.sourceTerm.toLowerCase() !== gItem.targetTerm.toLowerCase() &&
            sourceTestRegex.test(text) &&
            !text.includes(gItem.targetTerm)
          ) {
            text = text.replace(sourceReplaceRegex, () => gItem.targetTerm);
            issues.push({
              id: `glossary-${orig.sequence}-${gItem.id}`,
              sequence: orig.sequence,
              type:
                gItem.category === 'character'
                  ? 'inconsistent_character_name'
                  : 'inconsistent_terminology',
              severity: 'info',
              message: `Subtitle #${orig.sequence}: Source term "${gItem.sourceTerm}" appeared instead of glossary term "${gItem.targetTerm}".`,
              autoRepaired: true,
              repairDescription: `Replaced "${gItem.sourceTerm}" with consistent glossary translation "${gItem.targetTerm}".`,
            });
          }
        }
      }

      // Check #10: Obvious language / punctuation or leftover English word check
      if (isArabicTarget && !orig.isSoundEffect) {
        const arabicChars = (cleanTrans.match(/[\u0600-\u06FF]/g) || []).length;
        const latinChars = (cleanTrans.match(/[A-Za-z]/g) || []).length;
        const leftoverLatinWords = cleanTrans.match(/[A-Za-z]{2,}/g) || [];

        if (arabicChars === 0 && latinChars > 4) {
          entryWarnings.push('Contains no Arabic script characters');
          issues.push({
            id: `lang-${orig.sequence}-${issues.length + 1}`,
            sequence: orig.sequence,
            type: 'language_or_punctuation_issue',
            severity: 'warning',
            message: `Subtitle #${orig.sequence}: Target language is Arabic, but the translated line contains no Arabic characters.`,
            autoRepaired: false,
          });
        } else if (arabicChars > 0 && leftoverLatinWords.length > 0) {
          entryWarnings.push(`Leftover English: ${leftoverLatinWords.slice(0, 3).join(', ')}`);
          issues.push({
            id: `latin-${orig.sequence}-${issues.length + 1}`,
            sequence: orig.sequence,
            type: 'language_or_punctuation_issue',
            severity: 'warning',
            message: `Subtitle #${orig.sequence}: Contains untranslated English/Latin text (${leftoverLatinWords.slice(0, 3).join(', ')}) inside Arabic translation.`,
            autoRepaired: false,
          });
        }
      }
    }

    repairedEntries.push({
      ...orig,
      translatedText: text,
      aiTranslatedText: candidate.aiTranslatedText || text,
      isEditedByUser: candidate.isEditedByUser || false,
      translationNotes: candidate.translationNotes,
      warnings: entryWarnings.length > 0 ? entryWarnings : undefined,
      status:
        entryWarnings.length > 0
          ? 'warning'
          : candidate.isEditedByUser
            ? 'edited'
            : 'translated',
    });
  }

  // Check #11: Final round-trip SRT structural comparison
  const exportedSrt = formatSrtContent(repairedEntries, { fallbackToOriginal: false });
  const roundTripParsed = parseSrtContent(exportedSrt, 'validated.srt');

  const countMatches = roundTripParsed.entries.length === originalEntries.length;
  const sequenceIntegrityMatch =
    countMatches &&
    repairedEntries.every((e, i) => e.sequence === originalEntries[i].sequence);
  const timestampIntegrityMatch =
    countMatches &&
    repairedEntries.every(
      (e, i) =>
        e.startTime === originalEntries[i].startTime &&
        e.endTime === originalEntries[i].endTime
    );
  const isValidSrtStructure =
    roundTripParsed.isValid &&
    countMatches &&
    sequenceIntegrityMatch &&
    timestampIntegrityMatch;

  if (!isValidSrtStructure) {
    issues.push({
      id: `srt-struct-${issues.length + 1}`,
      type: 'malformed_srt_structure',
      severity: 'error',
      message:
        'Round-trip SRT structural verification detected a mismatch between original and exported subtitle blocks.',
      autoRepaired: false,
    });
  }

  const autoRepairedCount = issues.filter((i) => i.autoRepaired).length;
  const unresolvedErrorsCount = issues.filter(
    (i) => !i.autoRepaired && i.severity === 'error'
  ).length;
  const unresolvedWarningsCount = issues.filter(
    (i) => !i.autoRepaired && i.severity === 'warning'
  ).length;

  const isFullyValidated =
    isValidSrtStructure &&
    unresolvedErrorsCount === 0 &&
    emptyTranslationsCount === 0 &&
    untranslatedCount === 0;

  // Compute an honest 0-100 quality score
  const totalCount = Math.max(1, originalEntries.length);
  const errorPenalty = (unresolvedErrorsCount / totalCount) * 100;
  const warningPenalty = (unresolvedWarningsCount / totalCount) * 40;
  const qualityScore = Math.max(
    0,
    Math.min(100, Math.round(100 - errorPenalty - warningPenalty))
  );

  const report: ValidationReport = {
    isValidSrtStructure,
    isFullyValidated,
    originalEntryCount: originalEntries.length,
    translatedEntryCount: repairedEntries.filter(
      (e) => e.translatedText && e.translatedText.trim().length > 0
    ).length,
    sequenceIntegrityMatch,
    timestampIntegrityMatch,
    formattingTagsPreservedCount,
    formattingTagsTotalCount,
    emptyTranslationsCount,
    untranslatedCount,
    autoRepairedCount,
    unresolvedErrorsCount,
    unresolvedWarningsCount,
    qualityScore,
    issues,
    validatedAt: new Date().toISOString(),
  };

  return {
    repairedEntries,
    report,
  };
}
