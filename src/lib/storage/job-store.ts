import fs from 'fs';
import path from 'path';
import type { JobSummary, PipelineStage, TranslationJob } from '@/types/subtitle';

const JOBS_DIR = path.join(process.cwd(), 'data', 'jobs');

// In-memory cache to avoid Windows NTFS file-lock contention during concurrent polling & batch checkpointing
const memoryJobs = new Map<string, TranslationJob>();

function ensureJobsDir(): void {
  if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  }
}

function getJobFilePath(jobId: string): string {
  // Sanitize jobId to prevent path traversal
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(JOBS_DIR, `${safeId}.json`);
}

export function saveJob(job: TranslationJob): TranslationJob {
  ensureJobsDir();
  job.updatedAt = new Date().toISOString();
  memoryJobs.set(job.id, job);

  const filePath = getJobFilePath(job.id);
  const serialized = JSON.stringify(job, null, 2);

  // Write to disk with Windows EPERM/EBUSY resilience so concurrent reads or AV scans never crash the pipeline
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fs.writeFileSync(filePath, serialized, 'utf8');
      break;
    } catch {
      // If locked on attempt 1-2, retry or keep in-memory state until next batch save
    }
  }

  return job;
}

export function getJob(jobId: string): TranslationJob | null {
  const cached = memoryJobs.get(jobId);
  if (cached) {
    return cached;
  }

  ensureJobsDir();
  const filePath = getJobFilePath(jobId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as TranslationJob;
    memoryJobs.set(jobId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function deleteJob(jobId: string): boolean {
  memoryJobs.delete(jobId);
  ensureJobsDir();
  const filePath = getJobFilePath(jobId);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function listJobSummaries(): JobSummary[] {
  ensureJobsDir();
  cleanupExpiredJobs();

  const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.json'));
  const summaries: JobSummary[] = [];

  for (const file of files) {
    try {
      const idFromFile = file.replace(/\.json$/, '');
      const job =
        memoryJobs.get(idFromFile) ||
        (JSON.parse(
          fs.readFileSync(path.join(JOBS_DIR, file), 'utf8')
        ) as TranslationJob);

      summaries.push({
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
      });
    } catch {
      // Skip malformed file
    }
  }

  return summaries.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function appendJobLog(
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

/**
 * Deletes job files older than JOB_RETENTION_HOURS (default 48 hours).
 */
export function cleanupExpiredJobs(): number {
  ensureJobsDir();
  const retentionHours = Number(process.env.JOB_RETENTION_HOURS || 48);
  const maxAgeMs = retentionHours * 3600 * 1000;
  const now = Date.now();
  let deleted = 0;

  try {
    const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const fullPath = path.join(JOBS_DIR, file);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        const idFromFile = file.replace(/\.json$/, '');
        memoryJobs.delete(idFromFile);
        fs.unlinkSync(fullPath);
        deleted++;
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  return deleted;
}
