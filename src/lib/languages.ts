import type { ArabicDialect } from '@/types/subtitle';

export interface LanguageOption {
  code: string;
  nameEn: string;
  nameAr: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  popular?: boolean;
}

export interface ArabicDialectOption {
  id: ArabicDialect;
  nameEn: string;
  nameAr: string;
  nativeLabel: string;
  descriptionEn: string;
  descriptionAr: string;
  promptGuidelines: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', nameEn: 'English', nameAr: 'الإنجليزية', nativeName: 'English', dir: 'ltr', popular: true },
  { code: 'ar', nameEn: 'Arabic', nameAr: 'العربية', nativeName: 'العربية', dir: 'rtl', popular: true },
  { code: 'fr', nameEn: 'French', nameAr: 'الفرنسية', nativeName: 'Français', dir: 'ltr', popular: true },
  { code: 'es', nameEn: 'Spanish', nameAr: 'الإسبانية', nativeName: 'Español', dir: 'ltr', popular: true },
  { code: 'de', nameEn: 'German', nameAr: 'الألمانية', nativeName: 'Deutsch', dir: 'ltr', popular: true },
  { code: 'it', nameEn: 'Italian', nameAr: 'الإيطالية', nativeName: 'Italiano', dir: 'ltr', popular: true },
  { code: 'pt', nameEn: 'Portuguese', nameAr: 'البرتغالية', nativeName: 'Português', dir: 'ltr', popular: true },
  { code: 'ru', nameEn: 'Russian', nameAr: 'الروسية', nativeName: 'Русский', dir: 'ltr', popular: true },
  { code: 'tr', nameEn: 'Turkish', nameAr: 'التركية', nativeName: 'Türkçe', dir: 'ltr', popular: true },
  { code: 'ja', nameEn: 'Japanese', nameAr: 'اليابانية', nativeName: '日本語', dir: 'ltr', popular: true },
  { code: 'ko', nameEn: 'Korean', nameAr: 'الكورية', nativeName: '한국어', dir: 'ltr', popular: true },
  { code: 'zh', nameEn: 'Chinese (Simplified)', nameAr: 'الصينية (المبسطة)', nativeName: '简体中文', dir: 'ltr', popular: true },
  { code: 'zh-TW', nameEn: 'Chinese (Traditional)', nameAr: 'الصينية (التقليدية)', nativeName: '繁體中文', dir: 'ltr' },
  { code: 'hi', nameEn: 'Hindi', nameAr: 'الهندية', nativeName: 'हिन्दी', dir: 'ltr', popular: true },
  { code: 'nl', nameEn: 'Dutch', nameAr: 'الهولندية', nativeName: 'Nederlands', dir: 'ltr', popular: true },
  { code: 'sv', nameEn: 'Swedish', nameAr: 'السويدية', nativeName: 'Svenska', dir: 'ltr', popular: true },
  { code: 'pl', nameEn: 'Polish', nameAr: 'البولندية', nativeName: 'Polski', dir: 'ltr', popular: true },
  { code: 'id', nameEn: 'Indonesian', nameAr: 'الإندونيسية', nativeName: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'ms', nameEn: 'Malay', nameAr: 'الماليزية', nativeName: 'Bahasa Melayu', dir: 'ltr' },
  { code: 'vi', nameEn: 'Vietnamese', nameAr: 'الفيتنامية', nativeName: 'Tiếng Việt', dir: 'ltr' },
  { code: 'th', nameEn: 'Thai', nameAr: 'التايلاندية', nativeName: 'ไทย', dir: 'ltr' },
  { code: 'fa', nameEn: 'Persian (Farsi)', nameAr: 'الفارسية', nativeName: 'فارسی', dir: 'rtl' },
  { code: 'ur', nameEn: 'Urdu', nameAr: 'الأردية', nativeName: 'اردو', dir: 'rtl' },
  { code: 'he', nameEn: 'Hebrew', nameAr: 'العبرية', nativeName: 'עברית', dir: 'rtl' },
  { code: 'el', nameEn: 'Greek', nameAr: 'اليونانية', nativeName: 'Ελληνικά', dir: 'ltr' },
  { code: 'cs', nameEn: 'Czech', nameAr: 'التشيكية', nativeName: 'Čeština', dir: 'ltr' },
  { code: 'ro', nameEn: 'Romanian', nameAr: 'الرومانية', nativeName: 'Română', dir: 'ltr' },
  { code: 'hu', nameEn: 'Hungarian', nameAr: 'المجرية', nativeName: 'Magyar', dir: 'ltr' },
  { code: 'uk', nameEn: 'Ukrainian', nameAr: 'الأوكرانية', nativeName: 'Українська', dir: 'ltr' },
  { code: 'da', nameEn: 'Danish', nameAr: 'الدنماركية', nativeName: 'Dansk', dir: 'ltr' },
  { code: 'fi', nameEn: 'Finnish', nameAr: 'الفنلندية', nativeName: 'Suomi', dir: 'ltr' },
  { code: 'no', nameEn: 'Norwegian', nameAr: 'النرويجية', nativeName: 'Norsk', dir: 'ltr' },
  { code: 'bg', nameEn: 'Bulgarian', nameAr: 'البلغارية', nativeName: 'Български', dir: 'ltr' },
  { code: 'hr', nameEn: 'Croatian', nameAr: 'الكرواتية', nativeName: 'Hrvatski', dir: 'ltr' },
  { code: 'sr', nameEn: 'Serbian', nameAr: 'الصربية', nativeName: 'Српски', dir: 'ltr' },
  { code: 'sk', nameEn: 'Slovak', nameAr: 'السلوفاكية', nativeName: 'Slovenčina', dir: 'ltr' },
  { code: 'sl', nameEn: 'Slovenian', nameAr: 'السلوفينية', nativeName: 'Slovenščina', dir: 'ltr' },
  { code: 'ca', nameEn: 'Catalan', nameAr: 'الكتالونية', nativeName: 'Català', dir: 'ltr' },
  { code: 'tl', nameEn: 'Filipino (Tagalog)', nameAr: 'الفلبينية (تاغالوغ)', nativeName: 'Filipino', dir: 'ltr' },
  { code: 'bn', nameEn: 'Bengali', nameAr: 'البنغالية', nativeName: 'বাংলা', dir: 'ltr' },
  { code: 'ta', nameEn: 'Tamil', nameAr: 'التاميلية', nativeName: 'தமிழ்', dir: 'ltr' },
  { code: 'te', nameEn: 'Telugu', nameAr: 'التيلوغوية', nativeName: 'తెలుగు', dir: 'ltr' },
  { code: 'ml', nameEn: 'Malayalam', nameAr: 'المالايالامية', nativeName: 'മലയാളം', dir: 'ltr' },
  { code: 'mr', nameEn: 'Marathi', nameAr: 'الماراثية', nativeName: 'मराठी', dir: 'ltr' },
  { code: 'gu', nameEn: 'Gujarati', nameAr: 'الغوجاراتية', nativeName: 'ગુજરાતી', dir: 'ltr' },
  { code: 'pa', nameEn: 'Punjabi', nameAr: 'البنجابية', nativeName: 'ਪੰਜਾਬੀ', dir: 'ltr' },
  { code: 'sw', nameEn: 'Swahili', nameAr: 'السواحيلية', nativeName: 'Kiswahili', dir: 'ltr' },
  { code: 'am', nameEn: 'Amharic', nameAr: 'الأمهرية', nativeName: 'አማርኛ', dir: 'ltr' },
  { code: 'az', nameEn: 'Azerbaijani', nameAr: 'الأذربيجانية', nativeName: 'Azərbaycan', dir: 'ltr' },
  { code: 'ka', nameEn: 'Georgian', nameAr: 'الجورجية', nativeName: 'ქართული', dir: 'ltr' },
  { code: 'hy', nameEn: 'Armenian', nameAr: 'الأرمنية', nativeName: 'Հայերեն', dir: 'ltr' },
  { code: 'kk', nameEn: 'Kazakh', nameAr: 'الكازاخية', nativeName: 'Қазақ тілі', dir: 'ltr' },
  { code: 'uz', nameEn: 'Uzbek', nameAr: 'الأوزبكية', nativeName: 'Oʻzbekcha', dir: 'ltr' },
  { code: 'is', nameEn: 'Icelandic', nameAr: 'الأيسلندية', nativeName: 'Íslenska', dir: 'ltr' },
  { code: 'lt', nameEn: 'Lithuanian', nameAr: 'الليتوانية', nativeName: 'Lietuvių', dir: 'ltr' },
  { code: 'lv', nameEn: 'Latvian', nameAr: 'اللاتفية', nativeName: 'Latviešu', dir: 'ltr' },
  { code: 'et', nameEn: 'Estonian', nameAr: 'الإستونية', nativeName: 'Eesti', dir: 'ltr' },
  { code: 'af', nameEn: 'Afrikaans', nameAr: 'الأفريقانية', nativeName: 'Afrikaans', dir: 'ltr' },
];

