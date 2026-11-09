import type {
  ArabicDialect,
  GlobalContextProfile,
  GlossaryItem,
  SubtitleEntry,
  TranslationPreferencesConfig,
  TranslationStyle,
} from '@/types/subtitle';
import { getLanguageName } from '@/lib/languages';
import {
  buildArabicLinguisticInstructions,
  stripBidiControlChars,
} from './arabic-engine';

const STYLE_DESCRIPTIONS: Record<TranslationStyle, string> = {
  natural:
    'Natural and conversational: Prioritize authentic spoken dialogue that flows effortlessly on screen as real people speak.',
  professional:
    'Professional and polished: Crisp, broadcast-standard subtitle phrasing with clear diction and refined structure.',
  cinematic:
    'Cinematic and literary: Elevated dramatic phrasing, rich emotional resonance, and poetic cadence suited for prestige cinema.',
  informal:
    'Informal dialogue: Relaxed, everyday colloquial energy matching casual conversation among friends or street dialogue.',
  formal:
    'Formal dialogue: Respectful, structured, and dignified phrasing appropriate for historical, legal, diplomatic, or formal settings.',
};

export function buildBatchTranslationPrompts(params: {
  batchEntries: SubtitleEntry[];
  precedingEntries: SubtitleEntry[];
  followingEntries: SubtitleEntry[];
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  contextProfile?: GlobalContextProfile;
  glossary: GlossaryItem[];
}): { systemPrompt: string; userPrompt: string } {
  const {
    batchEntries,
    precedingEntries,
    followingEntries,
    sourceLanguage,
    targetLanguage,
    arabicDialect = 'msa',
    preferences,
    contextProfile,
    glossary,
  } = params;

  const sourceLangName = getLanguageName(sourceLanguage, 'en');
  const targetLangName = getLanguageName(targetLanguage, 'en');
  const isArabic = targetLanguage.toLowerCase() === 'ar';

  const preferenceRules: string[] = [];
  if (preferences.preserveMeaning) {
    preferenceRules.push('- Faithfully preserve the exact intended meaning and subtext of every line.');
  }
  if (preferences.prioritizeNaturalDialogue) {
    preferenceRules.push('- Prioritize natural, idiomatic spoken dialogue over mechanical word-for-word replacement.');
  }
  if (preferences.preserveHumorAndSarcasm) {
    preferenceRules.push('- Preserve humor, sarcasm, irony, wit, and emotional intensity so the target audience experiences the same reaction.');
  }
  if (preferences.translateIdiomsByMeaning) {
    preferenceRules.push('- Translate idioms, figures of speech, and proverbs by their intended meaning into natural target-language equivalents.');
  }
  if (preferences.preserveProfanity) {
    preferenceRules.push('- Translate strong language, insults, and profanity faithfully to match character intensity.');
  } else {
    preferenceRules.push('- Soften explicit profanity into clean yet emotionally fitting expressions.');
  }
  if (preferences.preserveCulturalReferences) {
    preferenceRules.push('- Preserve cultural references while making their meaning immediately clear to the target audience.');
  }
  if (preferences.maintainConsistentNames) {
    preferenceRules.push('- Strictly adhere to the Translation Glossary for all character names, locations, and recurring terms.');
  }
  if (preferences.customInstructions?.trim()) {
    preferenceRules.push(`- Custom Translator Directive: ${preferences.customInstructions.trim()}`);
  }

  const arabicSection = isArabic
    ? '\n\n' + buildArabicLinguisticInstructions(arabicDialect, preferences, contextProfile, glossary)
    : '';

  const contextSection = contextProfile
    ? `
=== GLOBAL STORYLINE & CONTEXT PROFILE ===
Storyline: ${contextProfile.subjectAndStoryline}
Narrative Context & Genre: ${contextProfile.narrativeContextAndGenre}
Overall Tone: ${contextProfile.overallTone}
Speech Patterns: ${contextProfile.speechPatternsSummary}
Key Plot Developments: ${contextProfile.plotDevelopments.join(' | ')}
${
  contextProfile.characters.length > 0
    ? `Characters:\n${contextProfile.characters
        .map(
          (c) =>
            `  * ${c.name} -> "${c.translatedName}" [${c.gender}, ${c.formalityLevel}]: ${c.role}. ${c.personalityAndTone}. Relationships: ${c.relationships}`
        )
        .join('\n')}`
    : ''
}
`
    : '';

  const glossarySection =
    glossary.length > 0
      ? `
=== PERSISTENT TRANSLATION GLOSSARY (MANDATORY CONSISTENCY) ===
${glossary
  .map(
    (g) =>
      `- "${g.sourceTerm}" => "${g.targetTerm}" [${g.category}${g.gender ? `, ${g.gender}` : ''}]${g.contextNotes ? ` (${g.contextNotes})` : ''}`
  )
  .join('\n')}
`
      : '';

  // Filter idioms/nuances relevant to this batch's sequence range
  const batchSeqSet = new Set(batchEntries.map((e) => e.sequence));
  const relevantNuances =
    contextProfile?.idiomsAndNuances.filter(
      (n) =>
        n.sequenceNumbers.some((seq) => batchSeqSet.has(seq)) ||
        batchEntries.some((e) =>
          e.cleanText.toLowerCase().includes(n.originalExpression.toLowerCase())
        )
    ) || [];

  const nuancesSection =
    relevantNuances.length > 0
      ? `
=== SCENE IDIOMS, SARCASM & NUANCE ALERTS IN THIS BATCH ===
${relevantNuances
  .map(
    (n) =>
      `- "${n.originalExpression}" (${n.type}): Intended meaning is "${n.intendedMeaning}". Strategy: ${n.recommendedTranslationStrategy}`
  )
  .join('\n')}
`
      : '';

  const systemPrompt = `You are a Master Audiovisual Subtitle Translator translating from ${sourceLangName} into ${targetLangName}.
Style Mode: ${STYLE_DESCRIPTIONS[preferences.style]}

 TRANSLATION PREFERENCES:
${preferenceRules.join('\n')}

CRITICAL SRT FORMATTING & INTEGRITY RULES:
1. You must translate EVERY single subtitle entry requested in "TARGET SUBTITLE BATCH TO TRANSLATE".
2. Never skip, merge, or reorder subtitle entries. Each sequence number must map 1-to-1 to its translated dialogue.
3. Preserve inline formatting tags such as <i>...</i>, <b>...</b>, <u>...</u>, and music symbols ♪ where present.
4. Preserve line breaks (\\n) for two-line subtitles when natural or when two speakers with "- " prefixes speak in the same entry.
5. Never include timestamps or sequence numbers inside the "translatedText" string itself.
6. Never add translator explanations or parenthetical notes that do not exist in the original subtitle.
${contextSection}${glossarySection}${nuancesSection}${arabicSection}

OUTPUT FORMAT:
Return ONLY a valid JSON object with the following structure (always fill "speakerToAddressee" BEFORE "translatedText" so verb/pronoun gender matches the exact speaker and addressee):
{
  "translations": [
    {
      "sequence": <exact integer sequence number>,
      "speakerToAddressee": "<Speaker(M/F) -> Addressee(M/F/Plural), e.g. 'Nikki(F) -> Bear(M)'>",
      "translatedText": "<localized subtitle text preserving any HTML/SRT formatting tags>"
    }
  ],
  "newGlossaryTerms": [
    {
      "sourceTerm": "<term>",
      "targetTerm": "<consistent translation>",
      "category": "character" | "location" | "organization" | "terminology" | "idiom" | "recurring_phrase"
    }
  ]
}`;

  const precedingText =
    precedingEntries.length > 0
      ? `=== PRECEDING DIALOGUE CONTEXT (DO NOT INCLUDE IN OUTPUT — FOR CONTINUITY ONLY) ===\n` +
        precedingEntries
          .map(
            (e) =>
              `[#${e.sequence}] Original: ${JSON.stringify(e.originalText)}${
                e.translatedText
                  ? ` | Already Translated: ${JSON.stringify(stripBidiControlChars(e.translatedText))}`
                  : ''
              }`
          )
          .join('\n') +
        '\n\n'
      : '';

  const followingText =
    followingEntries.length > 0
      ? `\n\n=== UPCOMING LOOKAHEAD DIALOGUE CONTEXT (DO NOT INCLUDE IN OUTPUT — FOR CONTINUITY ONLY) ===\n` +
        followingEntries
          .map((e) => `[#${e.sequence}] Original: ${JSON.stringify(e.originalText)}`)
          .join('\n')
      : '';

  const targetPayload = batchEntries.map((e) => ({
    sequence: e.sequence,
    speaker: e.speakerLabel || undefined,
    originalText: e.originalText,
  }));

  const userPrompt = `${precedingText}=== TARGET SUBTITLE BATCH TO TRANSLATE (Translate all ${batchEntries.length} entries below into ${targetLangName}) ===
${JSON.stringify(targetPayload, null, 2)}${followingText}

Return the JSON object with "translations" containing all ${batchEntries.length} entries mapped to their exact "sequence" numbers.`;

  return { systemPrompt, userPrompt };
}

