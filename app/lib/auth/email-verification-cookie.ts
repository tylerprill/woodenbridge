import 'server-only';

import { cookies } from 'next/headers';

const EMAIL_VERIFICATION_COOKIE = 'wooden_bridge_email_verification';
const EMAIL_VERIFICATION_COOKIE_MAX_AGE = 60 * 10;

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
