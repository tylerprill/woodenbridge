'use server';

import { sql } from '@/app/lib/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from 'simplewebauthn-server';

import { loginPasswordSchema } from '@/app/lib/auth/password';
import {
  DUMMY_PASSWORD_HASH,
  verifyPassword,
} from '@/app/lib/auth/password-hash';
import {
  beginPasskeyRegistrationCeremony,
  beginPasskeyStepUpCeremony,
  completePasskeyReauthenticationAttempt,
  completePasskeyRegistrationCeremony,
  completePasskeyStepUpCeremony,
  PasskeyCapacityError,
  removeUserPasskey,
  reservePasskeyReauthenticationAttempt,
} from '@/app/lib/auth/passkeys';
import { hasUserPasskey } from '@/app/lib/auth/passkey-state';
import { issueInitialRecoveryCodes } from '@/app/lib/auth/recovery-codes';
import { hasRequiredRole } from '@/app/lib/auth/roles';
import { getClientIpHash } from '@/app/lib/auth/security';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import { scheduleSecurityNotificationDelivery } from '@/app/lib/auth/security-notification-scheduler';
import {
  requireRecentPasskeyStepUp,
  requireVerifiedSession,
} from '@/app/lib/auth/session';

const passkeyLabelSchema = z
  .string()
  .trim()
  .min(1, 'Name this passkey.')
  .max(80, 'Keep the passkey name under 80 characters.');
const passkeyIdSchema = z.string().uuid();

const registrationResponseSchema = z
  .object({
    id: z.string().min(1).max(2_048),
    rawId: z.string().min(1).max(2_048),
    type: z.literal('public-key'),
    response: z
      .object({
        attestationObject: z.string().min(1).max(64_000),
        clientDataJSON: z.string().min(1).max(16_000),
        transports: z.array(z.string().max(32)).max(12).optional(),
      })
      .passthrough(),
    clientExtensionResults: z.record(z.unknown()).optional(),
    authenticatorAttachment: z.string().max(64).nullable().optional(),
  })
  .passthrough();

const authenticationResponseSchema = z
  .object({
    id: z.string().min(1).max(2_048),
    rawId: z.string().min(1).max(2_048),
    type: z.literal('public-key'),
    response: z
      .object({
        authenticatorData: z.string().min(1).max(16_000),
        clientDataJSON: z.string().min(1).max(16_000),
        signature: z.string().min(1).max(16_000),
        userHandle: z.string().max(2_048).nullable().optional(),
      })
      .passthrough(),
    clientExtensionResults: z.record(z.unknown()).optional(),
    authenticatorAttachment: z.string().max(64).nullable().optional(),
  })
  .passthrough();

type PasskeyActionError = {
  status: 'error';
  message: string;
};

function actionError(message: string): PasskeyActionError {
  return { status: 'error', message };
}

async function verifyCurrentPasswordForPasskeyChange({
  userId,
  sessionReference,
  passwordInput,
}: {
  userId: string;
  sessionReference: string;
  passwordInput: unknown;
}) {
  const parsedPassword = loginPasswordSchema.safeParse(passwordInput);

  if (!parsedPassword.success) return 'invalid' as const;

  const ipHash = await getClientIpHash();
  const attemptId = await reservePasskeyReauthenticationAttempt({
    userId,
    sessionReference,
    ipHash,
  });

  if (!attemptId) return 'limited' as const;

  const result = await sql<{ password: string }>`
    SELECT password
    FROM users
    WHERE id = ${userId}
      AND email_verified_at IS NOT NULL
      AND account_status = 'active'
    LIMIT 1
  `;
  const passwordHash = result.rows[0]?.password ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(
    passwordHash,
    parsedPassword.data,
  );

  await completePasskeyReauthenticationAttempt({
    attemptId,
    sessionReference,
    successful: Boolean(result.rows[0] && passwordMatches),
  });

  return result.rows[0] && passwordMatches
    ? ('success' as const)
    : ('incorrect' as const);
}

