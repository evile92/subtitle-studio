export type SupportedFormat = 'srt';

export type ArabicDialect =
  | 'msa'        // Modern Standard Arabic (Default)
  | 'moroccan'   // Moroccan Darija (الدارجة المغربية)
  | 'egyptian'   // Egyptian Arabic (العامية المصرية)
  | 'levantine'  // Levantine Arabic (العامية الشامية)
  | 'gulf'       // Gulf Arabic (العامية الخليجية)
  | 'iraqi'      // Iraqi Arabic (العامية العراقية)
  | 'tunisian'   // Tunisian Darija (الدارجة التونسية)
  | 'sudanese';  // Sudanese Arabic (العامية السودانية)

export type TranslationStyle =
  | 'natural'       // Natural and conversational
  | 'professional'  // Professional and polished
  | 'cinematic'     // Cinematic and literary
  | 'informal'      // Informal dialogue
  | 'formal';       // Formal dialogue

export interface TranslationPreferencesConfig {
  style: TranslationStyle;
  preserveMeaning: boolean;
  prioritizeNaturalDialogue: boolean;
  preserveHumorAndSarcasm: boolean;
  translateIdiomsByMeaning: boolean;
  preserveProfanity: boolean;
  preserveCulturalReferences: boolean;
  maintainConsistentNames: boolean;
  batchSize: number;
  contextOverlapSize: number;
  customInstructions?: string;
}

export interface SubtitleEntry {
  sequence: number;
  startTime: string;       // Exact original timestamp string e.g. "00:01:23,450"
  endTime: string;         // Exact original timestamp string e.g. "00:01:26,100"
  startMs: number;         // Milliseconds for duration/timing analysis
  endMs: number;           // Milliseconds for duration/timing analysis
  originalText: string;    // Exact original dialogue including tags & line breaks
  cleanText: string;       // Text stripped of HTML/ASS tags for analysis
  speakerLabel?: string;   // Extracted speaker label if present (e.g. "JOHN:", "- SARAH:")
  formattingTags: string[];// Extracted tags like ["<i>", "</i>"]
  isSoundEffect: boolean;  // True if entry is "[music]", "(sighs)", "♪ ... ♪", etc.
  // Translation state
  translatedText?: string;       // Current active translation (either AI or user-edited)
  aiTranslatedText?: string;     // Original AI-generated translation (kept so user can restore)
  isEditedByUser?: boolean;      // True if manually edited by the user
  translationNotes?: string;     // Optional translator note / context note from AI
  warnings?: string[];           // Entry-specific QA warnings if any
  status?: 'pending' | 'translated' | 'edited' | 'repaired' | 'warning';
}

export interface CharacterProfile {
  name: string;
  translatedName: string;
  gender: 'male' | 'female' | 'unknown' | 'non-binary';
  role: string;                  // e.g. "Protagonist / Detective", "Antagonist"
  personalityAndTone: string;    // e.g. "Dry, sarcastic, uses short clipped sentences"
  formalityLevel: 'formal' | 'informal' | 'mixed';
  relationships: string;         // How they relate to and address other characters
}

export interface GlossaryItem {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  category: 'character' | 'location' | 'organization' | 'terminology' | 'idiom' | 'recurring_phrase';
  gender?: 'male' | 'female' | 'neutral' | 'plural';
  contextNotes?: string;
}

export interface IdiomOrNuanceDiscovery {
  sequenceNumbers: number[];
  originalExpression: string;
  type: 'idiom' | 'sarcasm' | 'joke' | 'slang' | 'cultural_reference' | 'emotional_shift' | 'rhetorical_question';
  intendedMeaning: string;
  recommendedTranslationStrategy: string;
}

