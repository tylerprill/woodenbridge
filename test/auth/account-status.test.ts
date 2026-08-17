import {
  canAccountAuthenticate,
  isAccountStatus,
} from '@/app/lib/auth/account-status';

describe('account lifecycle status', () => {
  it('recognizes only supported durable statuses', () => {
    expect(isAccountStatus('active')).toBe(true);
    expect(isAccountStatus('suspended')).toBe(true);
    expect(isAccountStatus('closed')).toBe(true);
    expect(isAccountStatus('pending')).toBe(false);
  });

  it('allows credential authentication only for verified active accounts', () => {
    const verifiedAt = new Date('2026-08-17T12:00:00.000Z');

    expect(canAccountAuthenticate('active', verifiedAt)).toBe(true);
    expect(canAccountAuthenticate('active', null)).toBe(false);
    expect(canAccountAuthenticate('suspended', verifiedAt)).toBe(false);
    expect(canAccountAuthenticate('closed', verifiedAt)).toBe(false);
  });
});
