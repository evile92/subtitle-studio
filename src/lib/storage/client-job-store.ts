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
const IDB_DB_NAME = 'subtitle_studio_jobs_db';
const IDB_STORE_NAME = 'jobs';
const IDB_DB_VERSION = 1;
const MAX_IDB_STORED_JOBS = 50;
const MAX_LOCAL_MIRROR_JOBS = 3;

// Authoritative in-memory client cache + snapshot versioning for useSyncExternalStore
const clientMemoryJobs = new Map<string, TranslationJob>();
const dirtyJobIds = new Set<string>();
const deletedJobIds = new Set<string>();

const EMPTY_SUMMARIES: JobSummary[] = [];
const clientJobListeners = new Set<() => void>();
let clientStoreVersion = 0;
let cachedSummariesVersion = -1;
let cachedSummariesValue: JobSummary[] = EMPTY_SUMMARIES;
let cachedActiveJobVersion = -1;
let cachedActiveJobValue: TranslationJob | null = null;
let localStorageLoaded = false;
let idbHydrationPromise: Promise<void> | null = null;
let idbWriteQueue: Promise<void> = Promise.resolve();

function notifyClientJobStoreChange(): void {
  clientStoreVersion += 1;
  for (const listener of clientJobListeners) {
    listener();
  }
}

function getIndexedDbFactory(): IDBFactory | null {
  if (
    typeof globalThis !== 'undefined' &&
    'indexedDB' in globalThis &&
    globalThis.indexedDB
  ) {
    return globalThis.indexedDB;
  }
  return null;
}

function openJobsDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = idb.open(IDB_DB_NAME, IDB_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
        };
        resolve(db);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB.'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

