import { finishPasskeyRegistration } from '@/app/lib/actions/passkeys';
import { completePasskeyRegistrationCeremony } from '@/app/lib/auth/passkeys';
import { issueInitialRecoveryCodes } from '@/app/lib/auth/recovery-codes';
import { scheduleSecurityNotificationDelivery } from '@/app/lib/auth/security-notification-scheduler';
import { requireVerifiedSession } from '@/app/lib/auth/session';

jest.mock('@/app/lib/db', () => ({ sql: jest.fn() }));

jest.mock('@/app/lib/auth/passkeys', () => ({
  PasskeyCapacityError: class PasskeyCapacityError extends Error {},
  completePasskeyRegistrationCeremony: jest.fn(),
}));

jest.mock('@/app/lib/auth/recovery-codes', () => ({
  issueInitialRecoveryCodes: jest.fn(),
}));

jest.mock('@/app/lib/auth/security-notification-scheduler', () => ({
  scheduleSecurityNotificationDelivery: jest.fn(),
}));

jest.mock('@/app/lib/auth/security-events', () => ({
  recordSecurityEvent: jest.fn(),
}));

jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(),
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const finishCeremonyMock = jest.mocked(completePasskeyRegistrationCeremony);
const issueInitialRecoveryCodesMock = jest.mocked(issueInitialRecoveryCodes);
const requireVerifiedSessionMock = jest.mocked(requireVerifiedSession);
const scheduleSecurityNotificationDeliveryMock = jest.mocked(
  scheduleSecurityNotificationDelivery,
);

const userId = 'cc248324-3a37-4112-be21-5b7e64a1e027';
const sessionReference = 'a'.repeat(64);
const session = {
  role: 'admin',
  sessionReference,
  user: {
    id: userId,
    email: 'admin@example.com',
    name: 'Ada Atlas',
  },
};
const response = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key' as const,
  response: {
    attestationObject: 'attestation',
    clientDataJSON: 'client-data',
  },
};
const passkey = {
  backedUp: true,
  createdAt: '2026-08-17T12:00:00.000Z',
  id: '68038b48-4d24-4601-a83f-6fbc4280158a',
  label: 'Primary passkey',
};

describe('passkey completion notifications', () => {
  beforeEach(() => {
    requireVerifiedSessionMock.mockResolvedValue(session as never);
    finishCeremonyMock.mockResolvedValue(passkey);
    issueInitialRecoveryCodesMock.mockResolvedValue({
      status: 'issued',
      codes: ['FA-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'],
      createdAt: '2026-08-17T12:00:00.000Z',
      remainingCodes: 10,
      setId: 'initial-set',
      totalCodes: 10,
      notification: {
        changeId: 'initial-event',
        occurredAt: '2026-08-17T12:00:00.000Z',
        reason: 'initial',
        setId: 'initial-set',
      },
    });
  });

  it('schedules passkey and no-secret recovery-code creation notices', async () => {
    const result = await finishPasskeyRegistration(response, passkey.label);

    expect(result).toMatchObject({
      status: 'success',
      passkey,
      recoveryCodes: {
        setId: 'initial-set',
        totalCodes: 10,
      },
    });

    expect(scheduleSecurityNotificationDeliveryMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(scheduleSecurityNotificationDeliveryMock.mock.calls),
    ).not.toContain('FA-AAAA');
  });

  it('sends a recovery-completed notice after replacement WebAuthn succeeds', async () => {
    finishCeremonyMock.mockResolvedValue({
      ...passkey,
      recovery: {
        codes: ['FA-1111-2222-3333-4444-5555-6666'],
        createdAt: '2026-08-17T12:05:00.000Z',
        remainingCodes: 10,
        setId: 'replacement-set',
        totalCodes: 10,
        notification: {
          changeId: 'completion-event',
          occurredAt: '2026-08-17T12:05:00.000Z',
          recoveryGrantId: 'grant-id',
          setId: 'replacement-set',
        },
      },
    });

    await expect(
      finishPasskeyRegistration(response, passkey.label),
    ).resolves.toMatchObject({
      status: 'success',
      recoveryCodes: { setId: 'replacement-set' },
    });
    expect(issueInitialRecoveryCodesMock).not.toHaveBeenCalled();

    expect(scheduleSecurityNotificationDeliveryMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(scheduleSecurityNotificationDeliveryMock.mock.calls),
    ).not.toContain('FA-1111');
  });
});
