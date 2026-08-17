import { auth, signOut } from '@/auth';
import { logOut, logOutEverywhere } from '@/app/lib/actions/auth';
import {
  revokeAllAuthenticatedSessions,
  revokeAuthenticatedSession,
} from '@/app/lib/auth/session-record';

jest.mock('@/auth', () => ({
  auth: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('@/app/lib/auth/session-record', () => ({
  revokeAllAuthenticatedSessions: jest.fn(),
  revokeAuthenticatedSession: jest.fn(),
}));

const authMock = jest.mocked(auth);
const signOutMock = jest.mocked(signOut);
const revokeAllMock = jest.mocked(revokeAllAuthenticatedSessions);
const revokeCurrentMock = jest.mocked(revokeAuthenticatedSession);

const activeSession = {
  accountStatus: 'active' as const,
  sessionReference:
    '6e9678c69b652b6f4df8d17dd14087f45aa98010dc3f02e192c89f3287e05a13',
  sessionValid: true,
  user: { id: '88465294-9360-46f4-87ab-54df4cb844fb' },
};

describe('logout lifecycle', () => {
  beforeEach(() => {
    authMock.mockResolvedValue(activeSession as never);
    revokeAllMock.mockResolvedValue(undefined);
    revokeCurrentMock.mockResolvedValue(true);
    signOutMock.mockResolvedValue(undefined as never);
  });

  it('revokes the current server-side session before clearing its cookie', async () => {
    await logOut({ redirectTo: '/' });

    expect(revokeCurrentMock).toHaveBeenCalledWith(
      activeSession.user.id,
      activeSession.sessionReference,
    );
    expect(revokeCurrentMock.mock.invocationCallOrder[0]).toBeLessThan(
      signOutMock.mock.invocationCallOrder[0],
    );
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: '/' });
  });

  it('revokes every session and increments the user session version', async () => {
    await logOutEverywhere({ redirectTo: '/' });

    expect(revokeAllMock).toHaveBeenCalledWith(activeSession.user.id);
    expect(revokeAllMock.mock.invocationCallOrder[0]).toBeLessThan(
      signOutMock.mock.invocationCallOrder[0],
    );
  });

  it('does not accept an arbitrary logout redirect', async () => {
    await logOut({ redirectTo: 'https://attacker.example' });

    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: '/login' });
  });

  it('does not claim logout succeeded when current-session revocation is unavailable', async () => {
    revokeCurrentMock.mockRejectedValue(new Error('database unavailable'));

    await expect(logOut()).rejects.toThrow('database unavailable');

    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('does not claim global logout succeeded when durable revocation is unavailable', async () => {
    revokeAllMock.mockRejectedValue(new Error('database unavailable'));

    await expect(logOutEverywhere()).rejects.toThrow('database unavailable');

    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('still attempts global revocation when session validation is temporarily unavailable', async () => {
    authMock.mockResolvedValue({
      ...activeSession,
      accountStatus: 'closed',
      sessionValid: false,
    } as never);

    await logOutEverywhere();

    expect(revokeAllMock).toHaveBeenCalledWith(activeSession.user.id);
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: '/login' });
  });
});
