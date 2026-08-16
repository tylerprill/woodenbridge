import { getRoleChangeBlock } from '@/app/lib/auth/owner-user-policy';

describe('owner user-management policy', () => {
  it('prevents an owner from demoting the active account', () => {
    expect(
      getRoleChangeBlock({
        actorUserId: 'owner-a',
        targetUserId: 'owner-a',
        currentRole: 'owner',
        nextRole: 'user',
        ownerCount: 2,
      }),
    ).toBe('self-protected');
  });

  it('prevents removal of the final owner', () => {
    expect(
      getRoleChangeBlock({
        actorUserId: 'owner-a',
        targetUserId: 'owner-b',
        currentRole: 'owner',
        nextRole: 'user',
        ownerCount: 1,
      }),
    ).toBe('last-owner-protected');
  });

  it('allows an owner to promote a user', () => {
    expect(
      getRoleChangeBlock({
        actorUserId: 'owner-a',
        targetUserId: 'user-b',
        currentRole: 'user',
        nextRole: 'owner',
        ownerCount: 1,
      }),
    ).toBeUndefined();
  });

  it('allows one owner to demote another when an owner remains', () => {
    expect(
      getRoleChangeBlock({
        actorUserId: 'owner-a',
        targetUserId: 'owner-b',
        currentRole: 'owner',
        nextRole: 'user',
        ownerCount: 2,
      }),
    ).toBeUndefined();
  });
});