export const ARABIC_DIALECTS: ArabicDialectOption[] = [
  {
    id: 'msa',
    nameEn: 'Modern Standard Arabic (Default)',
    nameAr: 'الفصحى الحديثة المعاصرة (افتراضي)',
    nativeLabel: 'العربية الفصحى المعاصرة',
    descriptionEn: 'Professional broadcast-grade Modern Standard Arabic used by top cinema and streaming platforms (Netflix, Shahid, OSN). Natural, fluent, and universally understood without archaic stiffness.',
    descriptionAr: 'فصحى سينمائية سلسة وطبيعية معتمدة في كبرى منصات البث والسينما، مفهومة لدى جميع الناطقين بالعربية دون تقعّر أو ركاكة حرفية.',
    promptGuidelines: `Use Contemporary Modern Standard Arabic (الفصحى السينمائية المعاصرة) tailored for film and TV subtitling:
- Write fluid, natural spoken-style MSA that sounds authentic in dramatic or comedic dialogue, NOT stiff textbook or archaic classical prose.
- Prefer verbal sentences (الجملة الفعلية) where natural in Arabic flow rather than calquing English SVO nominal structures ("هو قال أنه..." -> "قال إنه...").
- Avoid awkward literal translations of English passive voice ("تم قتله من قبل..." -> "قُتل على يد..." or active construction).
- Maintain strict masculine/feminine agreement (التذكير والتأنيث) and singular/dual/plural forms (المفرد والمثنى والجمع).
- Use natural Arabic idioms and conversational connectors (مثل: "على أية حال"، "ما خطبك؟"، "لا شأن لك بهذا"، "أتمزح معي؟") instead of literal word-for-word calques.`
  },
  {
    id: 'moroccan',
    nameEn: 'Moroccan Darija',
    nameAr: 'الدارجة المغربية',
    nativeLabel: 'الدارجة المغربية',
    descriptionEn: 'Authentic Moroccan Darija written in clear Arabic script, capturing Moroccan everyday expressions, humor, and conversational rhythm.',
    descriptionAr: 'حوارات طبيعية بالدارجة المغربية مكتوبة بالحرف العربي الواضح، تعكس روح الكلام اليومي المغربي وتعابيره العفوية.',
    promptGuidelines: `Translate into authentic, natural Moroccan Darija (الدارجة المغربية) written in clean Arabic script:
- Use authentic Moroccan vocabulary, verb conjugations (كا-/تـ + فعل، غادي، واش، علاش، كيفاش، بالصح، دابا، بزاف، صافي، ماشي مشكل).
- Adapt idioms and sarcasm into genuine Moroccan expressions that fit the character's age and social background.
- Keep spelling readable and consistent in Arabic script (avoid Latin/Franco-Arabic characters).`
  },
  {
    id: 'egyptian',
    nameEn: 'Egyptian Arabic',
    nameAr: 'العامية المصرية',
    nativeLabel: 'المصري العامي',
    descriptionEn: 'Vibrant Egyptian colloquial Arabic ideal for comedy, drama, and expressive character dialogue.',
    descriptionAr: 'لهجة مصرية عامية حيوية وطبيعية، مثالية للأعمال الكوميدية والدرامية والحوارات اليومية المعبرة.',
    promptGuidelines: `Translate into authentic, natural Egyptian Colloquial Arabic (العامية المصرية):
- Use natural Egyptian phrasing, verb prefixes (بـ / هـ), negation (مش / ما...ش), and conversational particles (إزيك، ليه، إيه ده، خالص، أوي، طبعاً، يا خبر، معلش).
- Localize humor, sarcasm, and emotional dialogue so it sounds like native Egyptian cinema/TV dialogue.`
  },
  {
    id: 'levantine',
    nameEn: 'Levantine Arabic',
    nameAr: 'العامية الشامية',
    nativeLabel: 'اللهجة الشامية',
    descriptionEn: 'Warm, expressive Levantine Arabic (Syrian/Lebanese/Jordanian/Palestinian) widely popular in dubbed & subtitled drama series.',
    descriptionAr: 'لهجة شامية سلسة ومعبرة (سورية/لبنانية/أردنية/فلسطينية) شائعة ومحببة في الدراما والمسلسلات.',
    promptGuidelines: `Translate into authentic, natural Levantine Arabic (اللهجة الشامية البيضاء):
- Use natural Levantine verb forms (عم يحكي، رح يروح، بدي، هلق، شو، ليش، هيك، كتير، منيح، ما في شي).
- Match emotional warmth, confrontation, or irony with genuine Levantine conversational idioms.`
  },
  {
    id: 'gulf',
    nameEn: 'Gulf Arabic',
    nameAr: 'العامية الخليجية',
    nativeLabel: 'اللهجة الخليجية',
    descriptionEn: 'Natural Khaleeji / Gulf Arabic reflecting contemporary conversational expressions across the Arabian Gulf.',
    descriptionAr: 'لهجة خليجية بيضاء معاصرة تعكس أسلوب الحوار الطبيعي في الخليج العربي.',
    promptGuidelines: `Translate into authentic, natural White Gulf Arabic (اللهجة الخليجية البيضاء):
- Use authentic Gulf phrasing and vocabulary (وش، ليش، شلون، الحين، وايد/مرة، يبي، ما عليه، طال عمرك، يا خوي).
- Keep the tone faithful to the characters and scene context.`
  },
  {
    id: 'iraqi',
    nameEn: 'Iraqi Arabic',
    nameAr: 'العامية العراقية',
    nativeLabel: 'اللهجة العراقية',
    descriptionEn: 'Expressive Mesopotamian/Iraqi colloquial Arabic with rich emotional and idiomatic depth.',
    descriptionAr: 'لهجة عراقية أصيلة غنية بالتعابير الوجدانية والحوارات اليومية الطبيعية.',
    promptGuidelines: `Translate into authentic Iraqi Arabic (اللهجة العراقية):
- Use genuine Iraqi expressions and grammar (شكو ماكو، شلونك، هسه، ليش، هواية، دير بالك، ماكو هيج حجي، عيني).`
  },
  {
    id: 'tunisian',
    nameEn: 'Tunisian Arabic',
    nameAr: 'الدارجة التونسية',
    nativeLabel: 'التونسي',
    descriptionEn: 'Natural Tunisian Derja in clear Arabic script for North African localization.',
    descriptionAr: 'دارجة تونسية سلسة وطبيعية مكتوبة بالحرف العربي.',
    promptGuidelines: `Translate into natural Tunisian Derja (الدارجة التونسية) in Arabic script:
- Use authentic Tunisian phrasing (شنوة، علاش، كيفاش، برشا، توا، باهي، ما فماش، يعيشك).`
  },
  {
    id: 'sudanese',
    nameEn: 'Sudanese Arabic',
    nameAr: 'العامية السودانية',
    nativeLabel: 'اللهجة السودانية',
    descriptionEn: 'Warm, expressive Sudanese colloquial Arabic.',
    descriptionAr: 'لهجة سودانية طبيعية ودافئة.',
    promptGuidelines: `Translate into natural Sudanese Colloquial Arabic (اللهجة السودانية):
- Use authentic Sudanese expressions (كيفنك، شنو، هسي، شديد، يا زول، داير، ما في عوجة).`
  }
];

