export const ACCOUNT_STATUSES = ['active', 'suspended', 'closed'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return (
    typeof value === 'string' &&
    ACCOUNT_STATUSES.includes(value as AccountStatus)
  );
}

export function isActiveAccountStatus(value: unknown): value is 'active' {
  return value === 'active';
}

export function canAccountAuthenticate(
  accountStatus: unknown,
  emailVerifiedAt: Date | null | undefined,
) {
  return isActiveAccountStatus(accountStatus) && Boolean(emailVerifiedAt);
}