export async function beginPasskeyRegistration(passwordInput: unknown): Promise<
  | PasskeyActionError
  | {
      status: 'success';
      options: Awaited<ReturnType<typeof beginPasskeyRegistrationCeremony>>;
    }
> {
  let session = await requireVerifiedSession();
  let reauthentication;

  if (!hasRequiredRole(session.role, 'admin')) {
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'privileged_role_required',
    });
    return actionError(
      'Passkeys protect owner and administrator management actions.',
    );
  }

  if (await hasUserPasskey(session.user.id)) {
    session = await requireRecentPasskeyStepUp('/dashboard/security');
  }

  try {
    reauthentication = await verifyCurrentPasswordForPasskeyChange({
      userId: session.user.id,
      sessionReference: session.sessionReference,
      passwordInput,
    });
  } catch (error) {
    console.error('Passkey password confirmation failed:', error);
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'password_check_unavailable',
    });
    return actionError('We could not confirm your password. Please try again.');
  }

  if (reauthentication === 'limited') {
    recordSecurityEvent('passkey.enrollment', 'limited', {
      actorUserId: session.user.id,
    });
    return actionError('Too many attempts. Wait 15 minutes and try again.');
  }

  if (reauthentication === 'invalid') {
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'invalid_password_input',
    });
    return actionError('Enter your current password to continue.');
  }

  if (reauthentication === 'incorrect') {
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'incorrect_password',
    });
    return actionError('Your current password was not correct.');
  }

  try {
    const options = await beginPasskeyRegistrationCeremony({
      userId: session.user.id,
      sessionReference: session.sessionReference,
    });
    return { status: 'success', options };
  } catch (error) {
    if (error instanceof PasskeyCapacityError) {
      recordSecurityEvent('passkey.enrollment', 'limited', {
        actorUserId: session.user.id,
        reason: 'credential_capacity',
      });
      return actionError(error.message);
    }

    console.error('Passkey registration could not begin:', error);
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'ceremony_start_failed',
    });
    return actionError('We could not start passkey setup. Please try again.');
  }
}

export async function finishPasskeyRegistration(
  responseInput: unknown,
  labelInput: unknown,
) {
  const session = await requireVerifiedSession();
  const parsedResponse = registrationResponseSchema.safeParse(responseInput);
  const parsedLabel = passkeyLabelSchema.safeParse(labelInput);

  if (!hasRequiredRole(session.role, 'admin')) {
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'privileged_role_required',
    });
    return actionError(
      'Passkeys protect owner and administrator management actions.',
    );
  }

  if (!parsedLabel.success) {
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'invalid_label',
    });
    return actionError(
      parsedLabel.error.issues[0]?.message ?? 'Name this passkey.',
    );
  }

  if (!parsedResponse.success) {
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'invalid_response',
    });
    return actionError('The passkey response was not valid. Please try again.');
  }

  try {
    const completed = await completePasskeyRegistrationCeremony({
      userId: session.user.id,
      sessionReference: session.sessionReference,
      response: parsedResponse.data as unknown as RegistrationResponseJSON,
      label: parsedLabel.data,
    });

    if (!completed) {
      recordSecurityEvent('passkey.enrollment', 'failure', {
        actorUserId: session.user.id,
        reason: 'verification_failed',
      });
      return actionError(
        'Passkey setup expired or could not be verified. Please try again.',
      );
    }

    recordSecurityEvent('passkey.enrollment', 'success', {
      actorUserId: session.user.id,
      passkeyId: completed.id,
    });
    scheduleSecurityNotificationDelivery();
    let initialRecoveryCodes;

    if (!completed.recovery) {
      try {
        const issued = await issueInitialRecoveryCodes({
          userId: session.user.id,
          sessionReference: session.sessionReference,
        });

        if (issued.status === 'issued') initialRecoveryCodes = issued;
      } catch (error) {
        console.error('Initial recovery-code issuance failed:', error);
        recordSecurityEvent('passkey.recovery_codes', 'unavailable', {
          actorUserId: session.user.id,
          reason: 'initial_issuance_failed',
        });
      }
    }

    const recoveryCodes = completed.recovery ?? initialRecoveryCodes;
    const recoveryNotification =
      completed.recovery?.notification ?? initialRecoveryCodes?.notification;

    const passkey = {
      backedUp: completed.backedUp,
      createdAt: completed.createdAt,
      id: completed.id,
      label: completed.label,
    };
    revalidatePath('/dashboard/security');
    return {
      status: 'success' as const,
      message: 'Passkey added. This session is ready for protected actions.',
      passkey,
      ...(recoveryCodes
        ? {
            recoveryCodes: {
              codes: recoveryCodes.codes,
              createdAt: recoveryCodes.createdAt,
              remainingCodes: recoveryCodes.remainingCodes,
              setId: recoveryCodes.setId,
              totalCodes: recoveryCodes.totalCodes,
            },
          }
        : {}),
      ...(recoveryNotification ? { recoveryNotification } : {}),
    };
  } catch (error) {
    console.error('Passkey registration failed:', error);
    recordSecurityEvent('passkey.enrollment', 'failure', {
      actorUserId: session.user.id,
      reason: 'persistence_failed',
    });
    return actionError('We could not save that passkey. Please try again.');
  }
}