export interface GlobalContextProfile {
  subjectAndStoryline: string;
  narrativeContextAndGenre: string;
  overallTone: string;
  characters: CharacterProfile[];
  speechPatternsSummary: string;
  plotDevelopments: string[];
  idiomsAndNuances: IdiomOrNuanceDiscovery[];
  arabicLocalizationGuidance?: string;
  analyzedEntryCount: number;
  totalEntriesInFile: number;
  analysisPassCount: number;
  generatedAt: string;
}

export type PipelineStage =
  | 'uploading'               // 1. Uploading file
  | 'parsing'                 // 2. Parsing subtitle structure
  | 'analyzing_storyline'     // 3. Analyzing the complete storyline
  | 'building_context'        // 4. Building character and terminology context
  | 'translating_batches'     // 5. Translating subtitle batches
  | 'checking_consistency'    // 6. Checking translation consistency
  | 'validating_formatting'   // 7. Validating SRT formatting
  | 'preparing_download'      // 8. Preparing the downloadable file
  | 'completed'
  | 'failed'
  | 'paused';

export interface ValidationIssue {
  id: string;
  sequence?: number;
  type:
    | 'missing_entry'
    | 'duplicate_entry'
    | 'sequence_mismatch'
    | 'timestamp_modified'
    | 'empty_translation'
    | 'untranslated_dialogue'
    | 'broken_formatting_tags'
    | 'inconsistent_character_name'
    | 'inconsistent_terminology'
    | 'language_or_punctuation_issue'
    | 'malformed_srt_structure';
  severity: 'error' | 'warning' | 'info';
  message: string;
  autoRepaired: boolean;
  repairDescription?: string;
}

export interface ValidationReport {
  isValidSrtStructure: boolean;
  isFullyValidated: boolean;
  originalEntryCount: number;
  translatedEntryCount: number;
  sequenceIntegrityMatch: boolean;
  timestampIntegrityMatch: boolean;
  formattingTagsPreservedCount: number;
  formattingTagsTotalCount: number;
  emptyTranslationsCount: number;
  untranslatedCount: number;
  autoRepairedCount: number;
  unresolvedErrorsCount: number;
  unresolvedWarningsCount: number;
  qualityScore: number; // 0 to 100
  issues: ValidationIssue[];
  validatedAt: string;
}

export interface TranslationBatch {
  batchIndex: number;
  totalBatches: number;
  startSequence: number;
  endSequence: number;
  entrySequences: number[];
  precedingContextSequences: number[];
  followingContextSequences: number[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  completedAt?: string;
}

export interface ProgressLogEntry {
  timestamp: string;
  stage: PipelineStage;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

export interface TranslationJob {
  id: string;
  fileName: string;
  fileSize: number;
  format: SupportedFormat;
  sourceLanguage: string;         // ISO code or 'auto'
  detectedSourceLanguage?: string;// Resolved ISO code
  targetLanguage: string;         // ISO code e.g. 'ar', 'fr', 'es'
  arabicDialect?: ArabicDialect;  // Active when targetLanguage === 'ar'
  preferences: TranslationPreferencesConfig;
  stage: PipelineStage;
  progressPercent: number;
  translatedCount: number;
  totalEntries: number;
  currentBatch: number;
  totalBatches: number;
  entries: SubtitleEntry[];
  contextProfile?: GlobalContextProfile;
  glossary: GlossaryItem[];
  batches: TranslationBatch[];
  validationReport?: ValidationReport;
  logs: ProgressLogEntry[];
  warnings: string[];
  errorMessage?: string;
  aiProviderUsed?: string;
  aiModelUsed?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface JobSummary {
  id: string;
  fileName: string;
  fileSize: number;
  sourceLanguage: string;
  detectedSourceLanguage?: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  stage: PipelineStage;
  progressPercent: number;
  translatedCount: number;
  totalEntries: number;
  qualityScore?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type AIProviderType = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'custom';

export interface AIProviderSettings {
  provider: AIProviderType;
  model: string;
  apiKey?: string;
  customBaseUrl?: string;
  temperature: number;
  maxRetries: number;
}
