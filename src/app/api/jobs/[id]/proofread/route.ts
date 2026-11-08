import { NextRequest, NextResponse } from 'next/server';
import { proofreadSubtitleJob } from '@/lib/translation/proofreader';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rate = checkRateLimit(req, 'job-proofread', 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  const { id } = await context.params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = body.scope === 'all' ? 'all' : 'smart';
    const sequences = Array.isArray(body.sequences)
      ? body.sequences.map(Number).filter((n: number) => !isNaN(n))
      : undefined;

    const result = await proofreadSubtitleJob({
      jobId: id,
      scope,
      sequences,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to proofread subtitle job';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
