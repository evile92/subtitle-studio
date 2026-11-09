import fs from 'fs';
import path from 'path';
import os from 'os';
import type { JobSummary, PipelineStage, TranslationJob } from '@/types/subtitle';

function getJobsDir(): string {
  // If running in Vercel or AWS Lambda serverless environment, use writable tmpdir
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'subtitle-studio', 'jobs');
  }
  return path.join(process.cwd(), 'data', 'jobs');
}

const JOBS_DIR = getJobsDir();

// In-memory cache to avoid Windows NTFS file-lock contention and ensure serverless persistence within container lifetime
const memoryJobs = new Map<string, TranslationJob>();

function ensureJobsDir(): void {
  try {
    if (!fs.existsSync(JOBS_DIR)) {
      fs.mkdirSync(JOBS_DIR, { recursive: true });
    }
  } catch {
    // Graceful fallback for read-only environments
  }
}

function getJobFilePath(jobId: string): string {
  // Sanitize jobId to prevent path traversal
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(JOBS_DIR, `${safeId}.json`);
}

export function saveJob(job: TranslationJob): TranslationJob {
  job.updatedAt = new Date().toISOString();
  memoryJobs.set(job.id, job);

  try {
    ensureJobsDir();
    const filePath = getJobFilePath(job.id);
    const serialized = JSON.stringify(job, null, 2);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        fs.writeFileSync(filePath, serialized, 'utf8');
        break;
      } catch {
        // If locked on attempt 1-2, retry or keep in-memory state
      }
    }
  } catch {
    // If filesystem is completely unwritable, memoryJobs still serves the job
  }

  return job;
}

export function getJob(jobId: string): TranslationJob | null {
  const cached = memoryJobs.get(jobId);
  if (cached) {
    return cached;
  }

  try {
    ensureJobsDir();
    const filePath = getJobFilePath(jobId);
    if (!fs.existsSync(filePath)) return null;
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
  try {
    ensureJobsDir();
    const filePath = getJobFilePath(jobId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function listJobSummaries(): JobSummary[] {
  try {
    ensureJobsDir();
    cleanupExpiredJobs();
  } catch {
    // Ignore
  }

  const summariesMap = new Map<string, JobSummary>();

  // Add memory jobs first
  for (const [id, job] of memoryJobs.entries()) {
    summariesMap.set(id, {
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
  }

  // Then add from disk files if not already in memory
  try {
    if (fs.existsSync(JOBS_DIR)) {
      const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const idFromFile = file.replace(/\.json$/, '');
          if (summariesMap.has(idFromFile)) continue;
          const job = JSON.parse(
            fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ JOBS_DIR, file), 'utf8')
          ) as TranslationJob;

          summariesMap.set(idFromFile, {
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
    }
  } catch {
    // Ignore filesystem read errors in constrained environments
  }

  return Array.from(summariesMap.values()).sort(
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
  const retentionHours = Number(process.env.JOB_RETENTION_HOURS || 48);
  const maxAgeMs = retentionHours * 3600 * 1000;
  const now = Date.now();
  let deleted = 0;

  try {
    ensureJobsDir();
    if (!fs.existsSync(JOBS_DIR)) return 0;
    const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const fullPath = path.join(/*turbopackIgnore: true*/ JOBS_DIR, file);
      const stat = fs.statSync(/*turbopackIgnore: true*/ fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        const idFromFile = file.replace(/\.json$/, '');
        memoryJobs.delete(idFromFile);
        try {
          fs.unlinkSync(fullPath);
        } catch {
          // Ignore
        }
        deleted++;
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  return deleted;
}