export function buildSingleEntryRegeneratePrompts(params: {
  targetEntry: SubtitleEntry;
  surroundingBefore: SubtitleEntry[];
  surroundingAfter: SubtitleEntry[];
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  contextProfile?: GlobalContextProfile;
  glossary: GlossaryItem[];
  customInstruction?: string;
}): { systemPrompt: string; userPrompt: string } {
  const {
    targetEntry,
    surroundingBefore,
    surroundingAfter,
    sourceLanguage,
    targetLanguage,
    arabicDialect = 'msa',
    preferences,
    contextProfile,
    glossary,
    customInstruction,
  } = params;

  const sourceLangName = getLanguageName(sourceLanguage, 'en');
  const targetLangName = getLanguageName(targetLanguage, 'en');
  const isArabic = targetLanguage.toLowerCase() === 'ar';

  const arabicSection = isArabic
    ? '\n\n' + buildArabicLinguisticInstructions(arabicDialect, preferences, contextProfile, glossary)
    : '';

  const systemPrompt = `You are a Master Audiovisual Subtitle Translator refining a single subtitle line from ${sourceLangName} into ${targetLangName} using full scene context.
Style Mode: ${STYLE_DESCRIPTIONS[preferences.style]}
${contextProfile ? `\nStoryline Context: ${contextProfile.subjectAndStoryline}\nTone: ${contextProfile.overallTone}` : ''}
${arabicSection}

Return ONLY valid JSON:
{
  "sequence": ${targetEntry.sequence},
  "speakerToAddressee": "<Speaker(M/F) -> Addressee(M/F/Plural)>",
  "translatedText": "<natural localized subtitle text>",
  "alternatives": ["<alternative phrasing 1>", "<alternative phrasing 2>"],
  "reasoning": "<brief explanation of how context/tone was applied>"
}`;

  const beforeLines = surroundingBefore
    .map(
      (e) =>
        `[#${e.sequence}] Original: ${JSON.stringify(e.originalText)} | Translated: ${JSON.stringify(
          stripBidiControlChars(e.translatedText || '')
        )}`
    )
    .join('\n');

  const afterLines = surroundingAfter
    .map(
      (e) =>
        `[#${e.sequence}] Original: ${JSON.stringify(e.originalText)} | Translated: ${JSON.stringify(
          stripBidiControlChars(e.translatedText || '')
        )}`
    )
    .join('\n');

  const userPrompt = `=== PRECEDING SCENE LINES ===
${beforeLines || '(Start of file)'}

=== TARGET SUBTITLE ENTRY TO REGENERATE ===
Sequence: #${targetEntry.sequence}
Timestamp: ${targetEntry.startTime} --> ${targetEntry.endTime}
Original Text: ${JSON.stringify(targetEntry.originalText)}
Current Translation (to improve/replace): ${JSON.stringify(stripBidiControlChars(targetEntry.translatedText || ''))}
${customInstruction ? `User Instruction for this line: ${customInstruction}` : 'Provide a more natural, contextually accurate translation that fits the surrounding dialogue.'}

=== FOLLOWING SCENE LINES ===
${afterLines || '(End of file)'}

Return the JSON response.`;

  return { systemPrompt, userPrompt };
}
