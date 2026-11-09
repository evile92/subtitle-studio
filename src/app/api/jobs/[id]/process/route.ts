import { NextRequest, NextResponse } from 'next/server';
import { getJob, saveJob } from '@/lib/storage/job-store';
import {
  executeTranslationPipeline,
  isJobCurrentlyRunning,
} from '@/lib/translation/pipeline';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rate = checkRateLimit(req, 'job-process', 30);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Translation job not found.' }, { status: 404 });
  }

  if (isJobCurrentlyRunning(id)) {
    return NextResponse.json({ job, running: true });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const runAsync = Boolean(body?.async);

    if (body?.userAIConfig) {
      job.userAIConfig = body.userAIConfig;
      saveJob(job);
    }

    if (runAsync) {
      // Trigger pipeline in background while client polls /api/jobs/[id]
      executeTranslationPipeline(id).catch(() => {
        // Error is already logged and persisted inside executeTranslationPipeline
      });
      return NextResponse.json({ job: getJob(id) || job, started: true });
    }

    const completedJob = await executeTranslationPipeline(id);
    return NextResponse.json({ job: completedJob });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Translation pipeline failed';
    const updatedJob = getJob(id);
    return NextResponse.json(
      { error: message, job: updatedJob },
      { status: 422 }
    );
  }
}
