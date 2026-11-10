import { z } from 'zod';
import type {
  ArabicDialect,
  GlobalContextProfile,
  GlossaryItem,
  SubtitleEntry,
  TranslationPreferencesConfig,
} from '@/types/subtitle';
import type { AIProviderAdapter } from '@/lib/ai/types';
import { getArabicDialectOption, getLanguageName } from '@/lib/languages';

export const MAX_ENTRIES_PER_ANALYSIS_PASS = 350;

/**
 * Helper to coerce sequence numbers from numbers or strings like "#4", "4", "4, 5" into number[]
 */
function normalizeSequenceNumbers(val: unknown): number[] {
  if (typeof val === 'number' && !isNaN(val)) return [val];
  if (typeof val === 'string') {
    const matches = val.match(/\d+/g);
    return matches ? matches.map((m) => parseInt(m, 10)).filter((n) => !isNaN(n)) : [];
  }
  if (Array.isArray(val)) {
    const nums: number[] = [];
    for (const item of val) {
      if (typeof item === 'number' && !isNaN(item)) {
        nums.push(item);
      } else if (typeof item === 'string') {
        const matches = item.match(/\d+/g);
        if (matches) {
          for (const m of matches) {
            const parsed = parseInt(m, 10);
            if (!isNaN(parsed)) nums.push(parsed);
          }
        }
      }
    }
    return nums;
  }
  return [];
}

/**
 * Helper to normalize glossary items whether the model used sourceTerm/targetTerm
 * or alternative keys like term/translation, original/translated, source/target, etc.
 */
export function normalizeGlossaryArray(val: unknown): Array<{
  sourceTerm: string;
  targetTerm: string;
  category?: string;
  gender?: string;
  contextNotes?: string;
}> {
  if (!val) return [];

  // If the model returned a key-value map e.g. { "Elena": "إيلينا", "Project Horizon": "مشروع الأفق" }
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => ({
        sourceTerm: k.trim(),
        targetTerm: typeof v === 'string' ? v.trim() : String(v ?? ''),
        category: 'terminology',
      }))
      .filter((item) => item.sourceTerm.length > 0 && item.targetTerm.length > 0);
  }

  if (!Array.isArray(val)) return [];

  const result: Array<{
    sourceTerm: string;
    targetTerm: string;
    category?: string;
    gender?: string;
    contextNotes?: string;
  }> = [];

  for (const raw of val) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;

    const sourceCandidate =
      obj.sourceTerm ??
      obj.term ??
      obj.original ??
      obj.source ??
      obj.originalTerm ??
      obj.name ??
      obj.word ??
      obj.phrase ??
      obj.english;

    const targetCandidate =
      obj.targetTerm ??
      obj.translation ??
      obj.translated ??
      obj.target ??
      obj.translatedTerm ??
      obj.arabic ??
      obj.localized ??
      obj.meaning ??
      obj.equivalent;

    const sourceTerm = typeof sourceCandidate === 'string' ? sourceCandidate.trim() : '';
    const targetTerm = typeof targetCandidate === 'string' ? targetCandidate.trim() : '';

    if (!sourceTerm || !targetTerm) continue;

    result.push({
      sourceTerm,
      targetTerm,
      category: typeof obj.category === 'string' ? obj.category : typeof obj.type === 'string' ? obj.type : 'terminology',
      gender: typeof obj.gender === 'string' ? obj.gender : undefined,
      contextNotes:
        typeof obj.contextNotes === 'string'
          ? obj.contextNotes
          : typeof obj.notes === 'string'
            ? obj.notes
            : undefined,
    });
  }

  return result;
}

const NormalizedCharacterSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  return {
    name: String(obj.name ?? obj.originalName ?? obj.character ?? 'Unknown'),
    translatedName: String(
      obj.translatedName ?? obj.localizedName ?? obj.arabicName ?? obj.translation ?? obj.name ?? 'Unknown'
    ),
    gender: String(obj.gender ?? 'unknown').toLowerCase(),
    role: String(obj.role ?? obj.description ?? 'Character'),
    personalityAndTone: String(
      obj.personalityAndTone ?? obj.personality ?? obj.speakingStyle ?? obj.tone ?? 'Natural'
    ),
    formalityLevel: String(obj.formalityLevel ?? obj.formality ?? 'mixed').toLowerCase(),
    relationships: String(obj.relationships ?? obj.relationship ?? 'None specified'),
  };
}, z.object({
  name: z.string(),
  translatedName: z.string(),
  gender: z.enum(['male', 'female', 'unknown', 'non-binary']).catch('unknown'),
  role: z.string().default('Character'),
  personalityAndTone: z.string().default('Natural'),
  formalityLevel: z.enum(['formal', 'informal', 'mixed']).catch('mixed'),
  relationships: z.string().default(''),
}));

const NormalizedIdiomSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  return {
    sequenceNumbers: normalizeSequenceNumbers(
      obj.sequenceNumbers ?? obj.sequences ?? obj.sequence ?? obj.lineNumbers ?? []
    ),
    originalExpression: String(
      obj.originalExpression ?? obj.expression ?? obj.phrase ?? obj.original ?? ''
    ),
    type: String(obj.type ?? obj.category ?? 'idiom').toLowerCase(),
    intendedMeaning: String(obj.intendedMeaning ?? obj.meaning ?? obj.explanation ?? ''),
    recommendedTranslationStrategy: String(
      obj.recommendedTranslationStrategy ??
        obj.strategy ??
        obj.translation ??
        obj.recommendedTranslation ??
        ''
    ),
  };
}, z.object({
  sequenceNumbers: z.array(z.number()).default([]),
  originalExpression: z.string(),
  type: z
    .enum([
      'idiom',
      'sarcasm',
      'joke',
      'slang',
      'cultural_reference',
      'emotional_shift',
      'rhetorical_question',
    ])
    .catch('idiom'),
  intendedMeaning: z.string().default(''),
  recommendedTranslationStrategy: z.string().default(''),
}));

const NormalizedGlossaryItemSchema = z.object({
  sourceTerm: z.string(),
  targetTerm: z.string(),
  category: z
    .enum([
      'character',
      'location',
      'organization',
      'terminology',
      'idiom',
      'recurring_phrase',
    ])
    .catch('terminology'),
  gender: z.enum(['male', 'female', 'neutral', 'plural']).optional().catch(undefined),
  contextNotes: z.string().optional(),
});

const ContextAnalysisResponseSchema = z.object({
  detectedSourceLanguageCode: z.string().optional(),
  subjectAndStoryline: z.string().default(''),
  narrativeContextAndGenre: z.string().default(''),
  overallTone: z.string().default(''),
  speechPatternsSummary: z.string().default(''),
  plotDevelopments: z.preprocess((val) => {
    if (!Array.isArray(val)) return [];
    return val.map((item) =>
      typeof item === 'string'
        ? item
        : typeof item === 'object' && item !== null
          ? JSON.stringify(item)
          : String(item)
    );
  }, z.array(z.string()).default([])),
  arabicLocalizationGuidance: z.string().optional(),
  characters: z.preprocess(
    (val) => (Array.isArray(val) ? val : []),
    z.array(NormalizedCharacterSchema).default([])
  ),
  idiomsAndNuances: z.preprocess(
    (val) => (Array.isArray(val) ? val : []),
    z.array(NormalizedIdiomSchema).default([])
  ),
  glossary: z.preprocess(
    normalizeGlossaryArray,
    z.array(NormalizedGlossaryItemSchema).default([])
  ),
});

export type ContextAnalysisResponse = z.infer<typeof ContextAnalysisResponseSchema>;

function formatTranscriptSegment(entries: SubtitleEntry[]): string {
  return entries
    .map((e) => {
      const speakerPrefix = e.speakerLabel ? `[Speaker: ${e.speakerLabel}] ` : '';
      const compactTime = e.startTime.split(',')[0];
      return `[#${e.sequence} @ ${compactTime}] ${speakerPrefix}${e.cleanText.replace(/\r?\n/g, ' / ')}`;
    })
    .join('\n');
}

