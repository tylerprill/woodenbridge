import { authConfig } from '@/auth.config';

function authorize(
  path: string,
  auth?: {
    emailVerified: boolean;
    sessionValid: boolean;
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

  it('routes a pending session only to email verification', () => {
    const pending = {
      user: { id: 'pending-user' },
      emailVerified: false,
      sessionValid: false,
    };

    expect(authorize('/verify-email', pending)).toBe(true);
    expect(authorize('/dashboard', pending)).toBeInstanceOf(Response);
    expect((authorize('/', pending) as Response).headers.get('location')).toBe(
      'https://woodenbridge.example/verify-email',
    );
  });

  it('allows a valid verified session and redirects auth pages', () => {
    const authenticated = {
      user: { id: 'verified-user' },
      emailVerified: true,
      sessionValid: true,
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
    };

    expect(authorize('/dashboard', stale)).toBe(false);
  });
});