export function getLanguageByCode(code: string): LanguageOption | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase());
}

export function getLanguageName(code: string, uiLang: 'en' | 'ar' = 'en'): string {
  if (code === 'auto') {
    return uiLang === 'ar' ? 'كشف تلقائي للغة' : 'Auto-detect language';
  }
  const found = getLanguageByCode(code);
  if (!found) return code.toUpperCase();
  return uiLang === 'ar' ? found.nameAr : found.nameEn;
}

export function getArabicDialectOption(dialect?: ArabicDialect): ArabicDialectOption {
  return ARABIC_DIALECTS.find((d) => d.id === dialect) || ARABIC_DIALECTS[0];
}

export function isRtlLanguage(code: string): boolean {
  const rtlCodes = new Set(['ar', 'fa', 'ur', 'he']);
  return rtlCodes.has(code.toLowerCase());
}

/**
 * Heuristic script & stopword detector to identify the source language of an SRT file
 * immediately upon upload (and refined by AI during Global Context Analysis).
 */
export function detectLanguageFromText(sampleText: string): {
  code: string;
  confidence: number;
} {
  const clean = sampleText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[0-9:,.\-->\r\n[\]()♪♫"'!?-]+/g, ' ')
    .trim();

  if (!clean) {
    return { code: 'en', confidence: 0.3 };
  }

  // Script-based character counts
  const arabicChars = (clean.match(/[\u0600-\u06FF]/g) || []).length;
  const hebrewChars = (clean.match(/[\u0590-\u05FF]/g) || []).length;
  const cyrillicChars = (clean.match(/[\u0400-\u04FF]/g) || []).length;
  const hangulChars = (clean.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  const hiraganaKatakanaChars = (clean.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const cjkChars = (clean.match(/[\u4E00-\u9FFF]/g) || []).length;
  const devanagariChars = (clean.match(/[\u0900-\u097F]/g) || []).length;
  const thaiChars = (clean.match(/[\u0E00-\u0E7F]/g) || []).length;
  const greekChars = (clean.match(/[\u0370-\u03FF]/g) || []).length;

  const totalLetters = clean.replace(/\s+/g, '').length || 1;

  if (arabicChars / totalLetters > 0.3) {
    // Distinguish Persian/Urdu vs Arabic
    const persianSpecific = (clean.match(/[پچژگک]/g) || []).length;
    if (persianSpecific > 3) return { code: 'fa', confidence: 0.9 };
    return { code: 'ar', confidence: 0.95 };
  }
  if (hebrewChars / totalLetters > 0.3) return { code: 'he', confidence: 0.95 };
  if (hangulChars / totalLetters > 0.2) return { code: 'ko', confidence: 0.95 };
  if (hiraganaKatakanaChars > 3) return { code: 'ja', confidence: 0.95 };
  if (cjkChars / totalLetters > 0.2) return { code: 'zh', confidence: 0.92 };
  if (devanagariChars / totalLetters > 0.3) return { code: 'hi', confidence: 0.95 };
  if (thaiChars / totalLetters > 0.3) return { code: 'th', confidence: 0.95 };
  if (greekChars / totalLetters > 0.3) return { code: 'el', confidence: 0.95 };
  if (cyrillicChars / totalLetters > 0.3) {
    const ukrainianSpecific = (clean.match(/[іїєґІЇЄҐ]/g) || []).length;
    if (ukrainianSpecific > 2) return { code: 'uk', confidence: 0.9 };
    return { code: 'ru', confidence: 0.9 };
  }

  // Latin script stopword scoring
  const words = clean.toLowerCase().split(/\s+/).filter(Boolean);
  const wordSet = new Set(words);

  const stopwordProfiles: Record<string, string[]> = {
    en: ['the', 'you', 'and', 'that', 'what', 'have', 'this', 'with', 'not', 'but', 'from', 'they', 'know', 'don\'t', 'your', 'about', 'would', 'there'],
    es: ['que', 'los', 'las', 'una', 'para', 'con', 'por', 'como', 'pero', 'más', 'está', 'esto', 'todo', 'tengo', 'vamos', 'eres'],
    fr: ['les', 'des', 'que', 'une', 'dans', 'pour', 'pas', 'sur', 'plus', 'avec', 'vous', 'سائ', 'est', 'c\'est', 'Mais', 'nous', 'tout', 'suis'],
    de: ['der', 'die', 'das', 'und', 'ich', 'nicht', 'ein', 'एक', 'sie', 'wir', 'मि', 'ist', 'mit', 'auf', 'für', 'was', 'haben', 'dich'],
    it: ['che', 'non', 'per', 'una', 'con', 'sono', 'della', 'questo', 'più', 'tutto', 'anche', 'mio', 'bene', 'cosa', 'sei'],
    pt: ['que', 'não', 'para', 'uma', 'com', 'por', 'mais', 'como', 'mas', 'está', 'isso', 'você', 'tudo', 'meu', 'vamos'],
    tr: ['bir', 've', 'bu', 'için', 'değil', 'ben', 'sen', 'ama', 'var', 'جوك', 'ne', 'गibi', 'daha', '미', 'bana', 'بوني', 'yok'],
    nl: ['het', 'een', 'van', 'dat', 'niet', 'met', 'voor', 'zijn', 'maar', 'wat', 'heb', 'wij', 'naar', 'deze'],
    sv: ['och', 'det', 'att', 'jag', 'inte', 'för', 'med', 'som', 'har', 'vad', 'پإ', 'dig', 'var', 'här'],
    pl: ['nie', 'to', 'się', 'na', 'co', 'jak', 'ale', 'mnie', 'jest', 'tak', 'czy', 'tylko', 'mam'],
    id: ['yang', 'dan', 'di', 'ini', 'untuk', 'tidak', 'dengan', 'سيا', 'أدا', 'داري', 'تاپي', 'كيتا', 'أكو', 'كامو'],
  };

  let bestLang = 'en';
  let bestScore = 0;

  for (const [lang, stopwords] of Object.entries(stopwordProfiles)) {
    let score = 0;
    for (const w of stopwords) {
      if (wordSet.has(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return {
    code: bestLang,
    confidence: bestScore >= 3 ? 0.9 : 0.65,
  };
}
