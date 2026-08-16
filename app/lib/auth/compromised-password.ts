import 'server-only';

import { createHash } from 'node:crypto';

import { recordSecurityEvent } from '@/app/lib/auth/security-events';

const PWNED_PASSWORDS_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const LOCAL_BLOCKLIST = new Set([
  '123456789012345',
  'correcthorsebatterystaple',
  'iloveyouiloveyou',
  'letmeinletmeinletmein',
  'passwordpassword',
  'password123456',
  'qwertyqwertyqwerty',
  'woodenbridge',
  'woodenbridge123',
]);

type PasswordContext = {
  email?: string;
  firstName?: string;
  lastName?: string;
};

function simplify(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s/g, '');
}

function isContextualPassword(password: string, context: PasswordContext) {
  const simplifiedPassword = simplify(password);
  const terms = [
    context.email?.split('@')[0],
    context.firstName,
    context.lastName,
    context.firstName && context.lastName
      ? `${context.firstName}${context.lastName}`
      : undefined,
  ]
    .filter((term): term is string => Boolean(term))
    .map(simplify)
    .filter((term) => term.length >= 4);

  return terms.some((term) => simplifiedPassword.includes(term));
}

export async function isPasswordCompromised(password: string) {
  const digest = createHash('sha1')
    .update(password.normalize('NFC'))
    .digest('hex')
    .toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const response = await fetch(`${PWNED_PASSWORDS_RANGE_URL}${prefix}`, {
    headers: {
      'Add-Padding': 'true',
      'User-Agent': 'wooden-bridge-password-screening/1.0',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(3_000),
  });

  if (!response.ok) {
    throw new Error(`Password screening returned HTTP ${response.status}.`);
  }

  return (await response.text())
    .split('\n')
    .some((line) => line.split(':', 1)[0]?.trim() === suffix);
}

export async function getNewPasswordRejection(
  password: string,
  context: PasswordContext = {},
) {
  const simplifiedPassword = simplify(password);

  if (
    LOCAL_BLOCKLIST.has(simplifiedPassword) ||
    isContextualPassword(password, context)
  ) {
    return 'Choose a password that is not common and does not contain your name or email.';
  }

  try {
    if (await isPasswordCompromised(password)) {
      return 'That password appears in known data breaches. Choose a different password.';
    }
  } catch {
    // Availability wins over an optional external lookup; local policy still applies.
    recordSecurityEvent(
      'password.compromised_check_unavailable',
      'unavailable',
    );
  }

  return undefined;
}
