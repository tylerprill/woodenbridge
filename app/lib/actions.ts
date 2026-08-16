'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
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
import { getClientIpHash } from './auth/security';

const AUTHENTICATED_HOME = '/dashboard';

function redirectToAuthenticatedHome(formData: FormData) {
  formData.set('redirectTo', AUTHENTICATED_HOME);
  return formData;
}

function redirectToEmailVerification(formData: FormData) {
  formData.set('redirectTo', '/verify-email?sent=1');
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
      first_name: z.string().trim().min(1, 'Enter your first name.'),
      last_name: z.string().trim().min(1, 'Enter your last name.'),
      email: z
        .string()
        .trim()
        .email('Enter a valid email address.')
        .transform(normalizeEmail),
      password: newPasswordSchema,
    })
    .safeParse(potentialUser);

  if (!parsedCredentials.success) {
    return parsedCredentials.error.issues[0]?.message ?? 'Check your details.';
  }

  const user = parsedCredentials.data as NewUser;
  const existingUser = await getUser(user.email);

  if (existingUser) {
    return 'An account already exists for this email address.';
  }

  formData.set('first_name', user.first_name);
  formData.set('last_name', user.last_name);
  formData.set('email', user.email);

  const createdUser = await addUser(user);

  if (!createdUser) {
    return 'An account already exists for this email address.';
  }

  let challengeId = createDecoyVerificationChallengeId();

  try {
    challengeId = await issueEmailVerification({
      email: user.email,
      ipHash: await getClientIpHash(),
      user: {
        id: createdUser.id,
        email: user.email,
        first_name: user.first_name,
        email_verified_at: null,
      },
    });
  } catch (error) {
    console.error('Initial email verification delivery failed:', error);
  }

  await setEmailVerificationChallengeCookie(challengeId);
  after(async () => {
    await deleteExpiredEmailVerificationData().catch((error) => {
      console.error('Email verification cleanup failed:', error);
    });
  });

  await signIn('credentials', redirectToEmailVerification(formData));
}
