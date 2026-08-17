'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { after } from 'next/server';

import { NewUser } from './definitions';
import {
  createDecoyVerificationChallengeId,
  deleteExpiredEmailVerificationData,
} from './auth/email-verification';
import { setEmailVerificationChallengeCookie } from './auth/email-verification-cookie';
import { issuePendingRegistrationVerification } from './auth/email-verification-flow';
import { getClientIpHash, hashRateLimitKey } from './auth/security';
import {
  deleteExpiredAuthRateLimitData,
  recordAccountCreationRequest,
} from './auth/auth-rate-limit';
import { getNewPasswordRejection } from './auth/compromised-password';
import { hashPassword } from './auth/password-hash';
import { recordSecurityEvent } from './auth/security-events';
import {
  createLoginErrorState,
  getLoginEmail,
  type LoginState,
} from './auth/login';
import {
  createSignUpErrorState,
  getSignUpInput,
  signUpSchema,
  type SignUpState,
} from './auth/sign-up';

const AUTHENTICATED_HOME = '/dashboard';

function redirectToAuthenticatedHome(formData: FormData) {
  formData.set('redirectTo', AUTHENTICATED_HOME);
  return formData;
}

export async function authenticate(
  prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = getLoginEmail(formData);

  try {
    await signIn('credentials', redirectToAuthenticatedHome(formData));
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return createLoginErrorState(
            email,
            'Either Email Address or Password were incorrect.',
          );
        default:
          return createLoginErrorState(email, 'Something went wrong.');
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
  prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const potentialUser = getSignUpInput(formData);
  const parsedCredentials = signUpSchema.safeParse(potentialUser);

  if (!parsedCredentials.success) {
    return createSignUpErrorState(
      prevState,
      potentialUser,
      parsedCredentials.error.issues[0]?.message ?? 'Check your details.',
    );
  }

  const user: NewUser = {
    first_name: parsedCredentials.data.first_name,
    last_name: parsedCredentials.data.last_name,
    email: parsedCredentials.data.email,
    password: parsedCredentials.data.password,
  };
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
    return createSignUpErrorState(prevState, potentialUser, passwordRejection);
  }

  try {
    const passwordHash = await hashPassword(user.password);
    challengeId = await issuePendingRegistrationVerification({
      registration: {
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        passwordHash,
      },
      ipHash,
    });
    recordSecurityEvent('signup.attempt', 'success', {
      registrationPending: true,
    });
  } catch (error) {
    console.error('Account creation failed:', error);
    recordSecurityEvent('signup.attempt', 'failure');
    return createSignUpErrorState(
      prevState,
      potentialUser,
      'We could not create your account. Please try again.',
    );
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
