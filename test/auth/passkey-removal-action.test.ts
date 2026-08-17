import { removePasskey } from '@/app/lib/actions/passkeys';
import { removeUserPasskey } from '@/app/lib/auth/passkeys';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import {
  requireRecentPasskeyStepUp,
  requireVerifiedSession,
} from '@/app/lib/auth/session';

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

jest.mock('@/app/lib/auth/passkeys', () => ({
  PasskeyCapacityError: class PasskeyCapacityError extends Error {},
  removeUserPasskey: jest.fn(),
}));

jest.mock('@/app/lib/auth/security-events', () => ({
  recordSecurityEvent: jest.fn(),
}));

jest.mock('@/app/lib/auth/session', () => ({
  requireRecentPasskeyStepUp: jest.fn(),
  requireVerifiedSession: jest.fn(),
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const removeUserPasskeyMock = jest.mocked(removeUserPasskey);
const recordSecurityEventMock = jest.mocked(recordSecurityEvent);
const requireRecentPasskeyStepUpMock = jest.mocked(requireRecentPasskeyStepUp);
const requireVerifiedSessionMock = jest.mocked(requireVerifiedSession);
const passkeyId = '68038b48-4d24-4601-a83f-6fbc4280158a';
const adminSession = {
  role: 'admin',
  sessionReference: 'a'.repeat(64),
  user: { id: 'cc248324-3a37-4112-be21-5b7e64a1e027' },
};

describe('passkey removal Server Action', () => {
  beforeEach(() => {
    requireVerifiedSessionMock.mockResolvedValue(adminSession as never);
    requireRecentPasskeyStepUpMock.mockResolvedValue(adminSession as never);
  });

  it('cannot reach credential deletion when privileged step-up is stale', async () => {
    requireRecentPasskeyStepUpMock.mockRejectedValue(
      new Error('passkey-step-up-required'),
    );

    await expect(removePasskey(passkeyId)).rejects.toThrow(
      'passkey-step-up-required',
    );
    expect(requireRecentPasskeyStepUpMock).toHaveBeenCalledWith(
      '/dashboard/security',
    );
    expect(removeUserPasskeyMock).not.toHaveBeenCalled();
  });

  it('audits successful removal without exposing credential material', async () => {
    removeUserPasskeyMock.mockResolvedValue({
      status: 'removed',
      passkey: {
        id: passkeyId,
        label: 'Retired laptop',
        backedUp: false,
        createdAt: '2026-08-17T12:00:00.000Z',
      },
      remainingPasskeys: 1,
    });

    await expect(removePasskey(passkeyId)).resolves.toMatchObject({
      status: 'success',
      passkey: { label: 'Retired laptop' },
      remainingPasskeys: 1,
    });
    expect(removeUserPasskeyMock).toHaveBeenCalledWith({
      authorization: 'passkey',
      passkeyId,
      userId: adminSession.user.id,
    });
    expect(recordSecurityEventMock).toHaveBeenCalledWith(
      'passkey.removal',
      'success',
      {
        actorUserId: adminSession.user.id,
        passkeyId,
        remainingPasskeys: 1,
      },
    );
  });
});
