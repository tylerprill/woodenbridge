import { beginPasskeyRegistration } from '@/app/lib/actions/passkeys';
import { hasUserPasskey } from '@/app/lib/auth/passkey-state';
import {
  requireRecentPasskeyStepUp,
  requireVerifiedSession,
} from '@/app/lib/auth/session';

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

jest.mock('@/app/lib/auth/passkeys', () => ({
  PasskeyCapacityError: class PasskeyCapacityError extends Error {},
  beginPasskeyRegistrationCeremony: jest.fn(),
  reservePasskeyReauthenticationAttempt: jest.fn(),
}));

jest.mock('@/app/lib/auth/passkey-state', () => ({
  hasUserPasskey: jest.fn(),
}));

jest.mock('@/app/lib/auth/security-events', () => ({
  recordSecurityEvent: jest.fn(),
}));

jest.mock('@/app/lib/auth/session', () => ({
  requireRecentPasskeyStepUp: jest.fn(),
  requireVerifiedSession: jest.fn(),
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const hasUserPasskeyMock = jest.mocked(hasUserPasskey);
const requireRecentPasskeyStepUpMock = jest.mocked(requireRecentPasskeyStepUp);
const requireVerifiedSessionMock = jest.mocked(requireVerifiedSession);
const adminSession = {
  role: 'admin',
  sessionReference: 'a'.repeat(64),
  user: { id: 'cc248324-3a37-4112-be21-5b7e64a1e027' },
};

describe('passkey enrollment Server Action', () => {
  it('requires existing-passkey step-up before a privileged account adds another credential', async () => {
    requireVerifiedSessionMock.mockResolvedValue(adminSession as never);
    hasUserPasskeyMock.mockResolvedValue(true);
    requireRecentPasskeyStepUpMock.mockRejectedValue(
      new Error('passkey-step-up-required'),
    );

    await expect(
      beginPasskeyRegistration('correct horse battery staple'),
    ).rejects.toThrow('passkey-step-up-required');

    expect(requireRecentPasskeyStepUpMock).toHaveBeenCalledWith(
      '/dashboard/security',
    );
  });
});
