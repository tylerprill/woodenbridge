import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { getAuthenticationHmacSecret } from '@/app/lib/auth/secrets';

const EMAIL_VERIFICATION_COOKIE = 'wooden_bridge_email_verification';
const EMAIL_VERIFICATION_COOKIE_MAX_AGE = 60 * 10;
const EMAIL_VERIFICATION_DESTINATION_COOKIE =
  'wooden_bridge_email_verification_destination';
const EMAIL_VERIFICATION_DESTINATION_COOKIE_MAX_AGE = 60 * 10;
const VERIFIED_LOGIN_CHALLENGE_COOKIE =
  'wooden_bridge_verified_login_challenge';
const VERIFIED_LOGIN_CHALLENGE_COOKIE_MAX_AGE = 60 * 5;
const destinationEmailSchema = z.string().trim().max(254).email();

function signDestinationPayload(payload: string) {
  return createHmac('sha256', getAuthenticationHmacSecret())
    .update(`verify-email-destination:v1:${payload}`)
    .digest('base64url');
}

export async function getEmailVerificationChallengeCookie() {
  return (await cookies()).get(EMAIL_VERIFICATION_COOKIE)?.value;
}

export async function setEmailVerificationChallengeCookie(challengeId: string) {
  (await cookies()).set(EMAIL_VERIFICATION_COOKIE, challengeId, {
    httpOnly: true,
    maxAge: EMAIL_VERIFICATION_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearEmailVerificationChallengeCookie() {
  (await cookies()).delete(EMAIL_VERIFICATION_COOKIE);
}

export async function setEmailVerificationDestinationCookie(email: string) {
  const parsedEmail = destinationEmailSchema.parse(email);
  const issuedAt = Math.floor(Date.now() / 1000);
  const encodedEmail = Buffer.from(parsedEmail, 'utf8').toString('base64url');
  const payload = `v1.${issuedAt}.${encodedEmail}`;
  const signature = signDestinationPayload(payload);

  (await cookies()).set(
    EMAIL_VERIFICATION_DESTINATION_COOKIE,
    `${payload}.${signature}`,
    {
      httpOnly: true,
      maxAge: EMAIL_VERIFICATION_DESTINATION_COOKIE_MAX_AGE,
      path: '/',
      priority: 'high',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  );
}

export async function getEmailVerificationDestinationCookie() {
  const value = (await cookies()).get(
    EMAIL_VERIFICATION_DESTINATION_COOKIE,
  )?.value;
  if (!value) return undefined;

  const [version, issuedAtText, encodedEmail, suppliedSignature, ...rest] =
    value.split('.');
  if (
    version !== 'v1' ||
    !/^\d{10}$/.test(issuedAtText ?? '') ||
    !encodedEmail ||
    !suppliedSignature ||
    rest.length
  ) {
    return undefined;
  }

  const issuedAt = Number(issuedAtText);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 60 ||
    now - issuedAt > EMAIL_VERIFICATION_DESTINATION_COOKIE_MAX_AGE
  ) {
    return undefined;
  }

  const payload = `${version}.${issuedAtText}.${encodedEmail}`;
  const expectedSignature = signDestinationPayload(payload);
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return undefined;
  }

  try {
    const email = Buffer.from(encodedEmail, 'base64url').toString('utf8');
    const parsed = destinationEmailSchema.safeParse(email);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function clearEmailVerificationDestinationCookie() {
  (await cookies()).delete(EMAIL_VERIFICATION_DESTINATION_COOKIE);
}

/**
 * Keeps only the opaque, browser-bound challenge reference long enough for the
 * login page to recover the just-verified address. The address itself never
 * appears in the URL, browser history, or a client-readable cookie.
 */
export async function getVerifiedLoginChallengeCookie() {
  return (await cookies()).get(VERIFIED_LOGIN_CHALLENGE_COOKIE)?.value;
}

export async function setVerifiedLoginChallengeCookie(challengeId: string) {
  (await cookies()).set(VERIFIED_LOGIN_CHALLENGE_COOKIE, challengeId, {
    httpOnly: true,
    maxAge: VERIFIED_LOGIN_CHALLENGE_COOKIE_MAX_AGE,
    path: '/',
    priority: 'high',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearVerifiedLoginChallengeCookie() {
  (await cookies()).delete(VERIFIED_LOGIN_CHALLENGE_COOKIE);
}
