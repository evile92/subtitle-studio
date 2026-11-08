import { NextRequest, NextResponse } from 'next/server';
import { regenerateSingleSubtitleEntry } from '@/lib/translation/pipeline';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rate = checkRateLimit(req, 'job-regenerate', 40);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const { id } = await context.params;
  try {
    const body = await req.json();
    const sequence = Number(body.sequence);
    const customInstruction =
      typeof body.customInstruction === 'string'
        ? body.customInstruction.trim()
        : undefined;

    if (!sequence || isNaN(sequence)) {
      return NextResponse.json(
        { error: 'Valid subtitle sequence number is required.' },
        { status: 400 }
      );
    }

    const result = await regenerateSingleSubtitleEntry({
      jobId: id,
      sequence,
      customInstruction,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to regenerate subtitle entry';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
