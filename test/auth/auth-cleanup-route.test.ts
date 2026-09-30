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
import { cleanupCancelledAtlasImportBatches } from '@/app/lib/atlas/import-cleanup';
import {
  deleteRetainedAtlasMediaDeletions,
  drainAtlasMediaDeletionOutbox,
  getAtlasMediaDeletionOutboxHealth,
} from '@/app/lib/atlas/media-deletion-outbox';
import { GET } from '@/app/api/internal/auth-cleanup/route';

jest.mock('@/app/lib/auth/auth-rate-limit', () => ({
  deleteExpiredAuthRateLimitData: jest.fn(),
}));
jest.mock('@/app/lib/auth/email-verification', () => ({
  deleteExpiredEmailVerificationData: jest.fn(),
}));
jest.mock('@/app/lib/auth/reset-password', () => ({
  deleteExpiredPasswordResetData: jest.fn(),
}));
jest.mock('@/app/lib/auth/passkeys', () => ({
  deleteExpiredPasskeyData: jest.fn(),
}));
jest.mock('@/app/lib/auth/recovery-codes', () => ({
  deleteExpiredRecoveryCodeData: jest.fn(),
}));
jest.mock('@/app/lib/auth/security-event-store', () => ({
  deleteExpiredSecurityEvents: jest.fn(),
}));
jest.mock('@/app/lib/auth/security-events', () => ({
  recordSecurityEvent: jest.fn(),
}));
jest.mock('@/app/lib/auth/security-notification-outbox', () => ({
  deleteRetainedSecurityNotifications: jest.fn(),
  drainSecurityNotificationOutbox: jest.fn(),
  getSecurityNotificationOutboxHealth: jest.fn(),
}));
jest.mock('@/app/lib/auth/session-record', () => ({
  deleteExpiredAuthenticatedSessions: jest.fn(),
}));
jest.mock('@/app/lib/atlas/upload-intents', () => ({
  cleanupExpiredAtlasMediaUploadIntents: jest.fn(),
}));
jest.mock('@/app/lib/atlas/import-cleanup', () => ({
  cleanupCancelledAtlasImportBatches: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-deletion-outbox', () => ({
  deleteRetainedAtlasMediaDeletions: jest.fn(),
  drainAtlasMediaDeletionOutbox: jest.fn(),
  getAtlasMediaDeletionOutboxHealth: jest.fn(),
}));

const cleanupRateLimits = jest.mocked(deleteExpiredAuthRateLimitData);
const cleanupVerification = jest.mocked(deleteExpiredEmailVerificationData);
const cleanupPasswordReset = jest.mocked(deleteExpiredPasswordResetData);
const cleanupPasskeys = jest.mocked(deleteExpiredPasskeyData);
const cleanupRecoveryCodes = jest.mocked(deleteExpiredRecoveryCodeData);
const cleanupSecurityEvents = jest.mocked(deleteExpiredSecurityEvents);
const cleanupSecurityNotifications = jest.mocked(
  deleteRetainedSecurityNotifications,
);
const deliverSecurityNotifications = jest.mocked(
  drainSecurityNotificationOutbox,
);
const readSecurityNotificationHealth = jest.mocked(
  getSecurityNotificationOutboxHealth,
);
const cleanupAuthenticatedSessions = jest.mocked(
  deleteExpiredAuthenticatedSessions,
);
const cleanupUploadIntents = jest.mocked(cleanupExpiredAtlasMediaUploadIntents);
const cleanupImports = jest.mocked(cleanupCancelledAtlasImportBatches);
const cleanupMediaDeletions = jest.mocked(deleteRetainedAtlasMediaDeletions);
const drainMediaDeletions = jest.mocked(drainAtlasMediaDeletionOutbox);
const readMediaDeletionHealth = jest.mocked(getAtlasMediaDeletionOutboxHealth);
const logSecurityEvent = jest.mocked(recordSecurityEvent);
const originalCronSecret = process.env.CRON_SECRET;

function cleanupRequest(authorization?: string) {
  return new Request('http://localhost/api/internal/auth-cleanup', {
    headers: authorization ? { authorization } : undefined,
  });
}