function buildAnalysisSystemPrompt(params: {
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
}): { systemPrompt: string; targetLangName: string; dialectInfo: ReturnType<typeof getArabicDialectOption> | null } {
  const { sourceLanguage, targetLanguage, arabicDialect = 'msa', preferences } = params;
  const targetLangName = getLanguageName(targetLanguage, 'en');
  const sourceLangName =
    sourceLanguage === 'auto' ? 'Auto-detected original language' : getLanguageName(sourceLanguage, 'en');
  const isArabicTarget = targetLanguage.toLowerCase() === 'ar';
  const dialectInfo = isArabicTarget ? getArabicDialectOption(arabicDialect) : null;

  const systemPrompt = `You are a Chief Audiovisual Script Analyst and Localization Director.
Your job is to read the subtitle script and produce a comprehensive JSON Global Context Profile and Persistent Translation Glossary before translation begins.

Target Language: ${targetLangName}${dialectInfo ? ` (${dialectInfo.nameEn} - ${dialectInfo.nativeLabel})` : ''}
Source Language: ${sourceLangName}
Requested Style: ${preferences.style}

CRITICAL EXTRACTION PRIORITIES:
1. CHARACTER GENDERS & RELATIONSHIPS: Identify EVERY named or recurring character's exact gender ("male" or "female") and how they relate to others (romantic partners, casual/physical fling vs emotional dating, coworkers, family, rivals). This is vital for Arabic masculine/feminine verb and pronoun conjugation (التذكير والتأنيث).
2. COLLOQUIAL IDIOMS, SLANG, DOUBLE-ENTENDRES & SUBTEXT: Identify:
   - Workplace idioms (e.g. "putting in my two weeks").
   - Intoxication/party slang ("wasted").
   - Relationship nature & physical subtext ("hooking up on and off", "super casual and not romantic").
   - Adult double-entendres & raunchy humor (e.g. "rock hard, thinking about trivia" — identify the comedic innuendo so it is NOT sanitized into innocent enthusiasm).
   - Modern slang with subtle distinctions ("cringey" = embarrassing/socially awkward, distinct from "gross" = disgusting).
   - Food/sensory collocations ("stale" = بايت / غير طازج, not generic old).
   - Emotional vulnerability ("vulnerable" = opening up / exposing feelings, not literal weakness).
   Record each in "idiomsAndNuances" with its exact "sequenceNumbers" and recommended natural localization strategy (never literal word-for-word calques).

Respond ONLY with a valid JSON object matching this EXACT structure and key names:
{
  "detectedSourceLanguageCode": "en",
  "subjectAndStoryline": "Detailed summary of the storyline, core conflict, and setting",
  "narrativeContextAndGenre": "Genre, dramatic/comedic context, and tone",
  "overallTone": "Emotional atmosphere and dialogue pacing",
  "speechPatternsSummary": "Formal vs informal speech dynamics, register shifts, and character dynamics",
  "plotDevelopments": ["Plot point 1", "Plot point 2"],
  "arabicLocalizationGuidance": "Specific grammatical, speaker-to-addressee gender-agreement (تذكير وتأنيث), and subtext guidance",
  "characters": [
    {
      "name": "Original name in script",
      "translatedName": "Consistent localized name in ${targetLangName}",
      "gender": "male | female | unknown | non-binary",
      "role": "Character's role in the story",
      "personalityAndTone": "Speaking style, temperament, vocabulary",
      "formalityLevel": "formal | informal | mixed",
      "relationships": "Exact relationship to other characters (and who they usually address)"
    }
  ],
  "idiomsAndNuances": [
    {
      "sequenceNumbers": [4, 8],
      "originalExpression": "Exact idiom, slang, joke, or sarcastic phrase from script",
      "type": "idiom | sarcasm | joke | slang | cultural_reference | emotional_shift | rhetorical_question",
      "intendedMeaning": "What the speaker actually means in context",
      "recommendedTranslationStrategy": "Recommended natural localization in ${targetLangName}"
    }
  ],
  "glossary": [
    {
      "sourceTerm": "Original name, place, organization, or recurring term",
      "targetTerm": "Exact consistent translation in ${targetLangName}",
      "category": "character | location | organization | terminology | idiom | recurring_phrase",
      "gender": "male | female | neutral | plural",
      "contextNotes": "Brief usage note"
    }
  ]
}

IMPORTANT:
- "sequenceNumbers" inside "idiomsAndNuances" MUST be an array of plain integers (e.g. [4, 8]), NOT strings like ["#4"].
- Each item in "glossary" MUST use the exact keys "sourceTerm" and "targetTerm".`;

  return { systemPrompt, targetLangName, dialectInfo };
}

