import 'server-only';

import { after } from 'next/server';

import { drainAtlasMediaDeletionOutbox } from './media-deletion-outbox';

/**
 * Request-lifetime accelerator only. The durable database row is authoritative;
 * the authenticated maintenance route retries work when this callback cannot
 * run or the Blob service is temporarily unavailable.
 */
export function scheduleAtlasMediaDeletion() {
  try {
    after(async () => {
      try {
        await drainAtlasMediaDeletionOutbox({ batchSize: 8, maxBatches: 3 });
      } catch (error) {
        console.error('Atlas media deletion accelerator failed:', error);
      }
    });
  } catch {
    // Direct scripts and isolated unit tests do not have a request lifecycle.
  }
}
