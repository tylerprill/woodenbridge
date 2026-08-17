'use server';

import { sql } from '@/app/lib/db';
import { z } from 'zod';

import { loginPasswordSchema } from '@/app/lib/auth/password';
import {
  DUMMY_PASSWORD_HASH,
  verifyPassword,
} from '@/app/lib/auth/password-hash';
import {
  beginPasskeyRegistrationCeremony,
  completePasskeyReauthenticationAttempt,
  reservePasskeyReauthenticationAttempt,
} from '@/app/lib/auth/passkeys';
import {
  consumeRecoveryCode,
  getActiveRecoveryGrant,
  regenerateRecoveryCodes,
} from '@/app/lib/auth/recovery-codes';
import { hasRequiredRole } from '@/app/lib/auth/roles';
import { getClientIpHash } from '@/app/lib/auth/security';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import { scheduleSecurityNotificationDelivery } from '@/app/lib/auth/security-notification-scheduler';
import {
  requireRecentPasskeyStepUp,
  requireVerifiedSession,
} from '@/app/lib/auth/session';

const recoveryCodeInputSchema = z.string().trim().max(64);

type RecoveryActionError = {
  status: 'error';
  message: string;
};

function actionError(message: string): RecoveryActionError {
  return { status: 'error', message };
}

async function verifyRecoveryPassword({
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
      AND role IN ('admin', 'owner')
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

export async function redeemPrivilegedRecoveryCode(
  codeInput: unknown,
  passwordInput: unknown,
) {
  const session = await requireVerifiedSession();
  const parsedCode = recoveryCodeInputSchema.safeParse(codeInput);

  if (!hasRequiredRole(session.role, 'admin')) {
    recordSecurityEvent('passkey.recovery_code', 'failure', {
      actorUserId: session.user.id,
      reason: 'privileged_role_required',
    });
    return actionError('The recovery details were not accepted.');
  }

  let passwordResult;

  try {
    passwordResult = await verifyRecoveryPassword({
      userId: session.user.id,
      sessionReference: session.sessionReference,
      passwordInput,
    });
  } catch (error) {
    console.error('Recovery password confirmation failed:', error);
    recordSecurityEvent('passkey.recovery_code', 'unavailable', {
      actorUserId: session.user.id,
      reason: 'password_check_unavailable',
    });
    return actionError('Recovery is temporarily unavailable. Try again.');
  }

  if (passwordResult === 'limited') {
    recordSecurityEvent('passkey.recovery_code', 'limited', {
      actorUserId: session.user.id,
      reason: 'password_rate_limit',
    });
    return actionError('Too many attempts. Wait 15 minutes and try again.');
  }

  if (passwordResult !== 'success' || !parsedCode.success) {
    recordSecurityEvent('passkey.recovery_code', 'failure', {
      actorUserId: session.user.id,
      reason: 'credentials_rejected',
    });
    return actionError('The recovery details were not accepted.');
  }

  try {
    const result = await consumeRecoveryCode({
      userId: session.user.id,
      sessionReference: session.sessionReference,
      ipHash: await getClientIpHash(),
      codeInput: parsedCode.data,
    });

    if (result.status === 'limited') {
      recordSecurityEvent('passkey.recovery_code', 'limited', {
        actorUserId: session.user.id,
        reason: 'recovery_rate_limit',
      });
      return actionError('Too many attempts. Wait 15 minutes and try again.');
    }

    if (result.status !== 'used') {
      recordSecurityEvent('passkey.recovery_code', 'failure', {
        actorUserId: session.user.id,
        reason: 'recovery_details_rejected',
      });
      return actionError('The recovery details were not accepted.');
    }

    scheduleSecurityNotificationDelivery();

    return {
      status: 'success' as const,
      message:
        'Recovery confirmed. Add a replacement passkey within 10 minutes.',
      grant: result.grant,
      remainingCodes: result.remainingCodes,
      notification: result.notification,
    };
  } catch (error) {
    console.error('Recovery-code redemption failed:', error);
    recordSecurityEvent('passkey.recovery_code', 'unavailable', {
      actorUserId: session.user.id,
      reason: 'redemption_unavailable',
    });
    return actionError('Recovery is temporarily unavailable. Try again.');
  }
}

export async function regeneratePrivilegedRecoveryCodes(
  passwordInput: unknown,
) {
  const session = await requireRecentPasskeyStepUp('/dashboard/security');
  let passwordResult;

  try {
    passwordResult = await verifyRecoveryPassword({
      userId: session.user.id,
      sessionReference: session.sessionReference,
      passwordInput,
    });
  } catch (error) {
    console.error('Recovery-code generation password check failed:', error);
    recordSecurityEvent('passkey.recovery_codes', 'unavailable', {
      actorUserId: session.user.id,
      reason: 'password_check_unavailable',
    });
    return actionError('We could not confirm your password. Please try again.');
  }

  if (passwordResult === 'limited') {
    recordSecurityEvent('passkey.recovery_codes', 'limited', {
      actorUserId: session.user.id,
      reason: 'password_rate_limit',
    });
    return actionError('Too many attempts. Wait 15 minutes and try again.');
  }

  if (passwordResult !== 'success') {
    recordSecurityEvent('passkey.recovery_codes', 'failure', {
      actorUserId: session.user.id,
      reason: 'password_rejected',
    });
    return actionError('Your current password was not correct.');
  }

  try {
    const result = await regenerateRecoveryCodes({
      userId: session.user.id,
      sessionReference: session.sessionReference,
    });

    if (result.status !== 'issued') {
      recordSecurityEvent('passkey.recovery_codes', 'failure', {
        actorUserId: session.user.id,
        reason: result.status,
      });
      return actionError(
        'Verify with a passkey before replacing your recovery codes.',
      );
    }

    scheduleSecurityNotificationDelivery();

    return {
      status: 'success' as const,
      message:
        'New recovery codes created. Every previous code is now invalid.',
      codes: result.codes,
      createdAt: result.createdAt,
      remainingCodes: result.remainingCodes,
      setId: result.setId,
      totalCodes: result.totalCodes,
      notification: result.notification,
    };
  } catch (error) {
    console.error('Recovery-code regeneration failed:', error);
    recordSecurityEvent('passkey.recovery_codes', 'unavailable', {
      actorUserId: session.user.id,
      reason: 'regeneration_unavailable',
    });
    return actionError('We could not create recovery codes. Please try again.');
  }
}

export async function beginPasskeyRecoveryRegistration() {
  const session = await requireVerifiedSession();

  if (!hasRequiredRole(session.role, 'admin')) {
    return actionError('Passkey recovery is not available for this account.');
  }

  try {
    const grant = await getActiveRecoveryGrant({
      userId: session.user.id,
      sessionReference: session.sessionReference,
    });

    if (!grant) {
      return actionError(
        'This recovery window expired. Use another saved code to continue.',
      );
    }

    const options = await beginPasskeyRegistrationCeremony({
      userId: session.user.id,
      sessionReference: session.sessionReference,
    });

    return { status: 'success' as const, options, grant };
  } catch (error) {
    console.error('Recovery passkey registration could not begin:', error);
    recordSecurityEvent('passkey.recovery_code', 'unavailable', {
      actorUserId: session.user.id,
      reason: 'replacement_ceremony_unavailable',
    });
    return actionError(
      'We could not start replacement passkey setup. Please try again.',
    );
  }
}
