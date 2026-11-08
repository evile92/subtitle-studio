import type { SubtitleEntry, TranslationBatch } from '@/types/subtitle';

export interface ChunkerOptions {
  batchSize?: number;
  contextOverlapSize?: number;
}

/**
 * Stage C: Scene-Aware Intelligent Subtitle Chunker
 * Splits subtitle entries into translation batches with overlapping preceding & lookahead
 * contextual windows. Prefers splitting at natural timing pauses or sentence boundaries
 * so mid-sentence continuations are not awkwardly bisected.
 */
export function createContextualBatches(
  entries: SubtitleEntry[],
  options: ChunkerOptions = {}
): TranslationBatch[] {
  const targetBatchSize = Math.max(5, Math.min(100, options.batchSize || 35));
  const overlapSize = Math.max(2, Math.min(20, options.contextOverlapSize || 6));

  if (entries.length === 0) return [];

  const batchRanges: Array<{ startIdx: number; endIdx: number }> = [];
  let cursor = 0;

  while (cursor < entries.length) {
    let tentativeEnd = Math.min(cursor + targetBatchSize - 1, entries.length - 1);

    // If not at the end of the file, look for a natural pause or sentence end near tentativeEnd
    if (tentativeEnd < entries.length - 1 && targetBatchSize >= 10) {
      const searchWindowStart = Math.max(cursor + Math.floor(targetBatchSize * 0.75), cursor + 1);
      const searchWindowEnd = Math.min(
        cursor + Math.ceil(targetBatchSize * 1.15),
        entries.length - 1
      );

      let bestBreakIdx = tentativeEnd;
      let bestScore = -1;

      for (let idx = searchWindowStart; idx <= searchWindowEnd; idx++) {
        const current = entries[idx];
        const next = entries[idx + 1];
        if (!next) {
          bestBreakIdx = idx;
          break;
        }

        const timeGapMs = Math.max(0, next.startMs - current.endMs);
        const endsSentence = /[.!?؟…"'»)\]]$/.test(current.cleanText.trim());
        const continuesSentence = /[,،\-—…]$/.test(current.cleanText.trim()) || /^[a-z]/.test(next.cleanText.trim());

        let score = 0;
        if (timeGapMs >= 3000) score += 5; // Scene / conversation pause
        else if (timeGapMs >= 1200) score += 3;
        if (endsSentence) score += 3;
        if (continuesSentence) score -= 5; // Strongly avoid splitting mid-sentence

        if (score > bestScore) {
          bestScore = score;
          bestBreakIdx = idx;
        }
      }

      tentativeEnd = bestBreakIdx;
    }

    batchRanges.push({ startIdx: cursor, endIdx: tentativeEnd });
    cursor = tentativeEnd + 1;
  }

  const totalBatches = batchRanges.length;

  return batchRanges.map((range, batchIndex) => {
    const batchEntries = entries.slice(range.startIdx, range.endIdx + 1);
    const precedingStart = Math.max(0, range.startIdx - overlapSize);
    const precedingEntries = entries.slice(precedingStart, range.startIdx);

    const followingEnd = Math.min(entries.length, range.endIdx + 1 + overlapSize);
    const followingEntries = entries.slice(range.endIdx + 1, followingEnd);

    return {
      batchIndex,
      totalBatches,
      startSequence: batchEntries[0].sequence,
      endSequence: batchEntries[batchEntries.length - 1].sequence,
      entrySequences: batchEntries.map((e) => e.sequence),
      precedingContextSequences: precedingEntries.map((e) => e.sequence),
      followingContextSequences: followingEntries.map((e) => e.sequence),
      status: 'pending',
      attempts: 0,
    };
  });
}
