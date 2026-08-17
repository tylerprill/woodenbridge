import {
  getAccountStatusChangeBlock,
  getRoleChangeBlock,
  getSessionRevocationBlock,
} from '@/app/lib/auth/owner-user-policy';

describe('management user policy', () => {
  it('protects the owner role from every role change', () => {
    expect(
      getRoleChangeBlock({
        actorUserId: 'owner-a',
        actorRole: 'owner',
        targetUserId: 'owner-a',
        currentRole: 'owner',
        nextRole: 'admin',
      }),
    ).toBe('protected-owner');
  });

  it('prevents admins from assigning roles', () => {
    expect(
      getRoleChangeBlock({
        actorUserId: 'admin-a',
        actorRole: 'admin',
        targetUserId: 'user-b',
        currentRole: 'user',
        nextRole: 'admin',
      }),
    ).toBe('owner-required');
  });

  it('allows the owner to appoint and remove admins', () => {
    expect(
      getRoleChangeBlock({
        actorUserId: 'owner-a',
        actorRole: 'owner',
        targetUserId: 'user-b',
        currentRole: 'user',
        nextRole: 'admin',
      }),
    ).toBeUndefined();

    expect(
      getRoleChangeBlock({
        actorUserId: 'owner-a',
        actorRole: 'owner',
        targetUserId: 'admin-b',
        currentRole: 'admin',
        nextRole: 'user',
      }),
    ).toBeUndefined();
  });

  it('allows admins to revoke user sessions but not peer sessions', () => {
    expect(
      getSessionRevocationBlock({
        actorUserId: 'admin-a',
        actorRole: 'admin',
        targetUserId: 'user-b',
        targetRole: 'user',
      }),
    ).toBeUndefined();

    expect(
      getSessionRevocationBlock({
        actorUserId: 'admin-a',
        actorRole: 'admin',
        targetUserId: 'admin-b',
        targetRole: 'admin',
      }),
    ).toBe('admin-peer-protected');
  });

  it('prevents everyone from revoking the owner session', () => {
    expect(
      getSessionRevocationBlock({
        actorUserId: 'admin-a',
        actorRole: 'admin',
        targetUserId: 'owner-a',
        targetRole: 'owner',
      }),
    ).toBe('protected-owner');
  });

  it('allows administrators to suspend users but not peer administrators', () => {
    expect(
      getAccountStatusChangeBlock({
        actorUserId: 'admin-a',
        actorRole: 'admin',
        targetUserId: 'user-b',
        targetRole: 'user',
        currentStatus: 'active',
      }),
    ).toBeUndefined();
    expect(
      getAccountStatusChangeBlock({
        actorUserId: 'admin-a',
        actorRole: 'admin',
        targetUserId: 'admin-b',
        targetRole: 'admin',
        currentStatus: 'active',
      }),
    ).toBe('admin-peer-protected');
  });

  it('allows the owner to manage admins while protecting owner and closed accounts', () => {
    expect(
      getAccountStatusChangeBlock({
        actorUserId: 'owner-a',
        actorRole: 'owner',
        targetUserId: 'admin-b',
        targetRole: 'admin',
        currentStatus: 'suspended',
      }),
    ).toBeUndefined();
    expect(
      getAccountStatusChangeBlock({
        actorUserId: 'owner-a',
        actorRole: 'owner',
        targetUserId: 'owner-a',
        targetRole: 'owner',
        currentStatus: 'active',
      }),
    ).toBe('protected-owner');
    expect(
      getAccountStatusChangeBlock({
        actorUserId: 'owner-a',
        actorRole: 'owner',
        targetUserId: 'user-b',
        targetRole: 'user',
        currentStatus: 'closed',
      }),
    ).toBe('closed-account');
  });
});
