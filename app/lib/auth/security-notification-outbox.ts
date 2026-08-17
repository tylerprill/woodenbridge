import 'server-only';

import { randomUUID } from 'node:crypto';

import { db, type VercelPoolClient } from '@/app/lib/db';
import {
  sendAccountStatusChangedEmail,
  sendPasskeyChangedEmail,
  sendPasswordChangedEmail,
  sendPrivilegedRecoveryEmail,
} from '@/app/lib/auth/recovery-email';
import { z } from 'zod';

const SECURITY_NOTIFICATION_MAX_ATTEMPTS = 12;
const SECURITY_NOTIFICATION_LEASE_SECONDS = 2 * 60;
const DEFAULT_BATCH_SIZE = 8;
const MAX_BATCH_SIZE = 20;
const DELIVERY_CONCURRENCY = 8;

const notificationPayloadSchemas = {
  password_changed: z.object({}).strict(),
  passkey_added: z
    .object({ passkeyLabel: z.string().trim().min(1).max(80) })
    .strict(),
  passkey_removed: z
    .object({ passkeyLabel: z.string().trim().min(1).max(80) })
    .strict(),
  account_status_changed: z
    .object({ status: z.enum(['active', 'suspended']) })
    .strict(),
  recovery_codes_created: z.object({}).strict(),
  recovery_code_used: z
    .object({ remainingCodes: z.number().int().min(0).max(12) })
    .strict(),
  recovery_completed: z.object({}).strict(),
} as const;

export type SecurityNotificationKind = keyof typeof notificationPayloadSchemas;

export type SecurityNotificationPayload = {
  [Kind in SecurityNotificationKind]: z.infer<
    (typeof notificationPayloadSchemas)[Kind]
  >;
};

type EnqueueSecurityNotificationInput<
  Kind extends SecurityNotificationKind = SecurityNotificationKind,
> = {
  userId: string;
  kind: Kind;
  changeId: string;
  payload: SecurityNotificationPayload[Kind];
};

type ClaimedNotification = {
  attempt_count: number;
  change_id: string;
  id: string;
  kind: SecurityNotificationKind;
  payload: unknown;
  recipient_email: string;
  recipient_first_name: string;
};

export type SecurityNotificationDeliverySummary = {
  claimed: number;
  deadLettered: number;
  delivered: number;
  failed: number;
};

export type SecurityNotificationOutboxHealth = {
  deadLettered: number;
  oldestPendingAt: string | null;
  pending: number;
};

function parsePayload<Kind extends SecurityNotificationKind>(
  kind: Kind,
  payload: unknown,
): SecurityNotificationPayload[Kind] {
  return notificationPayloadSchemas[kind].parse(payload) as never;
}

function parseStoredPayload(payload: unknown) {
  if (typeof payload !== 'string') return payload;

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new Error('Security notification payload is not valid JSON.');
  }
}

/**
 * Enqueue a no-secret security notice on the caller's open transaction.
 * Mutations must await this before COMMIT so the account change and its notice
 * either both persist or both roll back.
 */
export async function enqueueSecurityNotificationWithinTransaction<
  Kind extends SecurityNotificationKind,