describe('scheduled authentication cleanup', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'ci-cron-secret';
    cleanupRateLimits.mockResolvedValue(undefined);
    cleanupVerification.mockResolvedValue(undefined);
    cleanupPasswordReset.mockResolvedValue(undefined);
    cleanupPasskeys.mockResolvedValue(undefined);
    cleanupRecoveryCodes.mockResolvedValue(undefined);
    cleanupSecurityEvents.mockResolvedValue(undefined);
    cleanupSecurityNotifications.mockResolvedValue(undefined);
    deliverSecurityNotifications.mockResolvedValue({
      claimed: 0,
      deadLettered: 0,
      delivered: 0,
      failed: 0,
    });
    readSecurityNotificationHealth.mockResolvedValue({
      deadLettered: 0,
      oldestPendingAt: null,
      pending: 0,
    });
    cleanupAuthenticatedSessions.mockResolvedValue(undefined);
    cleanupUploadIntents.mockResolvedValue({ cleaned: 2 });
    cleanupImports.mockResolvedValue({ cleaned: 1 });
    cleanupMediaDeletions.mockResolvedValue(undefined);
    drainMediaDeletions.mockResolvedValue({
      claimed: 0,
      completed: 0,
      deadLettered: 0,
      failed: 0,
    });
    readMediaDeletionHealth.mockResolvedValue({
      deadLettered: 0,
      oldestPendingAt: null,
      pending: 0,
    });
  });

  afterAll(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it('rejects requests without the cron bearer secret', async () => {
    const response = await GET(cleanupRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cleanupRateLimits).not.toHaveBeenCalled();
    expect(logSecurityEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the cron secret is not configured', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cleanupRequest('Bearer ci-cron-secret'));

    expect(response.status).toBe(401);
    expect(cleanupRateLimits).not.toHaveBeenCalled();
  });

  it('cleans each retained authentication data set', async () => {
    const response = await GET(cleanupRequest('Bearer ci-cron-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      atlasCleanup: {
        uploadIntents: { cleaned: 2 },
        imports: { cleaned: 1 },
      },
    });
    expect(cleanupRateLimits).toHaveBeenCalledTimes(1);
    expect(cleanupVerification).toHaveBeenCalledTimes(1);
    expect(cleanupPasswordReset).toHaveBeenCalledTimes(1);
    expect(cleanupPasskeys).toHaveBeenCalledTimes(1);
    expect(cleanupRecoveryCodes).toHaveBeenCalledTimes(1);
    expect(cleanupSecurityEvents).toHaveBeenCalledTimes(1);
    expect(cleanupSecurityNotifications).toHaveBeenCalledTimes(1);
    expect(cleanupMediaDeletions).toHaveBeenCalledTimes(1);
    expect(deliverSecurityNotifications).toHaveBeenCalledWith({
      batchSize: 20,
      maxBatches: 4,
    });
    expect(cleanupAuthenticatedSessions).toHaveBeenCalledTimes(1);
    expect(cleanupUploadIntents).toHaveBeenCalledTimes(1);
    expect(cleanupImports).toHaveBeenCalledTimes(1);
    expect(drainMediaDeletions).toHaveBeenCalledWith({
      batchSize: 20,
      maxBatches: 4,
    });
    expect(readMediaDeletionHealth).toHaveBeenCalledTimes(1);
    expect(logSecurityEvent).toHaveBeenCalledWith(
      'maintenance.auth_cleanup',
      'success',
    );
  });

  it('drains media deletion and reports a retryable failure when unrelated maintenance fails', async () => {
    cleanupPasswordReset.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    const response = await GET(cleanupRequest('Bearer ci-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'Cleanup failed',
      failedTasks: ['password_reset_retention'],
      mediaDeletion: {
        claimed: 0,
        completed: 0,
        deadLettered: 0,
        failed: 0,
      },
    });
    expect(drainMediaDeletions).toHaveBeenCalledWith({
      batchSize: 20,
      maxBatches: 4,
    });
    expect(cleanupAuthenticatedSessions).toHaveBeenCalledTimes(1);
    expect(logSecurityEvent).toHaveBeenCalledWith(
      'maintenance.auth_cleanup',
      'failure',
      {
        failedTaskCount: 1,
        failedTasks: 'password_reset_retention',
      },
    );
  });

  it('drains media deletion and reports every independent stage failure', async () => {
    cleanupPasswordReset.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    deliverSecurityNotifications.mockRejectedValueOnce(
      new Error('email provider unavailable'),
    );

    const response = await GET(cleanupRequest('Bearer ci-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'Cleanup failed',
      failedTasks: [
        'password_reset_retention',
        'security_notification_delivery',
      ],
      mediaDeletion: {
        claimed: 0,
        completed: 0,
        deadLettered: 0,
        failed: 0,
      },
      notificationDelivery: null,
    });
    expect(drainMediaDeletions).toHaveBeenCalledTimes(1);
  });

  it('drains pre-existing media work even when a queue producer fails', async () => {
    cleanupUploadIntents.mockRejectedValueOnce(
      new Error('upload intent conflict'),
    );

    const response = await GET(cleanupRequest('Bearer ci-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'Cleanup failed',
      failedTasks: ['atlas_upload_intent_cleanup'],
    });
    expect(drainMediaDeletions).toHaveBeenCalledTimes(1);
    expect(readMediaDeletionHealth).toHaveBeenCalledTimes(1);
  });

  it('raises an observable retryable failure when a notice is dead-lettered', async () => {
    deliverSecurityNotifications.mockResolvedValueOnce({
      claimed: 1,
      deadLettered: 1,
      delivered: 0,
      failed: 1,
    });
    readSecurityNotificationHealth.mockResolvedValueOnce({
      deadLettered: 1,
      oldestPendingAt: null,
      pending: 0,
    });

    const response = await GET(cleanupRequest('Bearer ci-cron-secret'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Scheduled cleanup requires attention',
      mediaDeletion: {
        claimed: 0,
        completed: 0,
        deadLettered: 0,
        failed: 0,
      },
      mediaDeletionOutbox: {
        deadLettered: 0,
        oldestPendingAt: null,
        pending: 0,
      },
      notificationDelivery: {
        claimed: 1,
        deadLettered: 1,
        delivered: 0,
        failed: 1,
      },
      notificationOutbox: {
        deadLettered: 1,
        oldestPendingAt: null,
        pending: 0,
      },
    });
    expect(logSecurityEvent).toHaveBeenCalledWith(
      'maintenance.auth_cleanup',
      'failure',
    );
  });

  it('raises an observable failure when media deletion is dead-lettered', async () => {
    drainMediaDeletions.mockResolvedValueOnce({
      claimed: 1,
      completed: 0,
      deadLettered: 1,
      failed: 0,
    });
    readMediaDeletionHealth.mockResolvedValueOnce({
      deadLettered: 1,
      oldestPendingAt: null,
      pending: 0,
    });

    const response = await GET(cleanupRequest('Bearer ci-cron-secret'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'Scheduled cleanup requires attention',
      mediaDeletion: { deadLettered: 1 },
      mediaDeletionOutbox: { deadLettered: 1 },
    });
    expect(logSecurityEvent).toHaveBeenCalledWith(
      'maintenance.auth_cleanup',
      'failure',
    );
  });
});
