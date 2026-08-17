import { auth } from '@/auth';
import { hasUserPasskey } from '@/app/lib/auth/passkey-state';
import { requirePrivilegedStepUp } from '@/app/lib/auth/session';
import { redirect } from 'next/navigation';

jest.mock('@/auth', () => ({ auth: jest.fn() }));

jest.mock('@/app/lib/auth/passkey-state', () => ({
  hasUserPasskey: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));

const authMock = jest.mocked(auth);
const hasUserPasskeyMock = jest.mocked(hasUserPasskey);
const redirectMock = jest.mocked(redirect);

function createSession({
  role = 'admin',
  mfaVerifiedAt = Math.floor(Date.now() / 1_000),
  mfaMethod = 'passkey',
}: {
  role?: 'user' | 'admin' | 'owner';
  mfaVerifiedAt?: number | null;
  mfaMethod?: 'passkey' | null;
} = {}) {
  return {
    accountStatus: 'active',
    emailVerified: true,
    mfaMethod,
    mfaVerifiedAt,
    role,
    sessionValid: true,
    user: { id: '6c5faaf4-8506-4944-aeca-252d39d8a0a5' },
  };
}

describe('privileged step-up policy', () => {
  beforeEach(() => {
    authMock.mockResolvedValue(createSession() as never);
    hasUserPasskeyMock.mockResolvedValue(true);
  });

  it('allows an admin or owner only after a recent passkey verification', async () => {
    await expect(requirePrivilegedStepUp()).resolves.toMatchObject({
      role: 'admin',
    });
    expect(hasUserPasskeyMock).toHaveBeenCalledWith(
      '6c5faaf4-8506-4944-aeca-252d39d8a0a5',
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects a privileged account with stale verification to the security route', async () => {
    authMock.mockResolvedValue(
      createSession({
        mfaVerifiedAt: Math.floor(Date.now() / 1_000) - 11 * 60,
        role: 'owner',
      }) as never,
    );

    await expect(
      requirePrivilegedStepUp('/dashboard/owner/users?q=Ada'),
    ).rejects.toThrow('redirect:/dashboard/security');
    expect(redirectMock).toHaveBeenCalledWith(
      '/dashboard/security?required=passkey&returnTo=%2Fdashboard%2Fowner%2Fusers%3Fq%3DAda',
    );
  });

  it('does not treat a recent timestamp without passkey assurance as step-up', async () => {
    authMock.mockResolvedValue(createSession({ mfaMethod: null }) as never);

    await expect(requirePrivilegedStepUp()).rejects.toThrow(
      'redirect:/dashboard/security',
    );
  });

  it('does not trust an unsafe return destination', async () => {
    hasUserPasskeyMock.mockResolvedValue(false);

    await expect(requirePrivilegedStepUp('//attacker.example')).rejects.toThrow(
      'redirect:/dashboard/security',
    );
    expect(redirectMock).toHaveBeenCalledWith(
      '/dashboard/security?required=passkey&returnTo=%2Fdashboard%2Fowner%2Fusers',
    );
  });
});
