import { signIn } from '@/auth';
import { signOut } from '@/auth.session';
import { redirect } from 'next/navigation';
import { authenticate, createUser } from '@/app/lib/actions';
import {
  restartEmailVerification,
  submitEmailVerificationCode,
} from '@/app/lib/actions/email-verification';
import { recordAccountCreationRequest } from '@/app/lib/auth/auth-rate-limit';
import { getNewPasswordRejection } from '@/app/lib/auth/compromised-password';
import {
  createDecoyVerificationChallengeId,
  verifyPendingRegistrationCode,
} from '@/app/lib/auth/email-verification';
import { issuePendingRegistrationVerification } from '@/app/lib/auth/email-verification-flow';
import {
  clearEmailVerificationChallengeCookie,
  clearEmailVerificationDestinationCookie,
  clearVerifiedLoginChallengeCookie,
  getEmailVerificationChallengeCookie,
  setEmailVerificationChallengeCookie,
  setEmailVerificationDestinationCookie,
  setVerifiedLoginChallengeCookie,
} from '@/app/lib/auth/email-verification-cookie';
import { hashPassword } from '@/app/lib/auth/password-hash';
import { getClientIpHash } from '@/app/lib/auth/security';

jest.mock('@/auth', () => ({ signIn: jest.fn() }));
jest.mock('@/auth.session', () => ({ signOut: jest.fn() }));
jest.mock('next-auth', () => ({
  AuthError: class AuthError extends Error {
    type = 'CredentialsSignin';
  },
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('next/server', () => ({ after: jest.fn() }));

jest.mock('@/app/lib/auth/auth-rate-limit', () => ({
  deleteExpiredAuthRateLimitData: jest.fn(),
  recordAccountCreationRequest: jest.fn(),
}));

jest.mock('@/app/lib/auth/compromised-password', () => ({
  getNewPasswordRejection: jest.fn(),
}));

jest.mock('@/app/lib/auth/password-hash', () => ({
  hashPassword: jest.fn(),
}));

jest.mock('@/app/lib/auth/email-verification-cookie', () => ({
  clearEmailVerificationChallengeCookie: jest.fn(),
  clearEmailVerificationDestinationCookie: jest.fn(),
  clearVerifiedLoginChallengeCookie: jest.fn(),
  getEmailVerificationDestinationCookie: jest.fn(),
  getEmailVerificationChallengeCookie: jest.fn(),
  setEmailVerificationChallengeCookie: jest.fn(),
  setEmailVerificationDestinationCookie: jest.fn(),
  setVerifiedLoginChallengeCookie: jest.fn(),
}));

jest.mock('@/app/lib/auth/email-verification', () => ({
  createDecoyVerificationChallengeId: jest.fn(),
  deleteExpiredEmailVerificationData: jest.fn(),
  findPendingRegistrationByChallenge: jest.fn(),
  verifyPendingRegistrationCode: jest.fn(),
}));

jest.mock('@/app/lib/auth/email-verification-flow', () => ({
  issuePendingRegistrationVerification: jest.fn(),
}));

jest.mock('@/app/lib/auth/recovery-email', () => ({
  sendWelcomeEmail: jest.fn(),
}));

jest.mock('@/app/lib/auth/security', () => ({
  getClientIpHash: jest.fn(),
  hashRateLimitKey: jest.fn(),
}));

jest.mock('@/app/lib/auth/security-events', () => ({
  recordSecurityEvent: jest.fn(),
}));

const signInMock = jest.mocked(signIn);
const signOutMock = jest.mocked(signOut);
const redirectMock = jest.mocked(redirect);
const recordAccountCreationMock = jest.mocked(recordAccountCreationRequest);
const passwordRejectionMock = jest.mocked(getNewPasswordRejection);
const createDecoyMock = jest.mocked(createDecoyVerificationChallengeId);
const issueVerificationMock = jest.mocked(issuePendingRegistrationVerification);
const clearDestinationMock = jest.mocked(
  clearEmailVerificationDestinationCookie,
);
const clearChallengeMock = jest.mocked(clearEmailVerificationChallengeCookie);
const clearHandoffMock = jest.mocked(clearVerifiedLoginChallengeCookie);
const getChallengeMock = jest.mocked(getEmailVerificationChallengeCookie);
const setChallengeMock = jest.mocked(setEmailVerificationChallengeCookie);
const setDestinationMock = jest.mocked(setEmailVerificationDestinationCookie);
const hashPasswordMock = jest.mocked(hashPassword);
const getClientIpHashMock = jest.mocked(getClientIpHash);
const setVerifiedHandoffMock = jest.mocked(setVerifiedLoginChallengeCookie);
const verifyCodeMock = jest.mocked(verifyPendingRegistrationCode);

describe('verified-login handoff lifecycle', () => {
  beforeEach(() => {
    signInMock.mockReset();
    signOutMock.mockReset();
    redirectMock.mockReset();
    recordAccountCreationMock.mockReset();
    passwordRejectionMock.mockReset();
    createDecoyMock.mockReset();
    issueVerificationMock.mockReset();
    clearDestinationMock.mockReset();
    clearChallengeMock.mockReset();
    clearHandoffMock.mockReset();
    getChallengeMock.mockReset();
    setChallengeMock.mockReset();
    setDestinationMock.mockReset();
    hashPasswordMock.mockReset();
    getClientIpHashMock.mockReset();
    setVerifiedHandoffMock.mockReset();
    verifyCodeMock.mockReset();
  });

  it('sets the same destination even when signup rate limiting uses a decoy challenge', async () => {
    const redirectError = new Error('NEXT_REDIRECT');
    redirectMock.mockImplementation(() => {
      throw redirectError;
    });
    recordAccountCreationMock.mockResolvedValue(false);
    createDecoyMock.mockReturnValue('l'.repeat(43));
    getClientIpHashMock.mockResolvedValue('b'.repeat(64));
    const formData = new FormData();
    formData.set('first_name', 'New');
    formData.set('last_name', 'Explorer');
    formData.set('email', 'New.Explorer@Example.COM');
    formData.set('password', 'a secure password phrase');
    formData.set('confirmPassword', 'a secure password phrase');

    await expect(createUser(undefined, formData)).rejects.toBe(redirectError);

    expect(setChallengeMock).toHaveBeenCalledWith('l'.repeat(43));
    expect(setDestinationMock).toHaveBeenCalledWith('new.explorer@example.com');
  });

  it('clears the destination after successful verification', async () => {
    const redirectError = new Error('NEXT_REDIRECT');
    const challengeId = 'v'.repeat(43);
    redirectMock.mockImplementation(() => {
      throw redirectError;
    });
    getChallengeMock.mockResolvedValue(challengeId);
    getClientIpHashMock.mockResolvedValue('b'.repeat(64));
    verifyCodeMock.mockResolvedValue({
      status: 'verified',
      user: {
        id: 'user-1',
        email: 'new.explorer@example.com',
        first_name: 'New',
        email_verified_at: new Date(),
      },
    });
    const formData = new FormData();
    formData.set('code', '123456');
    formData.set('intent', 'photo-import');

    await expect(submitEmailVerificationCode(undefined, formData)).rejects.toBe(
      redirectError,
    );

    expect(setVerifiedHandoffMock).toHaveBeenCalledWith(challengeId);
    expect(clearChallengeMock).toHaveBeenCalledTimes(1);
    expect(clearDestinationMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith(
      '/login?verified=success&intent=photo-import',
    );
  });

  it('renders the same submitted destination for real and decoy registrations', async () => {
    const redirectError = new Error('NEXT_REDIRECT');
    redirectMock.mockImplementation(() => {
      throw redirectError;
    });
    recordAccountCreationMock.mockResolvedValue(true);
    passwordRejectionMock.mockResolvedValue(undefined);
    hashPasswordMock.mockResolvedValue('stored-password-hash');
    getClientIpHashMock.mockResolvedValue('b'.repeat(64));
    issueVerificationMock
      .mockResolvedValueOnce('r'.repeat(43))
      .mockResolvedValueOnce('d'.repeat(43));

    const registration = () => {
      const formData = new FormData();
      formData.set('first_name', 'New');
      formData.set('last_name', 'Explorer');
      formData.set('email', 'New.Explorer@Example.COM');
      formData.set('password', 'a secure password phrase');
      formData.set('confirmPassword', 'a secure password phrase');
      formData.set('intent', 'photo-import');
      return formData;
    };

    await expect(createUser(undefined, registration())).rejects.toBe(
      redirectError,
    );
    await expect(createUser(undefined, registration())).rejects.toBe(
      redirectError,
    );

    expect(setChallengeMock.mock.calls.map(([value]) => value)).toEqual([
      'r'.repeat(43),
      'd'.repeat(43),
    ]);
    expect(setDestinationMock.mock.calls).toEqual([
      ['new.explorer@example.com'],
      ['new.explorer@example.com'],
    ]);
    expect(redirectMock).toHaveBeenNthCalledWith(
      1,
      '/verify-email?sent=1&intent=photo-import',
    );
    expect(redirectMock).toHaveBeenNthCalledWith(
      2,
      '/verify-email?sent=1&intent=photo-import',
    );
  });

  it('consumes the verified-login handoff before credential authentication', async () => {
    const redirect = new Error('NEXT_REDIRECT');
    signInMock.mockRejectedValueOnce(redirect);
    const formData = new FormData();
    formData.set('email', 'new.explorer@example.com');
    formData.set('password', 'a-valid-password');
    formData.set('intent', 'photo-import');

    await expect(authenticate(undefined, formData)).rejects.toBe(redirect);

    expect(clearHandoffMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith(
      'credentials',
      expect.any(FormData),
    );
    expect((signInMock.mock.calls[0]?.[1] as FormData).get('redirectTo')).toBe(
      '/dashboard/import',
    );
    expect(clearHandoffMock.mock.invocationCallOrder[0]).toBeLessThan(
      signInMock.mock.invocationCallOrder[0],
    );
  });

  it('clears challenge, destination, and login handoff when registration restarts', async () => {
    signOutMock.mockResolvedValueOnce(undefined as never);
    const formData = new FormData();
    formData.set('intent', 'photo-import');

    await restartEmailVerification(formData);

    expect(clearChallengeMock).toHaveBeenCalledTimes(1);
    expect(clearDestinationMock).toHaveBeenCalledTimes(1);
    expect(clearHandoffMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({
      redirectTo: '/sign-up?intent=photo-import',
    });
  });
});
