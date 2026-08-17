import 'server-only';

import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { getAuthenticationHmacSecret } from './secrets';

export function hashRateLimitKey(value: string) {
  return createHmac('sha256', getAuthenticationHmacSecret())
    .update(`rate-limit:v1:${value}`)
    .digest('hex');
}

export function hashEmailVerificationCode(challengeId: string, code: string) {
  return createHmac('sha256', getAuthenticationHmacSecret())
    .update(`verify-email:v1:${challengeId}:${code}`)
    .digest('hex');
}

export async function getClientIpHash() {
  const requestHeaders = await headers();
  const forwardedFor =
    requestHeaders.get('x-vercel-forwarded-for') ??
    requestHeaders.get('x-forwarded-for');
  const clientIp =
    forwardedFor?.split(',')[0]?.trim() ||
    requestHeaders.get('x-real-ip') ||
    'unknown';

  return hashRateLimitKey(`ip:${clientIp}`);
}