/**
 * Deterministically merges characters, idioms/nuances, and glossary items from all segment
 * analyses into the synthesized response so no segment-specific discovery is ever lost.
 */
function mergePartialAnalysesIntoSynthesized(
  synthesized: ContextAnalysisResponse,
  partials: ContextAnalysisResponse[]
): ContextAnalysisResponse {
  const charMap = new Map<string, ContextAnalysisResponse['characters'][number]>();
  for (const c of synthesized.characters) {
    if (c.name) charMap.set(c.name.trim().toLowerCase(), c);
  }
  for (const p of partials) {
    for (const c of p.characters) {
      if (!c.name) continue;
      const key = c.name.trim().toLowerCase();
      const existing = charMap.get(key);
      if (!existing) {
        charMap.set(key, c);
      } else if (existing.gender === 'unknown' && (c.gender === 'male' || c.gender === 'female')) {
        charMap.set(key, { ...existing, gender: c.gender });
      }
    }
  }

  const idiomMap = new Map<string, ContextAnalysisResponse['idiomsAndNuances'][number]>();
  for (const item of [...synthesized.idiomsAndNuances, ...partials.flatMap((p) => p.idiomsAndNuances)]) {
    if (!item.originalExpression) continue;
    const key = item.originalExpression.trim().toLowerCase();
    const existing = idiomMap.get(key);
    if (!existing) {
      idiomMap.set(key, item);
    } else {
      const mergedSeqs = Array.from(new Set([...existing.sequenceNumbers, ...item.sequenceNumbers])).sort(
        (a, b) => a - b
      );
      idiomMap.set(key, { ...existing, sequenceNumbers: mergedSeqs });
    }
  }

  const glossaryList = [...synthesized.glossary, ...partials.flatMap((p) => p.glossary)];
  const plotList = Array.from(
    new Set([...synthesized.plotDevelopments, ...partials.flatMap((p) => p.plotDevelopments)])
  ).slice(0, 20);

  return {
    ...synthesized,
    characters: Array.from(charMap.values()),
    idiomsAndNuances: Array.from(idiomMap.values()),
    glossary: glossaryList,
    plotDevelopments: plotList,
  };
}

/**
 * Stateless helper for analyzing a single segment of up to 350 subtitle entries.
 * Used by the client-orchestrated multi-pass pipeline so 100% of long films (e.g. 1690 entries)
 * are analyzed without hitting serverless function timeouts.
 */