async function runIdbTransaction<T>(
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => Promise<T> | T
): Promise<T | undefined> {
  const idb = getIndexedDbFactory();
  if (!idb) return undefined;

  let db: IDBDatabase | null = null;
  try {
    db = await openJobsDatabase(idb);
    const tx = db.transaction(IDB_STORE_NAME, mode);
    const store = tx.objectStore(IDB_STORE_NAME);

    const txDone = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    });

    const result = await executor(store);
    await txDone;
    return result;
  } catch {
    return undefined;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function enqueueIdbOperation(op: () => Promise<void>): void {
  if (!getIndexedDbFactory()) return;
  idbWriteQueue = idbWriteQueue.then(op).catch(() => {
    // Keep queue alive if an earlier write fails in restricted browsing modes
  });
}

function cloneJobForStorage(job: TranslationJob): TranslationJob {
  return {
    ...job,
    entries: job.entries.map((e) => ({ ...e })),
    batches: job.batches.map((b) => ({ ...b })),
    glossary: job.glossary.map((g) => ({ ...g })),
    logs: job.logs.map((l) => ({ ...l })),
    warnings: [...job.warnings],
  };
}

function ensureLocalStorageLoaded(): void {
  if (localStorageLoaded) return;
  localStorageLoaded = true;
  syncFromLocalStorageMirror();
}

function syncFromLocalStorageMirror(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(CLIENT_JOBS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, TranslationJob>;
    if (!parsed || typeof parsed !== 'object') return;

    for (const [id, job] of Object.entries(parsed)) {
      if (!job || typeof job !== 'object' || deletedJobIds.has(id)) continue;
      const existing = clientMemoryJobs.get(id);
      if (!existing) {
        clientMemoryJobs.set(id, job);
      } else if (
        !dirtyJobIds.has(id) &&
        new Date(job.updatedAt).getTime() > new Date(existing.updatedAt).getTime()
      ) {
        clientMemoryJobs.set(id, job);
      }
    }
  } catch {
    // Ignore malformed localStorage cache
  }
}

function persistLocalStorageMirror(priorityJobId?: string): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

  const sortedJobs = Array.from(clientMemoryJobs.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (sortedJobs.length === 0) {
    try {
      localStorage.removeItem(CLIENT_JOBS_STORAGE_KEY);
    } catch {
      // Ignore
    }
    return;
  }

  for (
    let limit = Math.min(sortedJobs.length, MAX_LOCAL_MIRROR_JOBS);
    limit >= 1;
    limit--
  ) {
    try {
      const subset: Record<string, TranslationJob> = {};
      const selected = sortedJobs.slice(0, limit);
      if (
        priorityJobId &&
        !selected.some((j) => j.id === priorityJobId) &&
        clientMemoryJobs.has(priorityJobId)
      ) {
        selected[selected.length - 1] = clientMemoryJobs.get(priorityJobId)!;
      }
      for (const j of selected) {
        subset[j.id] = j;
      }
      localStorage.setItem(CLIENT_JOBS_STORAGE_KEY, JSON.stringify(subset));
      return;
    } catch {
      // Quota exceeded; retry with fewer cached mirror jobs (IndexedDB holds full history)
    }
  }

  try {
    localStorage.removeItem(CLIENT_JOBS_STORAGE_KEY);
  } catch {
    // Ignore cleanup failure
  }
}

function getSafeActiveJobId(): string | undefined {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return undefined;
  }
  try {
    return localStorage.getItem(ACTIVE_JOB_ID_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function hydrateClientJobsFromIndexedDB(): Promise<void> {
  if (idbHydrationPromise) return idbHydrationPromise;

  ensureLocalStorageLoaded();
  const idb = getIndexedDbFactory();
  if (!idb) {
    idbHydrationPromise = Promise.resolve();
    return idbHydrationPromise;
  }

  idbHydrationPromise = (async () => {
    const storedJobs = await runIdbTransaction('readonly', (store) =>
      idbRequestToPromise(store.getAll() as IDBRequest<TranslationJob[]>)
    );
    if (!Array.isArray(storedJobs)) return;

    const idbById = new Map<string, TranslationJob>();
    for (const item of storedJobs) {
      if (item && typeof item.id === 'string') {
        idbById.set(item.id, item);
      }
    }

    let memoryChanged = false;
    const jobsToPutInIdb: TranslationJob[] = [];
    const idsToDeleteFromIdb: string[] = [];

    for (const [id, idbJob] of idbById.entries()) {
      if (deletedJobIds.has(id)) {
        idsToDeleteFromIdb.push(id);
        continue;
      }

      const memJob = clientMemoryJobs.get(id);
      if (!memJob) {
        clientMemoryJobs.set(id, idbJob);
        memoryChanged = true;
      } else {
        const memTs = new Date(memJob.updatedAt).getTime();
        const idbTs = new Date(idbJob.updatedAt).getTime();
        if (!dirtyJobIds.has(id) && idbTs > memTs) {
          clientMemoryJobs.set(id, idbJob);
          memoryChanged = true;
        } else if (memTs > idbTs) {
          jobsToPutInIdb.push(cloneJobForStorage(memJob));
        }
      }
    }

    // Backfill any legacy localStorage-only jobs into IndexedDB
    for (const [id, memJob] of clientMemoryJobs.entries()) {
      if (!idbById.has(id) && !deletedJobIds.has(id)) {
        jobsToPutInIdb.push(cloneJobForStorage(memJob));
      }
    }

    // Prune oldest jobs beyond MAX_IDB_STORED_JOBS while keeping active job intact
    const activeId = getSafeActiveJobId();
    const sorted = Array.from(clientMemoryJobs.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    if (sorted.length > MAX_IDB_STORED_JOBS) {
      let remaining = sorted.length;
      for (let i = sorted.length - 1; i >= 0 && remaining > MAX_IDB_STORED_JOBS; i--) {
        const candidate = sorted[i];
        if (candidate.id === activeId) continue;
        clientMemoryJobs.delete(candidate.id);
        idsToDeleteFromIdb.push(candidate.id);
        remaining -= 1;
        memoryChanged = true;
      }
    }

    if (jobsToPutInIdb.length > 0 || idsToDeleteFromIdb.length > 0) {
      enqueueIdbOperation(async () => {
        await runIdbTransaction('readwrite', (store) => {
          for (const j of jobsToPutInIdb) {
            store.put(j);
          }
          for (const id of idsToDeleteFromIdb) {
            store.delete(id);
          }
        });
      });
    }

    if (memoryChanged) {
      notifyClientJobStoreChange();
    }
  })().catch(() => {
    // Allow retries only if catastrophic error before DB open isn't stuck, or keep fallback
  });

  return idbHydrationPromise;
}

export async function flushClientJobPersistence(): Promise<void> {
  if (idbHydrationPromise) {
    await idbHydrationPromise;
  }
  await idbWriteQueue;
}

export function resetClientJobStoreForTesting(): void {
  clientMemoryJobs.clear();
  dirtyJobIds.clear();
  deletedJobIds.clear();
  localStorageLoaded = false;
  idbHydrationPromise = null;
  idbWriteQueue = Promise.resolve();
  clientStoreVersion = 0;
  cachedSummariesVersion = -1;
  cachedSummariesValue = EMPTY_SUMMARIES;
  cachedActiveJobVersion = -1;
  cachedActiveJobValue = null;
}

export function subscribeClientJobs(listener: () => void): () => void {
  clientJobListeners.add(listener);
  if (typeof window !== 'undefined') {
    void hydrateClientJobsFromIndexedDB();
    const onStorage = (e: StorageEvent) => {
      if (e.key === CLIENT_JOBS_STORAGE_KEY) {
        syncFromLocalStorageMirror();
        notifyClientJobStoreChange();
      } else if (e.key === ACTIVE_JOB_ID_KEY) {
        notifyClientJobStoreChange();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clientJobListeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }
  return () => {
    clientJobListeners.delete(listener);
  };
}

export function getClientJobSummariesSnapshot(): JobSummary[] {
  if (typeof window === 'undefined') return EMPTY_SUMMARIES;
  if (cachedSummariesVersion !== clientStoreVersion) {
    cachedSummariesValue = listClientJobSummaries();
    cachedSummariesVersion = clientStoreVersion;
  }
  return cachedSummariesValue;
}

export function getServerJobSummariesSnapshot(): JobSummary[] {
  return EMPTY_SUMMARIES;
}

export function getLastActiveClientJobSnapshot(): TranslationJob | null {
  if (typeof window === 'undefined') return null;
  if (cachedActiveJobVersion !== clientStoreVersion) {
    cachedActiveJobValue = getLastActiveClientJob();
    cachedActiveJobVersion = clientStoreVersion;
  }
  return cachedActiveJobValue;
}

export function getServerActiveJobSnapshot(): TranslationJob | null {
  return null;
}

export function saveClientJob(job: TranslationJob): TranslationJob {
  ensureLocalStorageLoaded();
  job.updatedAt = new Date().toISOString();
  deletedJobIds.delete(job.id);
  dirtyJobIds.add(job.id);
  clientMemoryJobs.set(job.id, job);

  persistLocalStorageMirror(job.id);

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(ACTIVE_JOB_ID_KEY, job.id);
    } catch {
      // Ignore
    }
  }

  const snapshot = cloneJobForStorage(job);
  enqueueIdbOperation(async () => {
    await runIdbTransaction('readwrite', (store) => {
      store.put(snapshot);
    });
  });

  notifyClientJobStoreChange();
  return job;
}

export function getClientJob(jobId: string): TranslationJob | null {
  ensureLocalStorageLoaded();
  if (deletedJobIds.has(jobId)) return null;
  return clientMemoryJobs.get(jobId) || null;
}

export function getLastActiveClientJob(): TranslationJob | null {
  if (typeof window === 'undefined') return null;
  ensureLocalStorageLoaded();
  try {
    const activeId = getSafeActiveJobId();
    if (!activeId) return null;
    const job = getClientJob(activeId);
    if (!job) {
      // Wait for async IndexedDB hydration before clearing activeId unless explicitly deleted
      if (deletedJobIds.has(activeId)) {
        localStorage.removeItem(ACTIVE_JOB_ID_KEY);
      }
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

export function deleteClientJob(jobId: string): void {
  ensureLocalStorageLoaded();
  dirtyJobIds.delete(jobId);
  deletedJobIds.add(jobId);
  clientMemoryJobs.delete(jobId);
  persistLocalStorageMirror();

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      if (localStorage.getItem(ACTIVE_JOB_ID_KEY) === jobId) {
        localStorage.removeItem(ACTIVE_JOB_ID_KEY);
      }
    } catch {
      // Ignore
    }
  }

  enqueueIdbOperation(async () => {
    await runIdbTransaction('readwrite', (store) => {
      store.delete(jobId);
    });
  });

  notifyClientJobStoreChange();
}

export function listClientJobSummaries(): JobSummary[] {
  ensureLocalStorageLoaded();

  const summaries: JobSummary[] = Array.from(clientMemoryJobs.values()).map((job) => ({
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
