'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { after } from 'next/server';

import { z } from 'zod';
import { getUser, addUser } from './data';
import { NewUser } from './definitions';
import {
  createDecoyVerificationChallengeId,
  deleteExpiredEmailVerificationData,
} from './auth/email-verification';
import { setEmailVerificationChallengeCookie } from './auth/email-verification-cookie';
import { issueEmailVerification } from './auth/email-verification-flow';
import { newPasswordSchema, normalizeEmail } from './auth/password';
import { getClientIpHash, hashRateLimitKey } from './auth/security';
import {
  deleteExpiredAuthRateLimitData,
  recordAccountCreationRequest,
} from './auth/auth-rate-limit';
import { getNewPasswordRejection } from './auth/compromised-password';
import { hashPassword } from './auth/password-hash';
import { recordSecurityEvent } from './auth/security-events';

const AUTHENTICATED_HOME = '/dashboard';

function redirectToAuthenticatedHome(formData: FormData) {
  formData.set('redirectTo', AUTHENTICATED_HOME);
  return formData;
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn('credentials', redirectToAuthenticatedHome(formData));
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Either Email Address or Password were incorrect.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  } finally {
    after(async () => {
      await deleteExpiredAuthRateLimitData().catch((error) => {
        console.error('Authentication rate-limit cleanup failed:', error);
      });
    });
  }
}

export async function createUser(
  prevState: string | undefined,
  formData: FormData,
) {
  const potentialUser = {
    first_name: String(formData.get('first_name') ?? ''),
    last_name: String(formData.get('last_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  };

  const parsedCredentials = z
    .object({
      first_name: z
        .string()
        .trim()
        .min(1, 'Enter your first name.')
        .max(100, 'Use no more than 100 characters for your first name.'),
      last_name: z
        .string()
        .trim()
        .min(1, 'Enter your last name.')
        .max(100, 'Use no more than 100 characters for your last name.'),
      email: z
        .string()
        .trim()
        .max(254, 'Enter a valid email address.')
        .email('Enter a valid email address.')
        .transform(normalizeEmail),
      password: newPasswordSchema,
    })
    .safeParse(potentialUser);

  if (!parsedCredentials.success) {
    return parsedCredentials.error.issues[0]?.message ?? 'Check your details.';
  }

  const user = parsedCredentials.data as NewUser;
  const emailHash = hashRateLimitKey(`email:${user.email}`);
  const ipHash = await getClientIpHash();
  let challengeId = createDecoyVerificationChallengeId();
  let allowed = false;

  try {
    allowed = await recordAccountCreationRequest(emailHash, ipHash);
  } catch (error) {
    console.error('Signup rate-limit check failed:', error);
  }

  if (!allowed) {
    recordSecurityEvent('signup.rate_limited', 'limited');
    await setEmailVerificationChallengeCookie(challengeId);
    redirect('/verify-email?sent=1');
  }

  const passwordRejection = await getNewPasswordRejection(user.password, {
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
  });

  if (passwordRejection) {
    return passwordRejection;
  }

  try {
    const passwordHash = await hashPassword(user.password);
    const createdUser = await addUser(user, passwordHash);
    const verificationUser = createdUser
      ? {
          id: createdUser.id,
          email: user.email,
          first_name: user.first_name,
          email_verified_at: null,
        }
      : await getUser(user.email);

    challengeId = await issueEmailVerification({
      email: user.email,
      ipHash,
      user: verificationUser,
    });
    recordSecurityEvent('signup.attempt', 'success', {
      accountCreated: Boolean(createdUser),
    });
  } catch (error) {
    console.error('Account creation failed:', error);
    recordSecurityEvent('signup.attempt', 'failure');
    return 'We could not create your account. Please try again.';
  }

  await setEmailVerificationChallengeCookie(challengeId);
  after(async () => {
    await Promise.all([
      deleteExpiredEmailVerificationData().catch((error) => {
        console.error('Email verification cleanup failed:', error);
      }),
      deleteExpiredAuthRateLimitData().catch((error) => {
        console.error('Authentication rate-limit cleanup failed:', error);
      }),
    ]);
  });

  redirect('/verify-email?sent=1');
}