export async function analyzeSubtitleSegmentStateless(params: {
  segmentEntries: SubtitleEntry[];
  segmentIndex: number;
  totalSegments: number;
  totalEntriesInFile: number;
  previousStoryline?: string;
  previousCharactersSummary?: string;
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  aiAdapter: AIProviderAdapter;
}): Promise<{
  partialAnalysis: ContextAnalysisResponse;
  contextProfile: GlobalContextProfile;
  glossary: GlossaryItem[];
  detectedSourceLanguage?: string;
}> {
  const {
    segmentEntries,
    segmentIndex,
    totalSegments,
    totalEntriesInFile,
    previousStoryline,
    previousCharactersSummary,
    sourceLanguage,
    targetLanguage,
    arabicDialect = 'msa',
    preferences,
    aiAdapter,
  } = params;

  const { systemPrompt, targetLangName, dialectInfo } = buildAnalysisSystemPrompt({
    sourceLanguage,
    targetLanguage,
    arabicDialect,
    preferences,
  });

  const firstSeq = segmentEntries[0]?.sequence ?? 1;
  const lastSeq = segmentEntries[segmentEntries.length - 1]?.sequence ?? segmentEntries.length;
  const transcript = formatTranscriptSegment(segmentEntries);

  const userPrompt =
    totalSegments === 1
      ? `Analyze the following complete subtitle file (${segmentEntries.length} entries, from #${firstSeq} to #${lastSeq}) for translation into ${targetLangName}${dialectInfo ? ` (${dialectInfo.nameEn})` : ''}:

=== COMPLETE SUBTITLE TRANSCRIPT ===
${transcript}
=== END OF TRANSCRIPT ===

Return the complete JSON analysis.`
      : `Analyze Act/Segment ${segmentIndex + 1} of ${totalSegments} (entries #${firstSeq} to #${lastSeq} out of ${totalEntriesInFile} total entries) for translation into ${targetLangName}${dialectInfo ? ` (${dialectInfo.nameEn})` : ''}.
${
  previousStoryline || previousCharactersSummary
    ? `\nPreviously discovered storyline & characters so far:\n${previousStoryline ? `Storyline: ${previousStoryline}\n` : ''}${previousCharactersSummary ? `Characters: ${previousCharactersSummary}\n` : ''}`
    : ''
}
=== SEGMENT TRANSCRIPT (#${firstSeq} - #${lastSeq}) ===
${transcript}
=== END OF SEGMENT ===

Return the JSON analysis for this segment.`;

  const { data } = await aiAdapter.generateStructured(
    {
      systemPrompt,
      userPrompt,
      temperature: 0.2,
    },
    ContextAnalysisResponseSchema
  );

  const built = buildFinalContextOutput(data, totalEntriesInFile, totalSegments);
  return {
    partialAnalysis: data,
    ...built,
  };
}

/**
 * Stateless helper to synthesize multiple segment analyses into a single unified
 * GlobalContextProfile and Glossary covering 100% of the subtitle script.
 */
export async function synthesizeSegmentAnalysesStateless(params: {
  partialAnalyses: unknown[];
  totalEntriesInFile: number;
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  aiAdapter: AIProviderAdapter;
}): Promise<{
  contextProfile: GlobalContextProfile;
  glossary: GlossaryItem[];
  detectedSourceLanguage?: string;
}> {
  const {
    partialAnalyses,
    totalEntriesInFile,
    sourceLanguage,
    targetLanguage,
    arabicDialect = 'msa',
    preferences,
    aiAdapter,
  } = params;

  const validatedPartials = partialAnalyses.map((p) => ContextAnalysisResponseSchema.parse(p));
  if (validatedPartials.length === 1) {
    return buildFinalContextOutput(validatedPartials[0], totalEntriesInFile, 1);
  }

  const { systemPrompt, targetLangName } = buildAnalysisSystemPrompt({
    sourceLanguage,
    targetLanguage,
    arabicDialect,
    preferences,
  });

  const synthesisPrompt = `Synthesize the following ${validatedPartials.length} sequential segment analyses covering all ${totalEntriesInFile} subtitle entries of the film/episode into one unified master Global Context Profile and deduplicated Persistent Translation Glossary for ${targetLangName}:

${JSON.stringify(validatedPartials, null, 2)}

Ensure every character (with their exact gender and relationships), plot turn, idiom/slang/sarcasm discovery, and glossary term is unified and consistent from beginning to end. Return valid JSON.`;

  const { data: synthesized } = await aiAdapter.generateStructured(
    {
      systemPrompt,
      userPrompt: synthesisPrompt,
      temperature: 0.15,
    },
    ContextAnalysisResponseSchema
  );

  const merged = mergePartialAnalysesIntoSynthesized(synthesized, validatedPartials);
  return buildFinalContextOutput(merged, totalEntriesInFile, validatedPartials.length + 1);
}

