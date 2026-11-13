import type {
  ArabicDialect,
  GlobalContextProfile,
  GlossaryItem,
  TranslationPreferencesConfig,
} from '@/types/subtitle';
import { getArabicDialectOption } from '@/lib/languages';

const RLM = '\u200F'; // Unicode Right-to-Left Mark (U+200F)

/**
 * Strips invisible Unicode BiDi control characters for clean text inspection or idempotent re-application.
 */
export function stripBidiControlChars(text: string): string {
  return text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}

/**
 * Anchors Arabic subtitle lines with Unicode Right-to-Left Marks (RLM \u200F) so that
 * media players (MPC-HC, VLC, PotPlayer, TVs) treat each Arabic line and its leading/trailing
 * neutral punctuation (... , . , ! , ؟ , - , brackets, quotes) as strictly Right-to-Left (RTL),
 * ensuring end-of-sentence punctuation always appears at the visual LEFT (end of the Arabic sentence).
 */
export function applyArabicRtlBidiFix(text: string): string {
  if (!text) return text;

  const clean = stripBidiControlChars(text);
  const lines = clean.split(/\r?\n/);

  const fixedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Only apply RTL BiDi anchoring to lines that contain Arabic script characters
    if (!/[\u0600-\u06FF]/.test(trimmed)) {
      return trimmed;
    }

    // Separate outer opening tags (e.g. <i>, <b>, {\an8}) and outer closing tags (e.g. </i>, </b>)
    const openMatch = trimmed.match(/^((?:<[^/][^>]*>|\{\\[^}]+\})+)/);
    const leadingTags = openMatch ? openMatch[1] : '';
    let inner = trimmed.slice(leadingTags.length);

    const closeMatch = inner.match(/((?:<\/[^>]+>)+)$/);
    const trailingTags = closeMatch ? closeMatch[1] : '';
    if (trailingTags) {
      inner = inner.slice(0, inner.length - trailingTags.length);
    }

    inner = inner.trim();
    if (!inner) return trimmed;

    // Anchor leading neutral punctuation (e.g. "- ", "...", "[", "(") with RLM after it
    inner = inner.replace(
      /^([.…!؟?,،؛:;\-–—"'»«()[\]♪♫]+\s*)/,
      `$1${RLM}`
    );

    // Anchor trailing neutral punctuation (e.g. "...", ".", "!", "؟", ")", "]") with RLM before it
    inner = inner.replace(
      /(\s*[.…!؟?,،؛:;\-–—"'»«()[\]♪♫]+)$/,
      `${RLM}$1`
    );

    // Wrap the entire Arabic line content with leading and trailing RLM marks
    return `${leadingTags}${RLM}${inner}${RLM}${trailingTags}`;
  });

  return fixedLines.join('\n');
}

/**
 * Builds specialized Arabic linguistic localization instructions for the AI system prompt.
 */
export function buildArabicLinguisticInstructions(
  dialect: ArabicDialect = 'msa',
  preferences: TranslationPreferencesConfig,
  contextProfile?: GlobalContextProfile,
  glossary?: GlossaryItem[]
): string {
  const dialectOption = getArabicDialectOption(dialect);

  const characterGenderGuide =
    contextProfile?.characters && contextProfile.characters.length > 0
      ? contextProfile.characters
          .map(
            (c) =>
              `- ${c.name} -> "${c.translatedName}" (Gender: ${c.gender}, Role: ${c.role}, Tone: ${c.personalityAndTone}, Relationships: ${c.relationships})`
          )
          .join('\n')
      : 'Infer speaker and addressee gender carefully from scene context and character names.';

  const glossaryGuide =
    glossary && glossary.length > 0
      ? glossary
          .map(
            (g) =>
              `- "${g.sourceTerm}" MUST be translated consistently as "${g.targetTerm}" (${g.category}${g.gender ? `, gender: ${g.gender}` : ''})`
          )
          .join('\n')
      : 'Maintain strict consistency for all character names, places, and recurring terms.';

  return `
=== ADVANCED ARABIC SUBTITLE LOCALIZATION ENGINE ===
Target Variety: ${dialectOption.nameEn} (${dialectOption.nativeLabel})

1. VARIETY & REGISTER DIRECTIVE:
${dialectOption.promptGuidelines}

2. SPEAKER & ADDRESSEE GENDER RESOLUTION (CRITICAL):
- Before translating ANY line, determine: (A) WHO is speaking (Speaker Gender) and (B) WHOM they are addressing (Addressee Gender).
- VOCATIVE INVERSION RULE (قاعدة المنادى وعكس المخاطب):
  * If Line A directly addresses a named character (e.g., "We need space, Sarah" or "Listen to me, Mark"), that named person is the ADDRESSEE of Line A.
  * When that person replies in the next turn, they are speaking TO the other character, NOT addressing themselves. Never blindly copy a nearby character name's gender onto the addressee of a reply; match pronouns and verb conjugations to the actual listener.
- DUAL-SPEAKER DASH ("- ") TURN ALTERNATION:
  * When a single subtitle entry contains two speaker turns separated by "- ", they are TWO DIFFERENT speakers talking to each other. Track who speaks first and who replies so each half has accurate speaker and addressee gender.
- SCENE-LEVEL DIALOGUE CONTINUITY (استمرارية أطراف المشهد في الحوارات السريعة):
  * In rapid confrontations, arguments, or emotional exchanges where names are omitted across short lines, RETAIN the established speaker and addressee genders from preceding lines instead of reverting to default masculine.

3. CROSS-CUE SPLIT SENTENCES & CLAUSE RECONSTRUCTION (CRITICAL):
- Subtitles frequently split one complete English sentence, lyric line, or clause across two or more consecutive cues.
- Always read the preceding cues and upcoming lookahead cues to reconstruct the FULL English grammatical sentence BEFORE translating into Arabic.
- Then segment the natural Arabic translation cleanly back across the corresponding cues 1-to-1. NEVER translate a mid-sentence continuation cue in isolation as a stiff grammatical fragment (e.g., do not translate an orphan clause "Seems impossible to face" as broken "مستحيلاً على المواجهة" when the full thought means "يبدو من المستحيل مواجهته").

4. IDIOMS, SLANG, SUBTEXT & INTENDED MEANING (NO LITERAL TRANSLATION):
- You are an elite cinema subtitler. Translate the SPEAKER'S INTENDED MEANING, register, and emotional subtext, NEVER word-for-word dictionary glosses:
  * NATURAL & COLLOQUIAL EQUIVALENTS: Replace idiomatic and figurative expressions with authentic Arabic equivalents (e.g., "Heaven knows" -> "يعلم الله", NEVER "السماء تعلم"; "With one accord" -> "بصوت واحد / بقلب واحد", NEVER "بكلمة واحدة متفقة"; "Break it all down" in explanation -> "لأشرح الأمر وأفصّله", NOT literal "لأهدم كل شيء"; "Put you in the fast lane" -> "سأضعك في المسار السريع", NOT fabricated "طريق النجاح السريع").
  * ANTI-OVERCOMPLICATION & NATURAL REGISTER: Keep simple everyday speech crisp and spoken-natural. Match casual slang, banter, warmth, or grit to how real speakers talk rather than stiff textbook wording.
  * CASUAL VOCATIVES & ANTI-ARCHAIC DICTION: Translate informal vocatives like "man", "dude", "bro", "pal" naturally ("يا رجل"، "يا صاح") or omit when cleaner. NEVER use archaic or stilted phrases like "يا هذا" in modern dialogue.
  * ADULT HUMOR, DOUBLE-ENTENDRES & HONEST SUBTEXT: Preserve playful innuendo, sensual imagery, sarcasm, and earthy slang according to the profanity rule below rather than sanitizing them into vague or misleading euphemisms that flatten or contradict the scene.
  * LEXICAL DISAMBIGUATION IN CONTEXT:
    - Distinguish awkwardness/embarrassment ("cringey" -> "محرج") from disgust ("gross" -> "مقزز").
    - Distinguish non-committed/casual flings ("casual", "hooking up" -> "علاقة غير جدية / عابرة") from shallow personality ("سطحية") or formal romance ("يتواعدان").
    - Distinguish sensory/food state ("stale" food -> "بايت / غير طازج", not "قديم"), intoxication ("wasted" -> "ثمل جداً", not unconscious unless passed out), cognitive realization ("hasn't hit me yet" -> "لم أستوعب الأمر بعد"), and emotional openness ("vulnerable" -> "منفتح / كشفت مشاعري", not mechanical weakness).
  * CULTURAL & PROPER-NOUN TRANSLITERATION: Transliterate established university, band, city, and brand names faithfully into standard Arabic spelling (e.g., "Ole Miss" -> "أول ميس", NOT "أولي ميس" or literal word translation), keeping every recurring name spelling identical across the whole file.

5. SONG LYRICS, LETTERS & POETIC SUBTITLES (♪ / ♫):
- When subtitle lines are sung ("♪" / "♫") or written in lyrical/letter prose, prioritize poetic cadence, rhythm, emotional resonance, and metaphor over rigid word-by-word translation.
- Reconstruct split lyrics across adjacent "♪" cues so verbs, imagery, and metaphors flow seamlessly.
- Keep recurring choruses and refrains identically worded unless the English lyric itself changes.
- Translate visceral, romantic, or sensual lyric idioms faithfully to the song's actual meaning (e.g., never turn an explicit or euphoric climax phrase into awkward censorship like "التحرر" when the lyric means sensual ecstasy, subject to the profanity rule below).

6. STRICTLY FORBIDDEN LITERAL CALQUES (الترجمة الحرفية الركيكة الممنوعة):
- NEVER produce awkward English-to-Arabic calques:
  * "I super/really promise" -> "أعدك حقاً / أعدك صدقاً" (NEVER "أعدك بشدة").
  * "What the fuck/hell is going on?" -> "ما الذي يحدث بحق الجحيم؟ / ما هذا الذي يجري؟" (NEVER "ما اللعنة التي تحدث؟").
  * "It takes place" -> "تدور أحداثه / يجري" (NEVER "يأخذ مكان").
  * "Make sense" -> "هذا منطقي / كلام معقول" (NEVER "يصنع معنى").
  * "Piece of cake" -> "أمر في غاية السهولة / ولا أسهل" (NEVER "قطعة من الكعكة").
  * "Are you kidding me?" -> "أتمزح معي؟" (NEVER "هل تقوم بممازحتي؟").
  * "Never ... again" -> ALWAYS preserve the repetition cue: "لن ... مجدداً / ثانيةً" (NEVER collapse "never ... again" into generic "لن ... أبداً" when meaning "not again").
  * Avoid stiff filler ("تم + المصدر", "من قِبل", redundant pronouns like "أنا أعتقد أنني سوف...").

7. GRAMMATICAL & MORPHOLOGICAL PRECISION:
- Defective Verbs (الأفعال الناقصة المعتلة الآخر): Conjugate hollow and defective roots with exact classical morphology — e.g., "تمحو / يمحو" (from م-ح-و, NEVER erroneous "تمحي / يمحي"), "يدعو / يرجو / يشكو".
- Gender & Number Agreement: Conjugate verbs, adjectives, and dual pronouns (المثنى: كلاكما، أنتما) strictly according to context.
- Natural Arabic Punctuation & Orthography: Use Arabic comma (،), question mark (؟), semicolon (؛), accurate hamza (همزة القطع والوصل), and clean taa marbuta vs haa. Limit diacritics to light disambiguating tanwin fatha (مثل: حقاً، طبعاً، أبداً، مجدداً).

8. CHARACTER GENDER & VOICE MAP:
${characterGenderGuide}

9. MANDATORY TERMINOLOGY & NAME GLOSSARY:
${glossaryGuide}

10. SUBTITLE READABILITY & PACING:
- Keep lines concise, vivid, and effortless to read on screen without omitting meaningful nuance or emotional force.
- Preserve sarcasm, irony, humor, tension, and rhetorical rhythm faithfully.
${
  preferences.preserveProfanity
    ? '- Preserve strong language, gritty slang, and earthy/sensual intensity faithfully with varied, natural Arabic phrasing rather than repetitive censored euphemisms.'
    : '- Soften extreme profanity into natural, dramatic Arabic equivalents suitable for general broadcast without losing emotional tension or flattening the character\'s intent.'
}
`.trim();
}

/**
 * Post-processes translated Arabic subtitle text to ensure clean Arabic punctuation,
 * balanced formatting tags, RTL BiDi punctuation anchoring, and proper UTF-8 representation.
 */
export function normalizeArabicSubtitleText(
  translatedText: string,
  originalText: string
): string {
  if (!translatedText) return translatedText;

  let text = stripBidiControlChars(translatedText).trim();

  // Strip accidental markdown code fences if an LLM ever wrapped a single string
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');

  // Temporarily protect HTML/ASS formatting tags so punctuation normalization never touches them
  const protectedTags: string[] = [];
  text = text.replace(/(<\/?[a-zA-Z][^>]*>|\{\\[^}]+\})/g, (match) => {
    protectedTags.push(match);
    return `__TAG_PLACEHOLDER_${protectedTags.length - 1}__`;
  });

  // Replace ASCII question mark `?` following Arabic characters with Arabic question mark `؟`
  text = text.replace(/([\u0600-\u06FF\s])\?/g, '$1؟');

  // Replace ASCII comma `,` following Arabic characters (not between digits!) with Arabic comma `،`
  text = text.replace(/([\u0600-\u06FF])\s*,/g, '$1،');

  // Replace ASCII semicolon `;` following Arabic characters with Arabic semicolon `؛`
  text = text.replace(/([\u0600-\u06FF])\s*;/g, '$1؛');

  // Collapse multiple consecutive spaces on the same line
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n');

  // Restore protected formatting tags
  text = text.replace(/__TAG_PLACEHOLDER_(\d+)__/g, (_, indexStr) => {
    const idx = parseInt(indexStr, 10);
    return protectedTags[idx] ?? '';
  });

  // Ensure outer formatting tags from originalText (e.g., <i>...</i> or <b>...</b>) are preserved
  text = preserveOuterFormattingTags(text, originalText);

  // Apply Unicode RTL BiDi marks so punctuation (?, !, ..., -, brackets) renders on the correct RTL side in all video players
  text = applyArabicRtlBidiFix(text);

  return text;
}

