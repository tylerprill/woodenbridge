import { sql } from '@/app/lib/db';
import {
  beginPasskeyRecoveryRegistration,
  redeemPrivilegedRecoveryCode,
  regeneratePrivilegedRecoveryCodes,
} from '@/app/lib/actions/recovery-codes';
import { verifyPassword } from '@/app/lib/auth/password-hash';
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
import { getClientIpHash } from '@/app/lib/auth/security';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import { scheduleSecurityNotificationDelivery } from '@/app/lib/auth/security-notification-scheduler';
import {
  requireRecentPasskeyStepUp,
  requireVerifiedSession,
} from '@/app/lib/auth/session';

jest.mock('@/app/lib/db', () => ({ sql: jest.fn() }));

jest.mock('@/app/lib/auth/password-hash', () => ({
  DUMMY_PASSWORD_HASH: '$dummy-hash',
  verifyPassword: jest.fn(),
}));

jest.mock('@/app/lib/auth/passkeys', () => ({
  beginPasskeyRegistrationCeremony: jest.fn(),
  completePasskeyReauthenticationAttempt: jest.fn(),
  reservePasskeyReauthenticationAttempt: jest.fn(),
}));

jest.mock('@/app/lib/auth/recovery-codes', () => ({
  consumeRecoveryCode: jest.fn(),
  getActiveRecoveryGrant: jest.fn(),
  regenerateRecoveryCodes: jest.fn(),
}));

jest.mock('@/app/lib/auth/security', () => ({
  getClientIpHash: jest.fn(),
}));

jest.mock('@/app/lib/auth/security-events', () => ({
  recordSecurityEvent: jest.fn(),
}));
jest.mock('@/app/lib/auth/security-notification-scheduler', () => ({
  scheduleSecurityNotificationDelivery: jest.fn(),
}));

jest.mock('@/app/lib/auth/session', () => ({
  requireRecentPasskeyStepUp: jest.fn(),
  requireVerifiedSession: jest.fn(),
}));

const sqlMock = jest.mocked(sql);
const verifyPasswordMock = jest.mocked(verifyPassword);
const beginRegistrationMock = jest.mocked(beginPasskeyRegistrationCeremony);
const completePasswordAttemptMock = jest.mocked(
  completePasskeyReauthenticationAttempt,
);
const reservePasswordAttemptMock = jest.mocked(
  reservePasskeyReauthenticationAttempt,
);
const consumeRecoveryCodeMock = jest.mocked(consumeRecoveryCode);
const getActiveRecoveryGrantMock = jest.mocked(getActiveRecoveryGrant);
const regenerateRecoveryCodesMock = jest.mocked(regenerateRecoveryCodes);
const getClientIpHashMock = jest.mocked(getClientIpHash);
const recordSecurityEventMock = jest.mocked(recordSecurityEvent);
const scheduleSecurityNotificationDeliveryMock = jest.mocked(
  scheduleSecurityNotificationDelivery,
);
const requireRecentPasskeyStepUpMock = jest.mocked(requireRecentPasskeyStepUp);
const requireVerifiedSessionMock = jest.mocked(requireVerifiedSession);
const userId = 'cc248324-3a37-4112-be21-5b7e64a1e027';
const sessionReference = 'a'.repeat(64);
const recoveryCode = 'FA-ABCD-EFGH-JKMP-QRST-VWXY-Z012';
const currentPassword = 'a current password with enough length';
const adminSession = {
  role: 'admin',
  sessionReference,
  user: { id: userId, email: 'admin@example.com', name: 'Ada Atlas' },
};
const ordinarySession = {
  role: 'user',
  sessionReference,
  user: { id: userId },
};