/**
 * Stage B: Global Context Analysis
 * Analyzes 100% of subtitle entries in the file before translation begins.
 * Uses single-pass full analysis for standard scripts and multi-pass hierarchical analysis
 * for long feature films so every single subtitle entry is included in the analysis.
 */
export async function analyzeFullSubtitleContext(params: {
  entries: SubtitleEntry[];
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  aiAdapter: AIProviderAdapter;
  onProgress?: (message: string, pass: number, totalPasses: number) => void;
  singlePassFastMode?: boolean;
}): Promise<{
  contextProfile: GlobalContextProfile;
  glossary: GlossaryItem[];
  detectedSourceLanguage?: string;
}> {
  const {
    entries,
    sourceLanguage,
    targetLanguage,
    arabicDialect = 'msa',
    preferences,
    aiAdapter,
    onProgress,
    singlePassFastMode = false,
  } = params;

  const { systemPrompt, targetLangName, dialectInfo } = buildAnalysisSystemPrompt({
    sourceLanguage,
    targetLanguage,
    arabicDialect,
    preferences,
  });

  // Split entries into segments if the file is very large so 100% of entries are read without truncation
  const segments: SubtitleEntry[][] = [];
  if (singlePassFastMode && entries.length > MAX_ENTRIES_PER_ANALYSIS_PASS) {
    const step = entries.length / MAX_ENTRIES_PER_ANALYSIS_PASS;
    const sampled: SubtitleEntry[] = [];
    const pickedSeq = new Set<number>();
    for (let i = 0; i < MAX_ENTRIES_PER_ANALYSIS_PASS; i++) {
      const idx = Math.min(entries.length - 1, Math.floor(i * step));
      const entry = entries[idx];
      if (entry && !pickedSeq.has(entry.sequence)) {
        sampled.push(entry);
        pickedSeq.add(entry.sequence);
      }
    }
    segments.push(sampled);
  } else {
    for (let i = 0; i < entries.length; i += MAX_ENTRIES_PER_ANALYSIS_PASS) {
      segments.push(entries.slice(i, i + MAX_ENTRIES_PER_ANALYSIS_PASS));
    }
  }

  if (segments.length === 1) {
    onProgress?.(
      `Analyzing complete script (${entries.length} subtitle entries) in a single full-context pass...`,
      1,
      1
    );

    const transcript = formatTranscriptSegment(segments[0]);
    const userPrompt = `Analyze the following complete subtitle file (${entries.length} entries, from #${entries[0]?.sequence} to #${entries[entries.length - 1]?.sequence}) for translation into ${targetLangName}${dialectInfo ? ` (${dialectInfo.nameEn})` : ''}:

=== COMPLETE SUBTITLE TRANSCRIPT ===
${transcript}
=== END OF TRANSCRIPT ===

Return the complete JSON analysis.`;

    const { data } = await aiAdapter.generateStructured(
      {
        systemPrompt,
        userPrompt,
        temperature: 0.2,
      },
      ContextAnalysisResponseSchema
    );

    return buildFinalContextOutput(data, entries.length, 1);
  }

  // Multi-pass hierarchical full-file analysis for long feature films / long episodes
  const partialAnalyses: ContextAnalysisResponse[] = [];
  const totalPasses = segments.length + 1;

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const firstSeq = seg[0].sequence;
    const lastSeq = seg[seg.length - 1].sequence;

    onProgress?.(
      `Analyzing script segment ${idx + 1} of ${segments.length} (entries #${firstSeq}–#${lastSeq})...`,
      idx + 1,
      totalPasses
    );

    const transcript = formatTranscriptSegment(seg);
    const userPrompt = `Analyze Act/Segment ${idx + 1} of ${segments.length} (entries #${firstSeq} to #${lastSeq} out of ${entries.length} total entries) for translation into ${targetLangName}${dialectInfo ? ` (${dialectInfo.nameEn})` : ''}.
${
  partialAnalyses.length > 0
    ? `\nPreviously discovered storyline & characters so far:\nStoryline: ${partialAnalyses[partialAnalyses.length - 1].subjectAndStoryline}\nCharacters: ${partialAnalyses
        .flatMap((p) => p.characters.map((c) => `${c.name} (${c.gender}): ${c.translatedName}`))
        .slice(0, 25)
        .join(', ')}\n`
    : ''
}
=== SEGMENT TRANSCRIPT (#${firstSeq} - #${lastSeq}) ===
${transcript}
=== END OF SEGMENT ===

Return the JSON analysis for this segment.`;

    const { data } = await aiAdapter.generateStructured(
      {
        systemPrompt,
        userPrompt,
        temperature: 0.2,
      },
      ContextAnalysisResponseSchema
    );
    partialAnalyses.push(data);
  }

  // Synthesis pass: merge all segment discoveries into one unified Global Context Profile & Glossary
  onProgress?.(
    `Synthesizing master Context Profile & Glossary across all ${entries.length} analyzed entries...`,
    totalPasses,
    totalPasses
  );

  const synthesisPrompt = `Synthesize the following ${partialAnalyses.length} sequential segment analyses covering all ${entries.length} subtitle entries of the film/episode into one unified master Global Context Profile and deduplicated Persistent Translation Glossary for ${targetLangName}:

${JSON.stringify(partialAnalyses, null, 2)}

Ensure every character, relationship, plot turn, idiom/sarcasm discovery, and glossary term is unified and consistent from beginning to end. Return valid JSON.`;

  const { data: synthesized } = await aiAdapter.generateStructured(
    {
      systemPrompt,
      userPrompt: synthesisPrompt,
      temperature: 0.15,
    },
    ContextAnalysisResponseSchema
  );

  const merged = mergePartialAnalysesIntoSynthesized(synthesized, partialAnalyses);
  return buildFinalContextOutput(merged, entries.length, totalPasses);
}

