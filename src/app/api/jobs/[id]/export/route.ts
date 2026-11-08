import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/storage/job-store';
import { formatSrtContent } from '@/lib/srt/formatter';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rate = checkRateLimit(req, 'job-export', 60);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Translation job not found.' }, { status: 404 });
  }

  const url = new URL(req.url);
  const useBom = url.searchParams.get('bom') === 'true';
  const bilingual = url.searchParams.get('bilingual') === 'true';
  const useCrlf = url.searchParams.get('crlf') === 'true';

  const srtContent = formatSrtContent(job.entries, {
    useBom,
    bilingual,
    lineEnding: useCrlf ? '\r\n' : '\n',
    fallbackToOriginal: true,
  });

  const baseName = job.fileName.replace(/\.srt$/i, '');
  const langSuffix =
    job.targetLanguage === 'ar' && job.arabicDialect && job.arabicDialect !== 'msa'
      ? `ar-${job.arabicDialect}`
      : job.targetLanguage;
  const modeSuffix = bilingual ? `.bilingual.${langSuffix}` : `.${langSuffix}`;
  const downloadFileName = `${baseName}${modeSuffix}.srt`;

  return new NextResponse(srtContent, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-subrip; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadFileName)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
