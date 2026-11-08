import { NextRequest } from 'next/server';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export function checkRateLimit(
  req: NextRequest,
  keyPrefix: string = 'api',
  maxRequests: number = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120),
  windowMs: number = 60 * 1000
): RateLimitResult {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  const bucketKey = `${keyPrefix}:${ip}`;
  const now = Date.now();

  let bucket = buckets.get(bucketKey);
  if (!bucket || now >= bucket.resetAt) {
    bucket = {
      count: 1,
      resetAt: now + windowMs,
    };
    buckets.set(bucketKey, bucket);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetInSeconds: Math.ceil(windowMs / 1000),
    };
  }

  bucket.count += 1;
  const remaining = Math.max(0, maxRequests - bucket.count);
  const resetInSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return {
    allowed: bucket.count <= maxRequests,
    remaining,
    resetInSeconds,
  };
}