export async function beginPasskeyStepUp() {
  const session = await requireVerifiedSession();

  if (!hasRequiredRole(session.role, 'admin')) {
    return actionError(
      'Passkeys protect owner and administrator management actions.',
    );
  }

  try {
    const options = await beginPasskeyStepUpCeremony({
      userId: session.user.id,
      sessionReference: session.sessionReference,
    });

    if (!options) {
      recordSecurityEvent('passkey.step_up', 'failure', {
        actorUserId: session.user.id,
        reason: 'no_passkey',
      });
      return actionError('Add a passkey before using protected actions.');
    }

    return { status: 'success' as const, options };
  } catch (error) {
    console.error('Passkey verification could not begin:', error);
    recordSecurityEvent('passkey.step_up', 'failure', {
      actorUserId: session.user.id,
      reason: 'ceremony_start_failed',
    });
    return actionError('We could not start passkey verification. Try again.');
  }
}

export async function finishPasskeyStepUp(responseInput: unknown) {
  const session = await requireVerifiedSession();
  const parsedResponse = authenticationResponseSchema.safeParse(responseInput);

  if (!hasRequiredRole(session.role, 'admin')) {
    return actionError(
      'Passkeys protect owner and administrator management actions.',
    );
  }

  if (!parsedResponse.success) {
    recordSecurityEvent('passkey.step_up', 'failure', {
      actorUserId: session.user.id,
      reason: 'invalid_response',
    });
    return actionError('The passkey response was not valid. Please try again.');
  }

  try {
    const completed = await completePasskeyStepUpCeremony({
      userId: session.user.id,
      sessionReference: session.sessionReference,
      response: parsedResponse.data as unknown as AuthenticationResponseJSON,
    });

    if (!completed) {
      recordSecurityEvent('passkey.step_up', 'failure', {
        actorUserId: session.user.id,
        reason: 'verification_failed',
      });
      return actionError(
        'Passkey verification expired or failed. Please try again.',
      );
    }

    recordSecurityEvent('passkey.step_up', 'success', {
      actorUserId: session.user.id,
    });
    revalidatePath('/dashboard/security');
    revalidatePath('/dashboard/owner/users');
    return {
      status: 'success' as const,
      message:
        'Identity confirmed. Protected actions are unlocked for 10 minutes.',
    };
  } catch (error) {
    console.error('Passkey verification failed:', error);
    recordSecurityEvent('passkey.step_up', 'failure', {
      actorUserId: session.user.id,
      reason: 'verification_unavailable',
    });
    return actionError('We could not verify that passkey. Please try again.');
  }
}

