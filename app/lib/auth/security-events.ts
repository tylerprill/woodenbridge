import 'server-only';

import { randomUUID } from 'node:crypto';

import { after } from 'next/server';

import {
  persistSecurityEvent,
  type PersistedSecurityEvent,
} from '@/app/lib/auth/security-event-store';

type SecurityEvent =
  | 'login.attempt'
  | 'login.rate_limited'
  | 'maintenance.auth_cleanup'
  | 'management.account_status_changed'
  | 'management.sessions_revoked'
  | 'management.user_role_changed'
  | 'passkey.enrollment'
  | 'passkey.recovery_code'
  | 'passkey.recovery_codes'
  | 'passkey.removal'
  | 'passkey.step_up'
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
  const entry: PersistedSecurityEvent = {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    category: 'authentication',
    event,
    outcome,
    details,
  };

  const serialized = JSON.stringify({
    timestamp: entry.occurredAt,
    category: entry.category,
    event: entry.event,
    eventId: entry.eventId,
    outcome: entry.outcome,
    service: 'field-atlas-web',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    ...entry.details,
  });

  if (outcome === 'success') {
    console.info(serialized);
  } else {
    console.warn(serialized);
  }

  try {
    after(async () => {
      try {
        await persistSecurityEvent(entry);
      } catch {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            category: 'security-observability',
            event: 'security_event.persistence_failed',
            eventId: entry.eventId,
            outcome: 'failure',
            service: 'field-atlas-web',
          }),
        );
      }
    });
  } catch {
    // Direct unit/script invocation has no request lifecycle. The structured
    // console entry remains available to the platform log drain in that case.
  }
}