>(client: VercelPoolClient, input: EnqueueSecurityNotificationInput<Kind>) {
  const parsedPayload = parsePayload(input.kind, input.payload);
  const payloadJson = JSON.stringify(parsedPayload);
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO security_notification_outbox (
        user_id,
        recipient_email,
        recipient_first_name,
        kind,
        change_id,
        payload
      )
      SELECT
        users.id,
        LOWER(users.email),
        COALESCE(NULLIF(BTRIM(users.first_name), ''), 'there'),
        $2,
        $3,
        $4::jsonb
      FROM users
      WHERE users.id = $1
        AND users.email IS NOT NULL
        AND BTRIM(users.email) <> ''
      ON CONFLICT (kind, change_id) DO NOTHING
      RETURNING id
    `,
    [input.userId, input.kind, input.changeId, payloadJson],
  );

  return result.rows[0]?.id ?? null;
}

function normalizedBatchSize(batchSize: number | undefined) {
  if (!Number.isFinite(batchSize)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(Math.trunc(batchSize!), MAX_BATCH_SIZE));
}

async function claimSecurityNotifications(batchSize?: number) {
  const client = await db.connect();
  const leaseToken = randomUUID();
  const limit = normalizedBatchSize(batchSize);

  try {
    await client.sql`BEGIN`;
    const claimed = await client.query<ClaimedNotification>(
      `
        WITH claimable AS (
          SELECT id
          FROM security_notification_outbox
          WHERE delivered_at IS NULL
            AND dead_at IS NULL
            AND available_at <= NOW()
            AND (leased_until IS NULL OR leased_until <= NOW())
            AND (
              attempt_count < $1
              OR (
                attempt_count = $1
                AND lease_token IS NOT NULL
                AND leased_until <= NOW()
              )
            )
          ORDER BY available_at ASC, created_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE security_notification_outbox AS notification
        SET
          attempt_count = LEAST(notification.attempt_count + 1, $1),
          lease_token = $3,
          leased_until = NOW() + ($4 * INTERVAL '1 second'),
          last_attempt_at = NOW(),
          last_error_code = NULL,
          updated_at = NOW()
        FROM claimable
        WHERE notification.id = claimable.id
        RETURNING
          notification.id,
          notification.kind,
          notification.change_id,
          notification.recipient_email,
          notification.recipient_first_name,
          notification.payload,
          notification.attempt_count
      `,
      [
        SECURITY_NOTIFICATION_MAX_ATTEMPTS,
        limit,
        leaseToken,
        SECURITY_NOTIFICATION_LEASE_SECONDS,
      ],
    );
    await client.sql`COMMIT`;

    return { leaseToken, notifications: claimed.rows };
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function deliverSecurityNotification(notification: ClaimedNotification) {
  const storedPayload = parseStoredPayload(notification.payload);
  const common = {
    to: notification.recipient_email,
    firstName: notification.recipient_first_name,
    changeId: notification.change_id,
  };

  switch (notification.kind) {
    case 'password_changed':
      parsePayload('password_changed', storedPayload);
      return sendPasswordChangedEmail(common);
    case 'passkey_added': {
      const payload = parsePayload('passkey_added', storedPayload);
      return sendPasskeyChangedEmail({
        ...common,
        action: 'added',
        passkeyLabel: payload.passkeyLabel,
      });
    }
    case 'passkey_removed': {
      const payload = parsePayload('passkey_removed', storedPayload);
      return sendPasskeyChangedEmail({
        ...common,
        action: 'removed',
        passkeyLabel: payload.passkeyLabel,
      });
    }
    case 'account_status_changed': {
      const payload = parsePayload('account_status_changed', storedPayload);
      return sendAccountStatusChangedEmail({
        ...common,
        status: payload.status,
      });
    }
    case 'recovery_codes_created':
      parsePayload('recovery_codes_created', storedPayload);
      return sendPrivilegedRecoveryEmail({
        ...common,
        event: 'codes-created',
      });
    case 'recovery_code_used': {
      const payload = parsePayload('recovery_code_used', storedPayload);
      return sendPrivilegedRecoveryEmail({
        ...common,
        event: 'code-used',
        remainingCodes: payload.remainingCodes,
      });
    }
    case 'recovery_completed':
      parsePayload('recovery_completed', storedPayload);
      return sendPrivilegedRecoveryEmail({
        ...common,
        event: 'recovery-completed',
      });
  }
}

async function markSecurityNotificationDelivered(
  notificationId: string,
  leaseToken: string,
) {
  const client = await db.connect();

  try {
    const result = await client.query<{ id: string }>(
      `
        UPDATE security_notification_outbox
        SET
          delivered_at = NOW(),
          lease_token = NULL,
          leased_until = NULL,
          last_error_code = NULL,
          updated_at = NOW()
        WHERE id = $1
          AND lease_token = $2
          AND delivered_at IS NULL
          AND dead_at IS NULL
        RETURNING id
      `,
      [notificationId, leaseToken],
    );

    if (!result.rows[0]) {
      throw new Error('Security notification delivery lease was lost.');
    }
  } finally {
    client.release();
  }
}

export function securityNotificationRetryDelaySeconds(attemptCount: number) {
  if (attemptCount <= 1) return 60;
  if (attemptCount === 2) return 5 * 60;
  if (attemptCount === 3) return 15 * 60;
  if (attemptCount === 4) return 60 * 60;
  if (attemptCount === 5) return 4 * 60 * 60;
  return 12 * 60 * 60;
}

async function markSecurityNotificationFailed(
  notification: ClaimedNotification,
  leaseToken: string,
) {
  const retryDelaySeconds = securityNotificationRetryDelaySeconds(
    notification.attempt_count,
  );
  const client = await db.connect();

  try {
    const result = await client.query<{ dead_at: Date | null; id: string }>(
      `
        UPDATE security_notification_outbox
        SET
          available_at = NOW() + ($3 * INTERVAL '1 second'),
          lease_token = NULL,
          leased_until = NULL,
          last_error_code = 'delivery_failed',
          dead_at = CASE
            WHEN attempt_count >= $4 THEN NOW()
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE id = $1
          AND lease_token = $2
          AND delivered_at IS NULL
          AND dead_at IS NULL
        RETURNING id, dead_at
      `,
      [
        notification.id,
        leaseToken,
        retryDelaySeconds,
        SECURITY_NOTIFICATION_MAX_ATTEMPTS,
      ],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error('Security notification failure lease was lost.');
    }

    return Boolean(row.dead_at);
  } finally {
    client.release();
  }
}

/**
 * Claims a bounded batch using SKIP LOCKED. A crashed worker's lease expires,
 * while Resend's stable idempotency key makes a post-delivery crash safe to
 * replay. Individual provider failures are recorded and do not abort the batch.
 */
export async function processSecurityNotificationOutbox(options?: {
  batchSize?: number;
}): Promise<SecurityNotificationDeliverySummary> {
  const { leaseToken, notifications } = await claimSecurityNotifications(
    options?.batchSize,
  );
  const summary: SecurityNotificationDeliverySummary = {
    claimed: notifications.length,
    deadLettered: 0,
    delivered: 0,
    failed: 0,
  };

  for (
    let offset = 0;
    offset < notifications.length;
    offset += DELIVERY_CONCURRENCY
  ) {
    await Promise.all(
      notifications
        .slice(offset, offset + DELIVERY_CONCURRENCY)
        .map(async (notification) => {
          try {
            await deliverSecurityNotification(notification);
            await markSecurityNotificationDelivered(
              notification.id,
              leaseToken,
            );
            summary.delivered += 1;
          } catch {
            const deadLettered = await markSecurityNotificationFailed(
              notification,
              leaseToken,
            );
            summary.failed += 1;
            if (deadLettered) summary.deadLettered += 1;
          }
        }),
    );
  }

  if (summary.failed > 0) {
    console.warn(
      JSON.stringify({
        event: 'security_notification.delivery_failure',
        ...summary,
      }),
    );
  }

  return summary;
}

/**
 * Drains several batches without turning a transient provider outage into a
 * long-running function. A failed batch stops the drain and remains retryable.
 */
export async function drainSecurityNotificationOutbox(options?: {
  batchSize?: number;
  maxBatches?: number;
}): Promise<SecurityNotificationDeliverySummary> {
  const batchSize = normalizedBatchSize(options?.batchSize);
  const requestedMaxBatches = Number.isFinite(options?.maxBatches)
    ? Math.trunc(options!.maxBatches!)
    : 3;
  const maxBatches = Math.max(1, Math.min(requestedMaxBatches, 4));
  const aggregate: SecurityNotificationDeliverySummary = {
    claimed: 0,
    deadLettered: 0,
    delivered: 0,
    failed: 0,
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await processSecurityNotificationOutbox({ batchSize });

    aggregate.claimed += result.claimed;
    aggregate.deadLettered += result.deadLettered;
    aggregate.delivered += result.delivered;
    aggregate.failed += result.failed;

    if (result.failed > 0 || result.claimed < batchSize) break;
  }

  return aggregate;
}

export async function deleteRetainedSecurityNotifications() {
  const client = await db.connect();

  try {
    await client.query(
      `
        DELETE FROM security_notification_outbox
        WHERE delivered_at < NOW() - INTERVAL '180 days'
           OR dead_at < NOW() - INTERVAL '365 days'
      `,
    );
  } finally {
    client.release();
  }
}

export async function getSecurityNotificationOutboxHealth(): Promise<SecurityNotificationOutboxHealth> {
  const client = await db.connect();

  try {
    const result = await client.query<{
      dead_lettered: string;
      oldest_pending_at: Date | null;
      pending: string;
    }>(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE delivered_at IS NULL AND dead_at IS NULL
          )::text AS pending,
          COUNT(*) FILTER (WHERE dead_at IS NOT NULL)::text AS dead_lettered,
          MIN(created_at) FILTER (
            WHERE delivered_at IS NULL AND dead_at IS NULL
          ) AS oldest_pending_at
        FROM security_notification_outbox
      `,
    );
    const health = result.rows[0];

    return {
      pending: Number(health?.pending ?? 0),
      deadLettered: Number(health?.dead_lettered ?? 0),
      oldestPendingAt: health?.oldest_pending_at?.toISOString() ?? null,
    };
  } finally {
    client.release();
  }
}
