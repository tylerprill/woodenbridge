import {
  getPostAuthDestination,
  getPostAuthIntent,
  NEW_MEMORY_INTENT,
  withPostAuthIntent,
} from '@/app/lib/auth/post-auth-intent';

describe('post-auth intent', () => {
  it('carries the new-Memory journey to Memory creation', () => {
    expect(getPostAuthIntent(NEW_MEMORY_INTENT)).toBe(NEW_MEMORY_INTENT);
    expect(getPostAuthDestination(NEW_MEMORY_INTENT)).toBe(
      '/dashboard?new=memory',
    );
    expect(withPostAuthIntent('/verify-email?sent=1', NEW_MEMORY_INTENT)).toBe(
      '/verify-email?sent=1&intent=new-memory',
    );
  });

  it('ignores arbitrary destinations instead of creating an open redirect', () => {
    expect(getPostAuthIntent('https://attacker.example')).toBeUndefined();
    expect(getPostAuthDestination('/dashboard/owner/users')).toBe('/dashboard');
    expect(withPostAuthIntent('/login', '//attacker.example')).toBe('/login');
  });
});
