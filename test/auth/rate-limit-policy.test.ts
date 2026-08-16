import {
  LOGIN_LIMITS,
  SIGNUP_LIMITS,
  isAccountCreationAllowed,
  isLoginAttemptAllowed,
} from '@/app/lib/auth/auth-rate-limit';

describe('authentication rate-limit policy', () => {
  it('allows login attempts below both limits', () => {
    expect(
      isLoginAttemptAllowed(
        LOGIN_LIMITS.emailFailures - 1,
        LOGIN_LIMITS.ipFailures - 1,
      ),
    ).toBe(true);
  });

  it('blocks login attempts when either limit is reached', () => {
    expect(isLoginAttemptAllowed(LOGIN_LIMITS.emailFailures, 0)).toBe(false);
    expect(isLoginAttemptAllowed(0, LOGIN_LIMITS.ipFailures)).toBe(false);
  });

  it('blocks account creation when either limit is reached', () => {
    expect(
      isAccountCreationAllowed(
        SIGNUP_LIMITS.emailRequests - 1,
        SIGNUP_LIMITS.ipRequests - 1,
      ),
    ).toBe(true);
    expect(isAccountCreationAllowed(SIGNUP_LIMITS.emailRequests, 0)).toBe(
      false,
    );
    expect(isAccountCreationAllowed(0, SIGNUP_LIMITS.ipRequests)).toBe(false);
  });
});