describe('privileged recovery-code Server Actions', () => {
  beforeEach(() => {
    requireVerifiedSessionMock.mockResolvedValue(adminSession as never);
    requireRecentPasskeyStepUpMock.mockResolvedValue(adminSession as never);
    getClientIpHashMock.mockResolvedValue('b'.repeat(64));
    reservePasswordAttemptMock.mockResolvedValue('attempt-id');
    completePasswordAttemptMock.mockResolvedValue(undefined);
    sqlMock.mockResolvedValue({
      rows: [{ password: '$stored-hash' }],
    } as never);
    verifyPasswordMock.mockResolvedValue(true);
  });

  it('rejects ordinary users before password or recovery-code processing', async () => {
    requireVerifiedSessionMock.mockResolvedValue(ordinarySession as never);

    await expect(
      redeemPrivilegedRecoveryCode(recoveryCode, currentPassword),
    ).resolves.toEqual({
      status: 'error',
      message: 'The recovery details were not accepted.',
    });

    expect(reservePasswordAttemptMock).not.toHaveBeenCalled();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(consumeRecoveryCodeMock).not.toHaveBeenCalled();
    expect(recordSecurityEventMock).toHaveBeenCalledWith(
      'passkey.recovery_code',
      'failure',
      expect.objectContaining({ reason: 'privileged_role_required' }),
    );
  });

  it('never reaches code consumption when the current password is wrong', async () => {
    verifyPasswordMock.mockResolvedValue(false);

    await expect(
      redeemPrivilegedRecoveryCode(recoveryCode, currentPassword),
    ).resolves.toEqual({
      status: 'error',
      message: 'The recovery details were not accepted.',
    });

    expect(completePasswordAttemptMock).toHaveBeenCalledWith({
      attemptId: 'attempt-id',
      sessionReference,
      successful: false,
    });
    expect(consumeRecoveryCodeMock).not.toHaveBeenCalled();
  });

  it('returns only a session-bound replacement grant and safe notification metadata', async () => {
    const expiresAt = '2026-08-17T12:10:00.000Z';
    consumeRecoveryCodeMock.mockResolvedValue({
      status: 'used',
      grant: { grantId: 'grant-id', expiresAt },
      remainingCodes: 9,
      notification: {
        changeId: 'event-id',
        occurredAt: '2026-08-17T12:00:00.000Z',
        remainingCodes: 9,
      },
    });

    const result = await redeemPrivilegedRecoveryCode(
      recoveryCode,
      currentPassword,
    );

    expect(result).toEqual({
      status: 'success',
      message:
        'Recovery confirmed. Add a replacement passkey within 10 minutes.',
      grant: { grantId: 'grant-id', expiresAt },
      remainingCodes: 9,
      notification: {
        changeId: 'event-id',
        occurredAt: '2026-08-17T12:00:00.000Z',
        remainingCodes: 9,
      },
    });
    expect(consumeRecoveryCodeMock).toHaveBeenCalledWith({
      userId,
      sessionReference,
      ipHash: 'b'.repeat(64),
      codeInput: recoveryCode,
    });
    expect(
      completePasswordAttemptMock.mock.invocationCallOrder[0],
    ).toBeLessThan(consumeRecoveryCodeMock.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(result)).not.toContain(recoveryCode);
    expect(JSON.stringify(result)).not.toMatch(/codeHash|password/i);

    expect(scheduleSecurityNotificationDeliveryMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(scheduleSecurityNotificationDeliveryMock.mock.calls),
    ).not.toContain(recoveryCode);
  });

  it('requires recent passkey step-up before even checking regeneration password', async () => {
    requireRecentPasskeyStepUpMock.mockRejectedValue(
      new Error('passkey-step-up-required'),
    );

    await expect(
      regeneratePrivilegedRecoveryCodes(currentPassword),
    ).rejects.toThrow('passkey-step-up-required');

    expect(requireRecentPasskeyStepUpMock).toHaveBeenCalledWith(
      '/dashboard/security',
    );
    expect(reservePasswordAttemptMock).not.toHaveBeenCalled();
    expect(regenerateRecoveryCodesMock).not.toHaveBeenCalled();
  });

  it('requires the current password before atomically replacing all old codes', async () => {
    regenerateRecoveryCodesMock.mockResolvedValue({
      status: 'issued',
      codes: Array.from(
        { length: 10 },
        (_, index) =>
          `FA-AAAA-BBBB-CCCC-DDDD-EEEE-${String(index).padStart(4, '0')}`,
      ),
      createdAt: '2026-08-17T12:00:00.000Z',
      remainingCodes: 10,
      totalCodes: 10,
      setId: 'new-set-id',
      notification: {
        changeId: 'event-id',
        occurredAt: '2026-08-17T12:00:00.000Z',
        reason: 'regenerate',
        setId: 'new-set-id',
      },
    });

    const result = await regeneratePrivilegedRecoveryCodes(currentPassword);

    expect(verifyPasswordMock).toHaveBeenCalledWith(
      '$stored-hash',
      currentPassword,
    );
    expect(regenerateRecoveryCodesMock).toHaveBeenCalledWith({
      userId,
      sessionReference,
    });
    expect(result).toMatchObject({
      status: 'success',
      setId: 'new-set-id',
      totalCodes: 10,
    });

    expect(scheduleSecurityNotificationDeliveryMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(scheduleSecurityNotificationDeliveryMock.mock.calls),
    ).not.toContain('FA-AAAA');
  });

  it('cannot begin replacement registration without an active recovery grant', async () => {
    getActiveRecoveryGrantMock.mockResolvedValue(null);

    await expect(beginPasskeyRecoveryRegistration()).resolves.toEqual({
      status: 'error',
      message:
        'This recovery window expired. Use another saved code to continue.',
    });

    expect(beginRegistrationMock).not.toHaveBeenCalled();
  });

  it('uses the recovery grant only to begin a replacement ceremony', async () => {
    const grant = {
      grantId: 'grant-id',
      expiresAt: '2026-08-17T12:10:00.000Z',
    };
    const options = {
      challenge: 'webauthn-challenge',
      rp: { id: 'field-atlas.example', name: 'Field Atlas' },
      user: {
        id: 'user-handle',
        name: 'admin@example.com',
        displayName: 'Admin',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      timeout: 300_000,
      attestation: 'none',
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      extensions: {},
    };
    getActiveRecoveryGrantMock.mockResolvedValue(grant);
    beginRegistrationMock.mockResolvedValue(options as never);

    await expect(beginPasskeyRecoveryRegistration()).resolves.toEqual({
      status: 'success',
      options,
      grant,
    });
    expect(beginRegistrationMock).toHaveBeenCalledWith({
      userId,
      sessionReference,
    });
    expect(requireRecentPasskeyStepUpMock).not.toHaveBeenCalled();
  });
});