export async function removePasskey(
  passkeyIdInput: unknown,
  passwordInput?: unknown,
) {
  let session = await requireVerifiedSession();
  let authorization: 'passkey' | 'password' = 'password';
  const parsedPasskeyId = passkeyIdSchema.safeParse(passkeyIdInput);

  if (!parsedPasskeyId.success) {
    recordSecurityEvent('passkey.removal', 'failure', {
      actorUserId: session.user.id,
      reason: 'invalid_passkey_id',
    });
    return actionError('That passkey could not be removed. Please try again.');
  }

  if (hasRequiredRole(session.role, 'admin')) {
    session = await requireRecentPasskeyStepUp('/dashboard/security');
    authorization = 'passkey';
  } else {
    let reauthentication;

    try {
      reauthentication = await verifyCurrentPasswordForPasskeyChange({
        userId: session.user.id,
        sessionReference: session.sessionReference,
        passwordInput,
      });
    } catch (error) {
      console.error('Passkey removal password confirmation failed:', error);
      recordSecurityEvent('passkey.removal', 'failure', {
        actorUserId: session.user.id,
        reason: 'password_check_unavailable',
      });
      return actionError(
        'We could not confirm your password. Please try again.',
      );
    }

    if (reauthentication === 'limited') {
      recordSecurityEvent('passkey.removal', 'limited', {
        actorUserId: session.user.id,
      });
      return actionError('Too many attempts. Wait 15 minutes and try again.');
    }

    if (reauthentication !== 'success') {
      recordSecurityEvent('passkey.removal', 'failure', {
        actorUserId: session.user.id,
        reason:
          reauthentication === 'invalid'
            ? 'invalid_password_input'
            : 'incorrect_password',
      });
      return actionError('Enter your current password to remove this passkey.');
    }
  }

  try {
    const result = await removeUserPasskey({
      userId: session.user.id,
      passkeyId: parsedPasskeyId.data,
      authorization,
    });

    if (result.status === 'last_privileged_passkey') {
      recordSecurityEvent('passkey.removal', 'failure', {
        actorUserId: session.user.id,
        passkeyId: parsedPasskeyId.data,
        reason: 'last_privileged_passkey',
      });
      return actionError(
        'Add another passkey before removing the final credential on this protected account.',
      );
    }

    if (result.status === 'step_up_required') {
      recordSecurityEvent('passkey.removal', 'failure', {
        actorUserId: session.user.id,
        passkeyId: parsedPasskeyId.data,
        reason: 'step_up_required',
      });
      return actionError(
        'Verify with a passkey before changing credentials on this protected account.',
      );
    }

    if (result.status !== 'removed') {
      recordSecurityEvent('passkey.removal', 'failure', {
        actorUserId: session.user.id,
        reason: result.status,
      });
      return actionError(
        'That passkey could not be removed. Please try again.',
      );
    }

    recordSecurityEvent('passkey.removal', 'success', {
      actorUserId: session.user.id,
      passkeyId: result.passkey.id,
      remainingPasskeys: result.remainingPasskeys,
    });
    scheduleSecurityNotificationDelivery();
    revalidatePath('/dashboard/security');
    revalidatePath('/dashboard/owner/users');
    return {
      status: 'success' as const,
      message: `${result.passkey.label} was removed. Protected actions are locked until you verify again.`,
      passkey: result.passkey,
      remainingPasskeys: result.remainingPasskeys,
    };
  } catch (error) {
    console.error('Passkey removal failed:', error);
    recordSecurityEvent('passkey.removal', 'failure', {
      actorUserId: session.user.id,
      reason: 'persistence_failed',
    });
    return actionError('We could not remove that passkey. Please try again.');
  }
}
