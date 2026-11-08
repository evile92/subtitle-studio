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

2. NATURAL FILM DIALOGUE VS. MACHINE CALQUES:
- You are an elite audiovisual subtitle translator for cinema and television, NOT a literal word-for-word machine translator.
- Write lines that sound natural when spoken aloud by a real person in the scene's emotional state.
- STRICTLY FORBIDDEN literal calques (الترجمة الحرفية الركيكة):
  * Never translate "It takes place" as "يأخذ مكان" -> use "تدور أحداثه / يجري".
  * Never translate "Make sense" as "يصنع معنى" -> use "هذا منطقي / كلام معقول".
  * Never translate "Piece of cake" as "قطعة من الكعكة" -> use "أمر في غاية السهولة / ولا أسهل".
  * Never translate "Are you kidding me?" as "هل تقوم بممازحتي؟" -> use "أتمزح معي؟" (MSA) or the selected dialect equivalent.
  * Never overuse "تم + المصدر" or "من قِبل" for passive voice when active Arabic verb forms or natural passive (المبني للمجهول) are much cleaner.
  * Avoid stiff redundant pronouns ("أنا أعتقد أنني سوف أذهب" -> "أظنني سأذهب" or "أعتقد أني ذاهب").

3. GRAMMATICAL & MORPHOLOGICAL PRECISION:
- Gender Agreement (التذكير والتأنيث): Check WHO is speaking and WHOM they are addressing in every single subtitle line. Conjugate verbs, adjectives, and second-person pronouns (أنتَ/أنتِ، لكَ/لكِ) accurately.
- Number Agreement (المفرد والمثنى والجمع): Use the Arabic dual form (المثنى: كلاكما، أنتما، ذهبا) when addressing or referring to exactly two people.
- Natural Arabic Punctuation: Use Arabic comma (،), Arabic question mark (؟), and Arabic semicolon (؛). Do not add unnecessary tashkeel/diacritics except occasional disambiguating tanwin fatha (مثل: حقاً، طبعاً، شكراً، أبداً).

4. CHARACTER GENDER & VOICE MAP:
${characterGenderGuide}

5. MANDATORY TERMINOLOGY & NAME GLOSSARY:
${glossaryGuide}

6. SUBTITLE READABILITY & PACING:
- Keep lines concise and impactful for screen reading without omitting any meaningful nuance.
- Preserve sarcasm, irony, humor, emotional intensity, and rhetorical questions faithfully.
${
  preferences.preserveProfanity
    ? '- Preserve strong language and confrontational intensity faithfully according to the character\'s tone.'
    : '- Soften extreme profanity into natural, dramatic Arabic equivalents suitable for general broadcast without losing emotional tension.'
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
