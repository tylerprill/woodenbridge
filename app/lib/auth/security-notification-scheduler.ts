import 'server-only';

import { after } from 'next/server';

import { drainSecurityNotificationOutbox } from './security-notification-outbox';

/**
 * Request-lifetime accelerator only. The durable row is authoritative and the
 * authenticated cron worker will retry it even when this callback never runs.
 */
export function scheduleSecurityNotificationDelivery() {
  try {
    after(async () => {
      try {
        await drainSecurityNotificationOutbox({
          batchSize: 8,
          maxBatches: 3,
        });
      } catch (error) {
        console.error('Security notification accelerator failed:', error);
      }
    });
  } catch {
    // Direct script and isolated unit-test invocation has no request lifecycle.
  }
}
