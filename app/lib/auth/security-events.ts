import 'server-only';

type SecurityEvent =
  | 'login.attempt'
  | 'login.rate_limited'
  | 'management.sessions_revoked'
  | 'management.user_role_changed'
  | 'password.compromised_check_unavailable'
  | 'password.reset'
  | 'signup.attempt'
  | 'signup.rate_limited'
  | 'verification.attempt';

type SecurityOutcome = 'failure' | 'limited' | 'success' | 'unavailable';

export function recordSecurityEvent(
  event: SecurityEvent,
  outcome: SecurityOutcome,
  details: Record<string, boolean | number | string> = {},
) {
  const entry = {
    timestamp: new Date().toISOString(),
    category: 'authentication',
    event,
    outcome,
    ...details,
  };

  const serialized = JSON.stringify(entry);

  if (outcome === 'success') {
    console.info(serialized);
  } else {
    console.warn(serialized);
  }
}
