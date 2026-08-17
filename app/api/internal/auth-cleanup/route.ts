import { createHash, timingSafeEqual } from 'node:crypto';

import { deleteExpiredAuthRateLimitData } from '@/app/lib/auth/auth-rate-limit';
import { deleteExpiredEmailVerificationData } from '@/app/lib/auth/email-verification';
import { deleteExpiredPasswordResetData } from '@/app/lib/auth/reset-password';
import { deleteExpiredPasskeyData } from '@/app/lib/auth/passkeys';
import { deleteExpiredRecoveryCodeData } from '@/app/lib/auth/recovery-codes';
import { deleteExpiredSecurityEvents } from '@/app/lib/auth/security-event-store';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import {
  deleteRetainedSecurityNotifications,
  drainSecurityNotificationOutbox,
  getSecurityNotificationOutboxHealth,
} from '@/app/lib/auth/security-notification-outbox';
import { deleteExpiredAuthenticatedSessions } from '@/app/lib/auth/session-record';
import { cleanupExpiredAtlasMediaUploadIntents } from '@/app/lib/atlas/upload-intents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
} as const;

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return false;

  const providedAuthorization = request.headers.get('authorization') ?? '';
  const expectedAuthorization = `Bearer ${cronSecret}`;

  return timingSafeEqual(
    digest(providedAuthorization),
    digest(expectedAuthorization),
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: RESPONSE_HEADERS },
    );
  }

  try {
    const [, notificationDelivery] = await Promise.all([
      Promise.all([
        deleteExpiredAuthRateLimitData(),
        deleteExpiredEmailVerificationData(),
        deleteExpiredPasswordResetData(),
        deleteExpiredPasskeyData(),
        deleteExpiredRecoveryCodeData(),
        deleteExpiredSecurityEvents(),
        deleteRetainedSecurityNotifications(),
        cleanupExpiredAtlasMediaUploadIntents(),
      ]),
      drainSecurityNotificationOutbox({ batchSize: 20, maxBatches: 4 }),
    ]);
    // Session deletion cascades into passkey/recovery tables. Run it after
    // child-table retention to keep a single lock order across the cron job.
    await deleteExpiredAuthenticatedSessions();
    const notificationOutbox = await getSecurityNotificationOutboxHealth();

    if (notificationOutbox.deadLettered > 0) {
      recordSecurityEvent('maintenance.auth_cleanup', 'failure');

      return Response.json(
        {
          ok: false,
          error: 'Security notification delivery requires attention',
          notificationDelivery,
          notificationOutbox,
        },
        { status: 503, headers: RESPONSE_HEADERS },
      );
    }

    recordSecurityEvent('maintenance.auth_cleanup', 'success');

    return Response.json(
      {
        ok: true,
        completedAt: new Date().toISOString(),
        notificationDelivery,
        notificationOutbox,
      },
      { headers: RESPONSE_HEADERS },
    );
  } catch {
    recordSecurityEvent('maintenance.auth_cleanup', 'failure');

    return Response.json(
      { ok: false, error: 'Cleanup failed' },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
