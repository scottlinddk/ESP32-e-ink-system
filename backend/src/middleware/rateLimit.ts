import { Request, Response, NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type Window = `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`;

// Singleton Redis client — reused across warm function invocations
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    redis = new Redis({ url, token });
  } catch (err) {
    console.warn('[rateLimit] Failed to initialise Redis client — rate limiting disabled:', err);
    return null;
  }
  return redis;
}

function getClientIp(req: Request): string {
  // Vercel sets x-forwarded-for; fall back to socket address
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Creates an Express rate-limit middleware backed by Upstash Redis.
 * If UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set, the
 * middleware is a no-op (all requests pass through) with a one-time warning.
 */
export function createRateLimiter(
  requests: number,
  window: Window,
  message: string,
  prefix: string
) {
  const r = getRedis();

  if (!r) {
    console.warn(
      `[rateLimit] "${prefix}" limiter is disabled — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable it`
    );
    return (_req: Request, _res: Response, next: NextFunction): void => next();
  }

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: `rl:${prefix}`,
    ephemeralCache: new Map(), // per-instance in-process cache reduces Redis round-trips
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req);
    const { success, limit, remaining, reset } = await limiter.limit(ip);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', new Date(reset).toUTCString());

    if (!success) {
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}
