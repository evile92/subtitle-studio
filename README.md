# Subtitle Studio — Advanced AI Subtitle Translation & Localization Platform

🌐 **Live Web Application:** [https://subtitle-studio-xi.vercel.app](https://subtitle-studio-xi.vercel.app)

> [!IMPORTANT]
> ### 🔑 Bring Your Own API Key (BYOK) & Privacy Assurance
> To use the live online platform, you must provide your own AI provider API Key (**Google Gemini**, **DeepSeek**, **OpenAI**, or **Anthropic Claude**) via the **AI & Settings** panel.
>
> 🔒 **100% Privacy & Security Guarantee:**
> - Your API key is strictly used to communicate with the chosen AI provider and is **never** exposed publicly, leaked in client-side code, logged, or visible to any other user or visitor.
> - Each user connects with their own private credentials. No third party or platform administrator can view or access your API keys.
>
> ---
>
> ### 🔒 خصوصية وأمان مفتاح الذكاء الاصطناعي (API Key)
> لتشغيل واستخدام الترجمة على الرابط المباشر، يلزمك استخدام مفتاح API الخاص بك (**Google Gemini** أو **DeepSeek** أو **OpenAI** أو **Anthropic**) عبر نافذة **إعدادات الذكاء الاصطناعي** في الموقع.
>
> 🛡️ **ضمان السرية والأمان التام:**
> - **مفتاحك آمن 100%:** يُستخدم المفتاح حصرياً لإرسال طلبات الترجمة الخاصة بك مباشرة إلى مزود الذكاء الاصطناعي.
> - **لا يمكن لأحد رؤيته:** لا يظهر المفتاح لأي زائر أو مستخدم آخر، ولا يتم تسجيله أو مشاركته مع أي طرف ثالث إطلاقاً.
> - كل مستخدم يعمل ببيئته الخاصة وبمفتاحه الشخصي في سرية تامة.

**Subtitle Studio** is a production-ready full-stack web application built with **Next.js (App Router), TypeScript, React, and Tailwind CSS** for translating movie and TV-series SubRip (`.srt`) subtitle files into virtually any language using advanced large language models, with specialized engineering for **Arabic audiovisual localization**.

---

## Key Capabilities

1. **Full-File Contextual AI Analysis (Before Translation Begins)**
   - Reads and analyzes **100% of subtitle entries** in the uploaded `.srt` file before translating a single line.
   - Builds a **Global Context Profile** (storyline summary, genre/tone, character profiles with gender/speaking style/relationships, speech register patterns, idioms/sarcasm/jokes, and chronological plot turns).
   - Generates a **Persistent Translation Glossary** mapping character names, locations, organizations, and recurring terms to consistent target-language equivalents.
2. **Scene-Aware Intelligent Chunking for Long Movies & Episodes**
   - Splits long subtitle files at natural timing pauses and sentence boundaries.
   - Passes **overlapping contextual windows** (preceding already-translated lines + upcoming lookahead dialogue lines) plus the Global Context Profile and Persistent Glossary to every batch.
   - Checkpoints every completed batch to disk (`data/jobs/<jobId>.json`) so interrupted connections or API failures can be resumed without losing or re-translating completed batches.
3. **Advanced Arabic Translation Engine**
   - Defaults to broadcast-grade **Modern Standard Arabic (الفصحى السينمائية المعاصرة)** when Arabic is selected.
   - Includes optional dialect localization modes (**Moroccan Darija, Egyptian, Levantine, Gulf, Iraqi, Tunisian, Sudanese**) that activate **only** when explicitly selected by the user.
   - Enforces masculine/feminine verb and pronoun agreement based on speaker and addressee gender, dual/plural distinctions, idiomatic localization, natural Arabic punctuation (`،`, `؟`, `؛`), and strict formatting tag preservation.
4. **100% SRT Structural Preservation & 11-Point Quality Assurance**
   - Never alters sequence numbers, start/end timestamps, entry counts, or subtitle ordering.
   - Preserves inline formatting tags (`<i>`, `</i>`, `<b>`, `</b>`, `<u>`, `</u>`, `{\an8}`) and music cues (`♪`).
   - Runs an independent 11-point post-translation QA validator with non-destructive automatic repair and round-trip SRT verification.
5. **Interactive Side-by-Side Subtitle Editor & Cinema Preview**
   - Synchronized Original vs. Translated panels with search, filtering (All, Needs Attention, Edited, Untranslated), manual editing, 1-click AI restore, and **Regenerate with Context** for individual lines.
   - Built-in **16:9 Visual Cinema Preview** with simulated playback, CPS (characters-per-second) readability telemetry, and RTL/LTR screen balance preview.
6. **Complete Bilingual Interface (English LTR & Arabic RTL) + Dark/Light/System Themes**

---

## Project Folder Structure

```text
subtitle-studio/
├── .env.example                          # Environment variables template
├── package.json                          # Dependencies & scripts
├── README.md                             # Project documentation
├── tests/
│   └── subtitle-studio.test.ts           # Automated test suite covering all 8 acceptance scenarios
└── src/
    ├── types/
    │   └── subtitle.ts                   # Core TypeScript interfaces (SRT, Context, Glossary, QA, Jobs)
    ├── lib/
    │   ├── languages.ts                  # 55+ searchable languages, Arabic varieties, auto-detection
    │   ├── sample-subtitles.ts           # Built-in sample SRT scripts for instant testing
    │   ├── i18n/
    │   │   └── translations.ts           # Complete English (LTR) & Arabic (RTL) UI dictionaries
    │   ├── srt/
    │   │   ├── parser.ts                 # Stage A: SRT parser, tag/speaker extractor & validator
    │   │   └── formatter.ts              # Valid SRT generator (UTF-8, UTF-8 BOM, Bilingual)
    │   ├── ai/
    │   │   ├── types.ts                  # AIProviderAdapter interface & server config state
    │   │   └── providers.ts              # Real adapters for Gemini, OpenAI, Anthropic & Custom LLMs
    │   ├── translation/
    │   │   ├── arabic-engine.ts          # Arabic linguistic instructions & RTL punctuation/tag normalizer
    │   │   ├── context-analyzer.ts       # Stage B: Full-file storyline & glossary extraction
    │   │   ├── chunker.ts                # Stage C: Scene-aware chunker with overlapping context windows
    │   │   ├── prompts.ts                # Stage D: Context-aware batch & single-line prompt builders
    │   │   ├── validator.ts              # 11-point QA validation & automatic repair engine
    │   │   └── pipeline.ts               # Multi-stage orchestrator with batch checkpointing & recovery
    │   ├── storage/
    │   │   └── job-store.ts              # Persistent disk-backed job store & retention policy cleanup
    │   └── security/
    │       └── rate-limiter.ts           # Server API rate limiting
    ├── context/
    │   └── AppContext.tsx                # UI language (EN/AR + LTR/RTL), Theme (Dark/Light/System), Branding
    ├── components/
    │   ├── Navbar.tsx                    # Responsive header, language/theme switchers, AI status pill
    │   ├── UploadZone.tsx                # Step 1: Drag-and-drop SRT upload, validation & sample loader
    │   ├── LanguageSelectors.tsx         # Steps 2 & 3: Searchable language & Arabic variety selectors
    │   ├── TranslationPreferences.tsx    # Step 4: Collapsible style & localization rules configuration
    │   ├── ProgressTracker.tsx           # Real-time 8-stage progress tracker & live telemetry logs
    │   ├── SubtitleWorkspace.tsx         # Synchronized side-by-side subtitle editor & export suite
    │   ├── SubtitlePreview.tsx           # 16:9 Cinema viewport subtitle preview & CPS meter
    │   ├── ContextProfileView.tsx        # Storyline context profile & interactive glossary editor
    │   ├── ValidationReportView.tsx      # 11-point QA structural report with jump-to-entry links
    │   ├── RecentHistory.tsx             # Persistent job history (open, resume, export, delete)
    │   ├── SettingsModal.tsx             # Server-side AI provider/model configuration modal
    │   └── PrivacyModal.tsx              # Transparent privacy & security notice
    └── app/
        ├── layout.tsx                    # Root layout with Inter & Cairo fonts
        ├── page.tsx                      # Main application controller
        └── api/
            ├── config/route.ts           # GET/POST AI provider configuration
            ├── validate-srt/route.ts     # POST server-side SRT validation & language detection
            └── jobs/
                ├── route.ts              # GET job list / POST create translation job
                └── [id]/
                    ├── route.ts          # GET job / PATCH manual edits & glossary / DELETE job
                    ├── process/route.ts  # POST execute or resume translation pipeline
                    ├── regenerate/route.ts # POST contextual single-entry regeneration
                    └── export/route.ts   # GET download validated .srt file
```

---

## Installation & Local Development

### 1. Install Dependencies

```bash
cd subtitle-studio
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set your preferred AI provider and API key:

- **Google Gemini (Default):**
  ```env
  AI_PROVIDER="gemini"
  AI_MODEL="gemini-3.1-flash-lite"
  GEMINI_API_KEY="your-gemini-api-key"
  ```
- **DeepSeek:**
  ```env
  AI_PROVIDER="deepseek"
  AI_MODEL="deepseek-chat"
  DEEPSEEK_API_KEY="your-deepseek-api-key"
  ```
- **OpenAI:**
  ```env
  AI_PROVIDER="openai"
  AI_MODEL="gpt-4o"
  OPENAI_API_KEY="sk-..."
  ```
- **Anthropic Claude:**
  ```env
  AI_PROVIDER="anthropic"
  AI_MODEL="claude-3-5-sonnet-latest"
  ANTHROPIC_API_KEY="sk-ant-..."
  ```
- **Custom OpenAI-Compatible Endpoint (OpenRouter, DeepSeek, Groq, Local Ollama):**
  ```env
  AI_PROVIDER="custom"
  AI_MODEL="deepseek-chat"
  CUSTOM_AI_BASE_URL="https://api.deepseek.com/v1"
  CUSTOM_AI_API_KEY="your-key"
  ```

> You can also configure or switch your AI provider, model, and API key directly inside the web UI via the **AI & Settings** modal (stored server-side in `data/config/ai-settings.json`, never exposed to client code).

### 3. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run Automated Tests

```bash
npm test
```

---

## Production Deployment

1. **Build the Production Bundle:**
   ```bash
   npm run build
   ```
2. **Start the Production Server:**
   ```bash
   npm start
   ```
3. **Environment & Storage Notes:**
   - Ensure `AI_PROVIDER`, `AI_MODEL`, and the corresponding `*_API_KEY` are set in your production environment variables.
   - Ensure the server process has write permissions to `./data/jobs` for persistent batch checkpointing and crash recovery.
