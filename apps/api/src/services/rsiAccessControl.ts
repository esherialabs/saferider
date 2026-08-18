import { createHmac } from 'node:crypto';

import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { redis } from '../plugins/redis.js';

export function fingerprintRsiPrincipal(userId: string): string {
  return createHmac('sha256', env.authJwtSecret).update(`rsi-operator:${userId}`).digest('hex');
}

export async function enforceRsiRateLimit(params: {
  principalFingerprint: string;
  action: 'signal' | 'read' | 'export';
  requestsPerMinute: number;
}): Promise<void> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `saferide:rsi-rate:${params.action}:${minute}:${params.principalFingerprint}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 120);
    if (count > params.requestsPerMinute) {
      throw new AppError(429, 'rate_limited', 'RSI request rate limit exceeded');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'service_unavailable', 'RSI rate-limit enforcement is unavailable');
  }
}
