import 'server-only';

import { sql } from '@/app/lib/db';

export type PersistedSecurityEvent = {
  category: string;
  details: Record<string, boolean | number | string>;
  event: string;
  eventId: string;
  occurredAt: string;
  outcome: string;
};

export async function persistSecurityEvent(entry: PersistedSecurityEvent) {
  const actorUserId =
    typeof entry.details.actorUserId === 'string'
      ? entry.details.actorUserId
      : null;
  const targetUserId =
    typeof entry.details.targetUserId === 'string'
      ? entry.details.targetUserId
      : null;

  await sql`
    INSERT INTO auth_security_events (
      event_id,
      occurred_at,
      category,
      event,
      outcome,
      actor_user_id,
      target_user_id,
      details
    )
    VALUES (
      ${entry.eventId},
      ${entry.occurredAt},
      ${entry.category},
      ${entry.event},
      ${entry.outcome},
      ${actorUserId},
      ${targetUserId},
      ${JSON.stringify(entry.details)}::jsonb
    )
    ON CONFLICT (event_id) DO NOTHING
  `;
}

export async function deleteExpiredSecurityEvents() {
  await sql`
    DELETE FROM auth_security_events
    WHERE occurred_at < NOW() - INTERVAL '180 days'
  `;
}
