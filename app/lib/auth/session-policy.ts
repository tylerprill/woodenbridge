export const RECENT_MFA_WINDOW_SECONDS = 60 * 10;

export const MFA_METHODS = ['passkey'] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

export function isMfaMethod(value: unknown): value is MfaMethod {
  return MFA_METHODS.includes(value as MfaMethod);
}

export function isMfaVerificationRecent(
  mfaVerifiedAt: number | null | undefined,
  now = Date.now(),
) {
  if (typeof mfaVerifiedAt !== 'number') return false;

  const ageMilliseconds = now - mfaVerifiedAt * 1_000;
  return (
    ageMilliseconds >= 0 && ageMilliseconds <= RECENT_MFA_WINDOW_SECONDS * 1_000
  );
}

export function isPasskeyVerificationRecent(
  mfaVerifiedAt: number | null | undefined,
  mfaMethod: MfaMethod | null | undefined,
  now = Date.now(),
) {
  return mfaMethod === 'passkey' && isMfaVerificationRecent(mfaVerifiedAt, now);
}
