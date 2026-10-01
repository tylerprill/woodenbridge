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
import {
  deleteRetainedAtlasMediaDeletions,
  drainAtlasMediaDeletionOutbox,
  getAtlasMediaDeletionOutboxHealth,
} from '@/app/lib/atlas/media-deletion-outbox';
import { cleanupExpiredAtlasMediaUploadIntents } from '@/app/lib/atlas/upload-intents';
import { cleanupCancelledAtlasImportBatches } from '@/app/lib/atlas/import-cleanup';

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

async function runCleanupTask<T>(
  failures: Set<string>,
  task: string,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch {
    failures.add(task);
    return undefined;
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: RESPONSE_HEADERS },
    );
  }

  try {
    const failures = new Set<string>();
    const run = <T>(task: string, operation: () => Promise<T>) =>
      runCleanupTask(failures, task, operation);

    const cleanupPasskeys = run('passkey_retention', () =>
      deleteExpiredPasskeyData(),
    );
    const cleanupRecoveryCodes = run('recovery_code_retention', () =>
      deleteExpiredRecoveryCodeData(),
    );
    const cleanupUploadIntents = run('atlas_upload_intent_cleanup', () =>
      cleanupExpiredAtlasMediaUploadIntents(),
    );
    const cleanupImports = run('atlas_import_cleanup', () =>
      cleanupCancelledAtlasImportBatches(),
    );
    const cleanupMediaDeletionRetention = run('media_deletion_retention', () =>
      deleteRetainedAtlasMediaDeletions(),
    );

    const baseMaintenance = [
      run('auth_rate_limit_retention', () => deleteExpiredAuthRateLimitData()),
      run('email_verification_retention', () =>
        deleteExpiredEmailVerificationData(),
      ),
      run('password_reset_retention', () => deleteExpiredPasswordResetData()),
      cleanupPasskeys,
      cleanupRecoveryCodes,
      run('security_event_retention', () => deleteExpiredSecurityEvents()),
      run('security_notification_retention', () =>
        deleteRetainedSecurityNotifications(),
      ),
      cleanupMediaDeletionRetention,
      cleanupUploadIntents,
      cleanupImports,
    ];
    const notificationDelivery = run('security_notification_delivery', () =>
      drainSecurityNotificationOutbox({ batchSize: 20, maxBatches: 4 }),
    );
    // Import and upload-intent cleanup can enqueue Blob pairs. Wait for those
    // specific producers, but drain existing work even when either one fails.
    const mediaDeletion = Promise.all([
      cleanupUploadIntents,
      cleanupImports,
      cleanupMediaDeletionRetention,
    ]).then(() =>
      run('media_deletion', () =>
        drainAtlasMediaDeletionOutbox({ batchSize: 20, maxBatches: 4 }),
      ),
    );
    // Session deletion cascades into passkey/recovery tables. Run it after
    // child-table retention settles to keep a single lock order, even if one
    // retention operation failed.
    const cleanupAuthenticatedSessions = Promise.all([
      cleanupPasskeys,
      cleanupRecoveryCodes,
    ]).then(() =>
      run('authenticated_session_retention', () =>
        deleteExpiredAuthenticatedSessions(),
      ),
    );

    await Promise.all([
      ...baseMaintenance,
      notificationDelivery,
      mediaDeletion,
      cleanupAuthenticatedSessions,
    ]);

    const atlasCleanup = {
      uploadIntents: await cleanupUploadIntents,
      imports: await cleanupImports,
    };
    const [notificationOutbox, mediaDeletionOutbox] = await Promise.all([
      run('security_notification_outbox_health', () =>
        getSecurityNotificationOutboxHealth(),
      ),
      run('media_deletion_outbox_health', () =>
        getAtlasMediaDeletionOutboxHealth(),
      ),
    ]);
    const mediaDeletionResult = await mediaDeletion;
    const notificationDeliveryResult = await notificationDelivery;
    const failedTasks = Array.from(failures).sort();

    if (failedTasks.length > 0) {
      recordSecurityEvent('maintenance.auth_cleanup', 'failure', {
        failedTaskCount: failedTasks.length,
        failedTasks: failedTasks.join(','),
      });

      return Response.json(
        {
          ok: false,
          error: 'Cleanup failed',
          failedTasks,
          mediaDeletion: mediaDeletionResult ?? null,
          mediaDeletionOutbox: mediaDeletionOutbox ?? null,
          notificationDelivery: notificationDeliveryResult ?? null,
          notificationOutbox: notificationOutbox ?? null,
        },
        { status: 500, headers: RESPONSE_HEADERS },
      );
    }

    if (
      notificationOutbox!.deadLettered > 0 ||
      mediaDeletionOutbox!.deadLettered > 0
    ) {
      recordSecurityEvent('maintenance.auth_cleanup', 'failure');

      return Response.json(
        {
          ok: false,
          error: 'Scheduled cleanup requires attention',
          mediaDeletion: mediaDeletionResult,
          mediaDeletionOutbox,
          notificationDelivery: notificationDeliveryResult,
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
        atlasCleanup,
        mediaDeletion: mediaDeletionResult,
        mediaDeletionOutbox,
        notificationDelivery: notificationDeliveryResult,
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
