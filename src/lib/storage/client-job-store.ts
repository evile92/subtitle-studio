import type {
  ArabicDialect,
  JobSummary,
  PipelineStage,
  TranslationJob,
  TranslationPreferencesConfig,
  UserClientAIConfig,
} from '@/types/subtitle';
import { parseSrtContent } from '@/lib/srt/parser';
import { formatSrtContent } from '@/lib/srt/formatter';
import { createContextualBatches } from '@/lib/translation/chunker';

const CLIENT_JOBS_STORAGE_KEY = 'subtitle_studio_client_jobs_v1';
const ACTIVE_JOB_ID_KEY = 'subtitle_studio_active_job_id';
const MAX_STORED_CLIENT_JOBS = 10;

// In-memory client cache for instant state reads and large script resilience
const clientMemoryJobs = new Map<string, TranslationJob>();

function loadAllStoredJobsMap(): Record<string, TranslationJob> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CLIENT_JOBS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TranslationJob>;
    if (parsed && typeof parsed === 'object') {
      for (const [id, job] of Object.entries(parsed)) {
        if (!clientMemoryJobs.has(id)) {
          clientMemoryJobs.set(id, job);
        }
      }
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function persistJobsMap(map: Record<string, TranslationJob>, priorityJobId?: string): void {
  if (typeof window === 'undefined') return;

  const sortedJobs = Object.values(map).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // Keep up to MAX_STORED_CLIENT_JOBS, shrinking further if localStorage quota is tight
  for (let limit = Math.min(sortedJobs.length, MAX_STORED_CLIENT_JOBS); limit >= 1; limit--) {
    try {
      const subset: Record<string, TranslationJob> = {};
      const selected = sortedJobs.slice(0, limit);
      if (priorityJobId && !selected.some((j) => j.id === priorityJobId) && map[priorityJobId]) {
        selected[selected.length - 1] = map[priorityJobId];
      }
      for (const j of selected) {
        subset[j.id] = j;
      }
      localStorage.setItem(CLIENT_JOBS_STORAGE_KEY, JSON.stringify(subset));
      return;
    } catch {
      // Quota exceeded; retry with fewer historical jobs
    }
  }
}

export function saveClientJob(job: TranslationJob): TranslationJob {
  job.updatedAt = new Date().toISOString();
  clientMemoryJobs.set(job.id, job);

  const map = loadAllStoredJobsMap();
  map[job.id] = job;
  persistJobsMap(map, job.id);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(ACTIVE_JOB_ID_KEY, job.id);
    } catch {
      // Ignore
    }
  }

  return job;
}

export function getClientJob(jobId: string): TranslationJob | null {
  const fromMem = clientMemoryJobs.get(jobId);
  if (fromMem) return fromMem;

  const map = loadAllStoredJobsMap();
  return map[jobId] || null;
}

