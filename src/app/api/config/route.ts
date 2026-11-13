import { NextRequest, NextResponse } from 'next/server';
import { getPublicAIConfigState } from '@/lib/ai/providers';
import { checkRateLimit } from '@/lib/security/rate-limiter';

// Read-only configuration endpoint: BYOK keys live strictly in browser localStorage
// and are passed transiently per translation request without server-side persistence.
export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, 'config-get', 120);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429 }
    );
  }

  const config = getPublicAIConfigState();
  return NextResponse.json(config);
}
