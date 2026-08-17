import {
  isMfaVerificationRecent,
  isPasskeyVerificationRecent,
} from '@/app/lib/auth/session-policy';

describe('session lifecycle policy', () => {
  it('accepts only a recent MFA verification timestamp', () => {
    const now = Date.parse('2026-08-17T12:10:00.000Z');

    expect(isMfaVerificationRecent(now / 1_000 - 60, now)).toBe(true);
    expect(isMfaVerificationRecent(now / 1_000 - 11 * 60, now)).toBe(false);
    expect(isMfaVerificationRecent(now / 1_000 + 1, now)).toBe(false);
    expect(isMfaVerificationRecent(null, now)).toBe(false);
  });

  it('requires an explicit passkey assurance method for privileged step-up', () => {
    const now = Date.parse('2026-08-17T12:10:00.000Z');
    const recent = now / 1_000 - 60;

    expect(isPasskeyVerificationRecent(recent, 'passkey', now)).toBe(true);
    expect(isPasskeyVerificationRecent(recent, null, now)).toBe(false);
  });
});
