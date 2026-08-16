'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';

import { z } from 'zod';

import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from '@/app/lib/auth/recovery-email';
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  deleteExpiredPasswordResetData,
  findRecoveryUser,
  hashResetToken,
  invalidatePasswordResetToken,
  recordPasswordResetAttempt,
  recordPasswordResetRequest,
} from '@/app/lib/auth/reset-password';
import { newPasswordSchema, normalizeEmail } from '@/app/lib/auth/password';
import { getClientIpHash, hashRateLimitKey } from '@/app/lib/auth/security';
import { getNewPasswordRejection } from '@/app/lib/auth/compromised-password';
import { hashPassword } from '@/app/lib/auth/password-hash';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';

const GENERIC_RECOVERY_MESSAGE =
  'If an account exists for that address, a password reset link is on its way. It will expire in 30 minutes.';

export type PasswordResetState =
  { status: 'error' | 'success'; message: string } | undefined;

export async function requestPasswordReset(
  previousState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsedEmail = z
    .string()
    .trim()
    .max(254)
    .email('Enter a valid email address.')
    .safeParse(formData.get('email'));

  if (!parsedEmail.success) {
    return {
      status: 'error',
      message:
        parsedEmail.error.issues[0]?.message ?? 'Check your email address.',
    };
  }

  const email = normalizeEmail(parsedEmail.data);

  try {
    const emailHash = hashRateLimitKey(`email:${email}`);
    const ipHash = await getClientIpHash();
    const allowed = await recordPasswordResetRequest(emailHash, ipHash);

    after(async () => {
      try {
        if (allowed) {
          const user = await findRecoveryUser(email);

          if (user) {
            const { token, tokenHash } = await createPasswordResetToken(
              user.id,
            );

            try {
              await sendPasswordResetEmail({
                to: user.email,
                firstName: user.first_name,
                token,
                tokenHash,
              });
            } catch (error) {
              await invalidatePasswordResetToken(tokenHash);
              throw error;
            }
          }
        }
      } catch (error) {
        console.error('Password reset delivery failed:', error);
      } finally {
        await deleteExpiredPasswordResetData().catch((error) => {
          console.error('Password recovery cleanup failed:', error);
        });
      }
    });
  } catch (error) {
    console.error('Password reset request failed:', error);
  }

  return { status: 'success', message: GENERIC_RECOVERY_MESSAGE };
}

export async function resetPassword(
  previousState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsedInput = z
    .object({
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      password: newPasswordSchema,
      confirmPassword: z.string(),
    })
    .refine((values) => values.password === values.confirmPassword, {
      path: ['confirmPassword'],
      message: 'The passwords do not match.',
    })
    .safeParse({
      token: formData.get('token'),
      password: formData.get('password'),
      confirmPassword: formData.get('confirmPassword'),
    });

  if (!parsedInput.success) {
    return {
      status: 'error',
      message:
        parsedInput.error.issues[0]?.message ?? 'Check your new password.',
    };
  }

  const { token, password } = parsedInput.data;
  const tokenHash = hashResetToken(token);
  const ipHash = await getClientIpHash();

  try {
    const allowed = await recordPasswordResetAttempt(tokenHash, ipHash);

    if (!allowed) {
      recordSecurityEvent('password.reset', 'limited');
      return {
        status: 'error',
        message: 'This reset link is invalid or expired. Request a new one.',
      };
    }

    const passwordRejection = await getNewPasswordRejection(password);

    if (passwordRejection) {
      return { status: 'error', message: passwordRejection };
    }

    const hashedPassword = await hashPassword(password);
    const user = await consumePasswordResetToken(token, hashedPassword);

    if (!user) {
      recordSecurityEvent('password.reset', 'failure');
      return {
        status: 'error',
        message: 'This reset link is invalid or expired. Request a new one.',
      };
    }

    try {
      await sendPasswordChangedEmail({
        to: user.email,
        firstName: user.first_name,
        changeId: tokenHash,
      });
    } catch (error) {
      console.error('Password change confirmation email failed:', error);
    }
    recordSecurityEvent('password.reset', 'success');
  } catch (error) {
    console.error('Password reset failed:', error);
    return {
      status: 'error',
      message: 'We could not reset your password. Please request a new link.',
    };
  }

  redirect('/login?reset=success');
}