function buildFinalContextOutput(
  data: ContextAnalysisResponse,
  totalEntries: number,
  passCount: number
): {
  contextProfile: GlobalContextProfile;
  glossary: GlossaryItem[];
  detectedSourceLanguage?: string;
} {
  // Deduplicate glossary items by normalized sourceTerm
  const glossaryMap = new Map<string, GlossaryItem>();

  // Ensure all discovered characters are also registered in the persistent glossary
  for (const char of data.characters) {
    if (char.name && char.translatedName) {
      const key = char.name.trim().toLowerCase();
      glossaryMap.set(key, {
        id: `char-${glossaryMap.size + 1}`,
        sourceTerm: char.name.trim(),
        targetTerm: char.translatedName.trim(),
        category: 'character',
        gender:
          char.gender === 'male' || char.gender === 'female' ? char.gender : 'neutral',
        contextNotes: `${char.role} — ${char.personalityAndTone}`,
      });
    }
  }

  for (const item of data.glossary) {
    if (!item.sourceTerm || !item.targetTerm) continue;
    const key = item.sourceTerm.trim().toLowerCase();
    if (!glossaryMap.has(key)) {
      glossaryMap.set(key, {
        id: `term-${glossaryMap.size + 1}`,
        sourceTerm: item.sourceTerm.trim(),
        targetTerm: item.targetTerm.trim(),
        category: item.category,
        gender: item.gender,
        contextNotes: item.contextNotes,
      });
    }
  }

  const contextProfile: GlobalContextProfile = {
    subjectAndStoryline: data.subjectAndStoryline,
    narrativeContextAndGenre: data.narrativeContextAndGenre,
    overallTone: data.overallTone,
    characters: data.characters,
    speechPatternsSummary: data.speechPatternsSummary,
    plotDevelopments: data.plotDevelopments,
    idiomsAndNuances: data.idiomsAndNuances,
    arabicLocalizationGuidance: data.arabicLocalizationGuidance,
    analyzedEntryCount: totalEntries,
    totalEntriesInFile: totalEntries,
    analysisPassCount: passCount,
    generatedAt: new Date().toISOString(),
  };

  return {
    contextProfile,
    glossary: Array.from(glossaryMap.values()),
    detectedSourceLanguage: data.detectedSourceLanguageCode,
  };
}