/**
 * Ensures that if the original subtitle entry was wrapped in `<i>...</i>`, `<b>...</b>`, or `<u>...</u>`,
 * or had an ASS alignment tag like `{\an8}`, the translated subtitle preserves those tags cleanly.
 */
export function preserveOuterFormattingTags(
  translatedText: string,
  originalText: string
): string {
  let result = translatedText.trim();
  const origTrimmed = originalText.trim();

  // Check for leading ASS override tag like {\an8}
  const assMatch = origTrimmed.match(/^(\{\\[^}]+\})/);
  if (assMatch && !result.startsWith(assMatch[1])) {
    result = `${assMatch[1]}${result}`;
  }

  // Balance any unclosed <i>, <b>, <u> tags inside result
  for (const tag of ['i', 'b', 'u']) {
    const openRegex = new RegExp(`<${tag}>`, 'gi');
    const closeRegex = new RegExp(`</${tag}>`, 'gi');
    const openCount = (result.match(openRegex) || []).length;
    const closeCount = (result.match(closeRegex) || []).length;

    if (openCount > closeCount) {
      result = `${result}</${tag}>`;
    } else if (closeCount > openCount) {
      result = `<${tag}>${result}`;
    }

    // If the original entry contained <tag>...</tag> and translated text dropped it completely
    const origHasTagPair =
      new RegExp(`<${tag}>`, 'i').test(origTrimmed) &&
      new RegExp(`</${tag}>`, 'i').test(origTrimmed);
    if (origHasTagPair && openCount === 0 && closeCount === 0) {
      result = `<${tag}>${result}</${tag}>`;
    }
  }

  // Preserve music note symbols ♪ if original had them and translation dropped them
  if (origTrimmed.startsWith('♪') && !result.includes('♪')) {
    result = origTrimmed.endsWith('♪') ? `♪ ${result} ♪` : `♪ ${result}`;
  }

  return result;
}
