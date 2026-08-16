import { hasRequiredRole, isAppRole } from '@/app/lib/auth/roles';

describe('application roles', () => {
  it('recognizes only the supported roles', () => {
    expect(isAppRole('user')).toBe(true);
    expect(isAppRole('admin')).toBe(true);
    expect(isAppRole('owner')).toBe(true);
    expect(isAppRole('moderator')).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });

  it('allows owners to use user features', () => {
    expect(hasRequiredRole('owner', 'user')).toBe(true);
  });

  it('allows admins to manage users without owner access', () => {
    expect(hasRequiredRole('admin', 'user')).toBe(true);
    expect(hasRequiredRole('admin', 'admin')).toBe(true);
    expect(hasRequiredRole('admin', 'owner')).toBe(false);
  });

  it('does not allow users to use owner features', () => {
    expect(hasRequiredRole('user', 'admin')).toBe(false);
    expect(hasRequiredRole('user', 'owner')).toBe(false);
  });
});
