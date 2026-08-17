import { authConfig } from '@/auth.config';

function authorize(
  path: string,
  auth?: {
    emailVerified: boolean;
    sessionValid: boolean;
    accountStatus: 'active' | 'suspended' | 'closed';
    user: { id: string };
  },
) {
  const callback = authConfig.callbacks.authorized;
  return callback({
    auth,
    request: { nextUrl: new URL(path, 'https://woodenbridge.example') },
  } as never);
}

describe('route authorization states', () => {
  it('denies the dashboard to an anonymous visitor', () => {
    expect(authorize('/dashboard')).toBe(false);
  });

  it('treats an unverified session as unauthenticated', () => {
    const pending = {
      user: { id: 'pending-user' },
      emailVerified: false,
      sessionValid: false,
      accountStatus: 'active' as const,
    };

    expect(authorize('/verify-email', pending)).toBe(true);
    expect(authorize('/dashboard', pending)).toBe(false);
    expect(authorize('/', pending)).toBe(true);
  });

  it('allows a valid verified session and redirects auth pages', () => {
    const authenticated = {
      user: { id: 'verified-user' },
      emailVerified: true,
      sessionValid: true,
      accountStatus: 'active' as const,
    };

    expect(authorize('/dashboard', authenticated)).toBe(true);
    expect(
      (authorize('/login', authenticated) as Response).headers.get('location'),
    ).toBe('https://woodenbridge.example/dashboard');
  });

  it('rejects a stale session even if its email was previously verified', () => {
    const stale = {
      user: { id: 'stale-user' },
      emailVerified: true,
      sessionValid: false,
      accountStatus: 'active' as const,
    };

    expect(authorize('/dashboard', stale)).toBe(false);
  });

  it('rejects suspended and closed accounts even with otherwise valid claims', () => {
    for (const accountStatus of ['suspended', 'closed'] as const) {
      expect(
        authorize('/dashboard', {
          user: { id: `${accountStatus}-user` },
          emailVerified: true,
          sessionValid: true,
          accountStatus,
        }),
      ).toBe(false);
    }
  });
});
