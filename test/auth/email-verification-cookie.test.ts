import { cookies } from 'next/headers';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

import {
  clearEmailVerificationDestinationCookie,
  clearVerifiedLoginChallengeCookie,
  getEmailVerificationDestinationCookie,
  getVerifiedLoginChallengeCookie,
  setEmailVerificationDestinationCookie,
  setVerifiedLoginChallengeCookie,
} from '@/app/lib/auth/email-verification-cookie';

const cookiesMock = jest.mocked(cookies);
const getCookie = jest.fn();
const setCookie = jest.fn();
const deleteCookie = jest.fn();
const originalAuthHmacSecret = process.env.AUTH_HMAC_SECRET;

describe('email verification browser handoffs', () => {
  beforeEach(() => {
    process.env.AUTH_HMAC_SECRET = 'test-auth-hmac-secret-material-long-enough';
    getCookie.mockReset();
    setCookie.mockReset();
    deleteCookie.mockReset();
    cookiesMock.mockResolvedValue({
      delete: deleteCookie,
      get: getCookie,
      set: setCookie,
    } as never);
  });

  afterAll(() => {
    if (originalAuthHmacSecret === undefined) {
      delete process.env.AUTH_HMAC_SECRET;
    } else {
      process.env.AUTH_HMAC_SECRET = originalAuthHmacSecret;
    }
  });

  it('round-trips the submitted destination through a signed HttpOnly cookie', async () => {
    await setEmailVerificationDestinationCookie('explorer@example.com');

    expect(setCookie).toHaveBeenCalledWith(
      'wooden_bridge_email_verification_destination',
      expect.stringMatching(/^v1\.\d{10}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
      expect.objectContaining({
        httpOnly: true,
        maxAge: 600,
        path: '/',
        priority: 'high',
        sameSite: 'lax',
      }),
    );
    const signedValue = setCookie.mock.calls[0]?.[1] as string;
    expect(signedValue).not.toContain('explorer@example.com');

    getCookie.mockReturnValueOnce({ value: signedValue });
    await expect(getEmailVerificationDestinationCookie()).resolves.toBe(
      'explorer@example.com',
    );
  });

  it('rejects a tampered destination and clears it explicitly', async () => {
    await setEmailVerificationDestinationCookie('explorer@example.com');
    const signedValue = setCookie.mock.calls[0]?.[1] as string;
    const tamperedValue = `${signedValue.slice(0, -1)}${signedValue.endsWith('a') ? 'b' : 'a'}`;
    getCookie.mockReturnValueOnce({ value: tamperedValue });

    await expect(
      getEmailVerificationDestinationCookie(),
    ).resolves.toBeUndefined();
    await clearEmailVerificationDestinationCookie();

    expect(deleteCookie).toHaveBeenCalledWith(
      'wooden_bridge_email_verification_destination',
    );
  });

  it('stores only an opaque challenge in a short-lived HttpOnly cookie', async () => {
    const challengeId = 'a'.repeat(43);

    await setVerifiedLoginChallengeCookie(challengeId);

    expect(setCookie).toHaveBeenCalledWith(
      'wooden_bridge_verified_login_challenge',
      challengeId,
      expect.objectContaining({
        httpOnly: true,
        maxAge: 300,
        path: '/',
        priority: 'high',
        sameSite: 'lax',
      }),
    );
    expect(JSON.stringify(setCookie.mock.calls[0])).not.toContain(
      'explorer@example.com',
    );
  });

  it('reads and clears the same browser-bound handoff', async () => {
    getCookie.mockReturnValueOnce({ value: 'b'.repeat(43) });

    await expect(getVerifiedLoginChallengeCookie()).resolves.toBe(
      'b'.repeat(43),
    );
    await clearVerifiedLoginChallengeCookie();

    expect(getCookie).toHaveBeenCalledWith(
      'wooden_bridge_verified_login_challenge',
    );
    expect(deleteCookie).toHaveBeenCalledWith(
      'wooden_bridge_verified_login_challenge',
    );
  });
});
