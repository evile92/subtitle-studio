import { NextRequest, NextResponse } from 'next/server';
import { deleteJob, getJob, saveJob } from '@/lib/storage/job-store';
import { validateAndRepairTranslations } from '@/lib/translation/validator';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { GlossaryItem } from '@/types/subtitle';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rate = checkRateLimit(req, 'job-get', 240);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Translation job not found.' }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rate = checkRateLimit(req, 'job-patch', 120);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Translation job not found.' }, { status: 404 });
  }

  try {
    const body = await req.json();

    // Update one or more subtitle entries (manual editing or restoring AI translation)
    if (Array.isArray(body.updatedEntries)) {
      const updatesBySeq = new Map<
        number,
        { translatedText: string; isEditedByUser?: boolean; restoreAi?: boolean }
      >();

      for (const item of body.updatedEntries) {
        if (typeof item.sequence === 'number') {
          updatesBySeq.set(item.sequence, item);
        }
      }

      for (const entry of job.entries) {
        const upd = updatesBySeq.get(entry.sequence);
        if (!upd) continue;

        if (upd.restoreAi && entry.aiTranslatedText) {
          entry.translatedText = entry.aiTranslatedText;
          entry.isEditedByUser = false;
          entry.status = 'translated';
        } else if (typeof upd.translatedText === 'string') {
          entry.translatedText = upd.translatedText;
          entry.isEditedByUser = upd.isEditedByUser ?? true;
          entry.status = entry.isEditedByUser ? 'edited' : 'translated';
        }
      }
    }

    // Update glossary if provided
    if (Array.isArray(body.glossary)) {
      job.glossary = body.glossary as GlossaryItem[];
    }

    // Re-validate SRT integrity & update report
    const effectiveSourceLang =
      job.sourceLanguage === 'auto'
        ? job.detectedSourceLanguage || 'en'
        : job.sourceLanguage;

    const qaResult = validateAndRepairTranslations({
      originalEntries: job.entries,
      translatedEntries: job.entries,
      glossary: job.glossary,
      sourceLanguage: effectiveSourceLang,
      targetLanguage: job.targetLanguage,
    });

    job.entries = qaResult.repairedEntries;
    job.validationReport = qaResult.report;
    job.translatedCount = qaResult.report.translatedEntryCount;

    saveJob(job);
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update job';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rate = checkRateLimit(req, 'job-delete', 60);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const { id } = await context.params;
  const deleted = deleteJob(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
