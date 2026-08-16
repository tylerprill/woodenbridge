'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth, signOut } from '@/auth';
import {
  clearEmailVerificationChallengeCookie,
  getEmailVerificationChallengeCookie,
  setEmailVerificationChallengeCookie,
} from '@/app/lib/auth/email-verification-cookie';
import {
  createDecoyVerificationChallengeId,
  deleteExpiredEmailVerificationData,
  findEmailVerificationUser,
  findVerificationUserByChallenge,
  verifyEmailCode,
  type EmailVerificationUser,
} from '@/app/lib/auth/email-verification';
import { issueEmailVerification } from '@/app/lib/auth/email-verification-flow';
import { normalizeEmail } from '@/app/lib/auth/password';
import { sendWelcomeEmail } from '@/app/lib/auth/recovery-email';
import { getClientIpHash } from '@/app/lib/auth/security';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';

const GENERIC_VERIFICATION_MESSAGE =
  'If that address has an unverified account, a new code is on its way.';

export type EmailVerificationState =
  { status: 'error' | 'success'; message: string } | undefined;

function scheduleVerificationCleanup() {
  after(async () => {
    await deleteExpiredEmailVerificationData().catch((error) => {
      console.error('Email verification cleanup failed:', error);
    });
  });
}

export async function requestEmailVerification(
  previousState: EmailVerificationState,
  formData: FormData,
): Promise<EmailVerificationState> {
  const session = await auth();
  const pendingSessionEmail =
    session?.user && session.emailVerified === false
      ? session.user.email
      : undefined;
  const parsedEmail = z
    .string()
    .trim()
    .max(254)
    .email('Enter a valid email address.')
    .safeParse(pendingSessionEmail ?? formData.get('email'));

  if (!parsedEmail.success) {
    return {
      status: 'error',
      message:
        parsedEmail.error.issues[0]?.message ?? 'Check your email address.',
    };
  }

  const email = normalizeEmail(parsedEmail.data);
  const ipHash = await getClientIpHash();
  let challengeId = createDecoyVerificationChallengeId();

  try {
    const user = await findEmailVerificationUser(email);
    challengeId = await issueEmailVerification({ email, ipHash, user });
  } catch (error) {
    console.error('Email verification delivery failed:', error);
  }

  await setEmailVerificationChallengeCookie(challengeId);
  scheduleVerificationCleanup();
  redirect('/verify-email?sent=1');
}

export async function resendEmailVerification(
  previousState: EmailVerificationState,
  formData: FormData,
): Promise<EmailVerificationState> {
  const currentChallengeId = await getEmailVerificationChallengeCookie();

  if (!currentChallengeId) {
    return {
      status: 'error',
      message: 'Enter your email address to request a new code.',
    };
  }

  try {
    const user = await findVerificationUserByChallenge(currentChallengeId);

    if (user) {
      const ipHash = await getClientIpHash();
      const nextChallengeId = await issueEmailVerification({
        email: normalizeEmail(user.email),
        ipHash,
        user,
        fallbackChallengeId: currentChallengeId,
      });
      await setEmailVerificationChallengeCookie(nextChallengeId);
    }
  } catch (error) {
    console.error('Email verification resend failed:', error);
  }

  scheduleVerificationCleanup();
  return { status: 'success', message: GENERIC_VERIFICATION_MESSAGE };
}

export async function submitEmailVerificationCode(
  previousState: EmailVerificationState,
  formData: FormData,
): Promise<EmailVerificationState> {
  const parsedCode = z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the six-digit code from your email.')
    .safeParse(formData.get('code'));

  if (!parsedCode.success) {
    return {
      status: 'error',
      message:
        parsedCode.error.issues[0]?.message ??
        'Enter a valid verification code.',
    };
  }

  const challengeId = await getEmailVerificationChallengeCookie();

  if (!challengeId) {
    return {
      status: 'error',
      message:
        'This verification code is invalid or expired. Request a new one.',
    };
  }

  let verifiedUser: EmailVerificationUser | undefined;

  try {
    const ipHash = await getClientIpHash();
    const result = await verifyEmailCode(challengeId, parsedCode.data, ipHash);

    if (result.status !== 'verified') {
      recordSecurityEvent(
        'verification.attempt',
        result.status === 'limited' ? 'limited' : 'failure',
      );
      return {
        status: 'error',
        message:
          result.status === 'limited'
            ? 'Too many attempts. Wait 15 minutes, then request a new code.'
            : 'That code is invalid or expired. Check it and try again.',
      };
    }

    await clearEmailVerificationChallengeCookie();
    verifiedUser = result.user;
    recordSecurityEvent('verification.attempt', 'success');
  } catch (error) {
    console.error('Email verification failed:', error);
    return {
      status: 'error',
      message: 'We could not verify that code. Please try again.',
    };
  }

  if (!verifiedUser) {
    return {
      status: 'error',
      message: 'We could not verify that code. Please try again.',
    };
  }

  after(async () => {
    try {
      await sendWelcomeEmail({
        to: verifiedUser.email,
        firstName: verifiedUser.first_name,
        userId: verifiedUser.id,
      });
    } catch (error) {
      console.error('Welcome email delivery failed:', error);
    }
  });

  const session = await auth();
  const hasMatchingPendingSession = session?.user?.id === verifiedUser.id;
  redirect(
    hasMatchingPendingSession
      ? '/dashboard?verified=success'
      : '/login?verified=success',
  );
}

export async function restartEmailVerification() {
  await clearEmailVerificationChallengeCookie();
  await signOut({ redirectTo: '/verify-email' });
}