export function getLastActiveClientJob(): TranslationJob | null {
  if (typeof window === 'undefined') return null;
  try {
    const activeId = localStorage.getItem(ACTIVE_JOB_ID_KEY);
    if (!activeId) return null;
    const job = getClientJob(activeId);
    if (!job) {
      localStorage.removeItem(ACTIVE_JOB_ID_KEY);
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

export function deleteClientJob(jobId: string): void {
  clientMemoryJobs.delete(jobId);
  const map = loadAllStoredJobsMap();
  delete map[jobId];
  persistJobsMap(map);

  if (typeof window !== 'undefined') {
    try {
      if (localStorage.getItem(ACTIVE_JOB_ID_KEY) === jobId) {
        localStorage.removeItem(ACTIVE_JOB_ID_KEY);
      }
    } catch {
      // Ignore
    }
  }
}

export function listClientJobSummaries(): JobSummary[] {
  const map = loadAllStoredJobsMap();
  for (const [id, job] of clientMemoryJobs.entries()) {
    map[id] = job;
  }

  const summaries: JobSummary[] = Object.values(map).map((job) => ({
    id: job.id,
    fileName: job.fileName,
    fileSize: job.fileSize,
    sourceLanguage: job.sourceLanguage,
    detectedSourceLanguage: job.detectedSourceLanguage,
    targetLanguage: job.targetLanguage,
    arabicDialect: job.arabicDialect,
    stage: job.stage,
    progressPercent: job.progressPercent,
    translatedCount: job.translatedCount,
    totalEntries: job.totalEntries,
    qualityScore: job.validationReport?.qualityScore,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  }));

  return summaries.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function appendClientJobLog(
  job: TranslationJob,
  stage: PipelineStage,
  message: string,
  level: 'info' | 'success' | 'warning' | 'error' = 'info'
): void {
  job.stage = stage;
  job.logs.push({
    timestamp: new Date().toISOString(),
    stage,
    message,
    level,
  });
  if (level === 'warning' && !job.warnings.includes(message)) {
    job.warnings.push(message);
  }
}

export function createClientJobFromSrt(params: {
  fileName: string;
  fileContent: string;
  sourceLanguage: string;
  targetLanguage: string;
  arabicDialect?: ArabicDialect;
  preferences: TranslationPreferencesConfig;
  userAIConfig?: UserClientAIConfig;
}): TranslationJob {
  const {
    fileName,
    fileContent,
    sourceLanguage,
    targetLanguage,
    arabicDialect = 'msa',
    preferences,
    userAIConfig,
  } = params;

  const safeFileName = (fileName || 'subtitles.srt').replace(/[<>:"/\\|?*]/g, '_');
  const parsed = parseSrtContent(fileContent, safeFileName);

  if (!parsed.isValid || parsed.entries.length === 0) {
    throw new Error(
      parsed.errors[0] ||
        'The uploaded file is not a valid SubRip (.srt) subtitle file.'
    );
  }

  const batchSize = Math.max(5, Math.min(80, Number(preferences.batchSize || 35)));
  const contextOverlapSize = Math.max(
    2,
    Math.min(15, Number(preferences.contextOverlapSize || 6))
  );

  const normalizedPreferences: TranslationPreferencesConfig = {
    ...preferences,
    batchSize,
    contextOverlapSize,
  };

  const batches = createContextualBatches(parsed.entries, {
    batchSize,
    contextOverlapSize,
  });

  const now = new Date().toISOString();
  const randomSuffix = Math.random().toString(16).slice(2, 10);
  const jobId = `job_${Date.now()}_${randomSuffix}`;
  const byteSize = new TextEncoder().encode(fileContent).length;

  const newJob: TranslationJob = {
    id: jobId,
    fileName: safeFileName,
    fileSize: byteSize,
    format: 'srt',
    sourceLanguage,
    detectedSourceLanguage: parsed.detectedLanguage,
    targetLanguage,
    arabicDialect: targetLanguage.toLowerCase() === 'ar' ? arabicDialect : undefined,
    preferences: normalizedPreferences,
    stage: 'parsing',
    progressPercent: 10,
    translatedCount: 0,
    totalEntries: parsed.entries.length,
    currentBatch: 0,
    totalBatches: batches.length,
    entries: parsed.entries,
    glossary: [],
    batches,
    logs: [
      {
        timestamp: now,
        stage: 'uploading',
        message: `Uploaded "${safeFileName}" (${(byteSize / 1024).toFixed(1)} KB).`,
        level: 'info',
      },
      {
        timestamp: now,
        stage: 'parsing',
        message: `Parsed ${parsed.entries.length} subtitle entries across ${batches.length} contextual batches (detected source language: ${parsed.detectedLanguage.toUpperCase()}).`,
        level: 'success',
      },
    ],
    warnings: [...parsed.warnings],
    userAIConfig,
    createdAt: now,
    updatedAt: now,
  };

  return saveClientJob(newJob);
}

export function downloadClientJobSrt(
  job: TranslationJob,
  options: { useBom?: boolean; bilingual?: boolean } = {}
): void {
  if (typeof window === 'undefined') return;

  const useBom = options.useBom ?? job.targetLanguage.toLowerCase() === 'ar';
  const bilingual = Boolean(options.bilingual);

  const srtContent = formatSrtContent(job.entries, {
    useBom,
    bilingual,
  });

  const baseName = job.fileName.replace(/\.srt$/i, '');
  const langSuffix = job.targetLanguage.toLowerCase();
  const dialectSuffix =
    langSuffix === 'ar' && job.arabicDialect && job.arabicDialect !== 'msa'
      ? `-${job.arabicDialect}`
      : '';
  const modeSuffix = bilingual ? '.bilingual' : '';
  const downloadFileName = `${baseName}.${langSuffix}${dialectSuffix}${modeSuffix}.srt`;

  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
