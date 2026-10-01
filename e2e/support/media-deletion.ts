import type { APIRequestContext } from '@playwright/test';
import { Client } from 'pg';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MediaDeletionCleanupResult = {
  completed: number;
  deadLettered: number;
  pending: number;
  released: number;
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function requireIsolatedDatabase(expectedDatabaseName: string) {
  if (
    process.env.E2E_DATABASE_ADAPTER !== 'pg' ||
    process.env.E2E_MEDIA_STORAGE_ADAPTER !== 'filesystem' ||
    process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER !== 'filesystem' ||
    process.env.E2E_BASE_URL ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV
  ) {
    throw new Error(
      'Media deletion cleanup requires an owned loopback server, PostgreSQL fixture, and isolated filesystem storage.',
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to drain fixture media.');
  }

  let connection: URL;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  const overridesAuthorityHost = Array.from(
    connection.searchParams.keys(),
  ).some((key) => key.toLowerCase() === 'host');
  if (
    !['postgres:', 'postgresql:'].includes(connection.protocol) ||
    !LOOPBACK_HOSTS.has(connection.hostname.toLowerCase()) ||
    connection.pathname !== `/${expectedDatabaseName}` ||
    overridesAuthorityHost ||
    connection.hash
  ) {
    throw new Error(
      'Media deletion cleanup must target the expected loopback fixture database.',
    );
  }

  return connectionString;
}

/**
 * Advances only fixture-owned deletion jobs past the signed-upload safety
 * fence, then exercises the real scheduled-maintenance route. Production keeps
 * the full 15-minute fence; deterministic E2E suites do not need to sleep.
 */
export async function matureAndDrainFixtureMediaDeletions(
  request: APIRequestContext,
  {
    expectedDatabaseName,
    minimumQueued = 1,
    userId,
  }: {
    expectedDatabaseName: string;
    minimumQueued?: number;
    userId: string;
  },
): Promise<MediaDeletionCleanupResult> {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error('Fixture media deletion cleanup requires a UUID user ID.');
  }
  if (!Number.isSafeInteger(minimumQueued) || minimumQueued < 0) {
    throw new Error('minimumQueued must be a non-negative safe integer.');
  }

  const connectionString = requireIsolatedDatabase(expectedDatabaseName);
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    throw new Error('CRON_SECRET is required to drain fixture media.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const released = await client.query(
      `
        UPDATE atlas_media_deletion_outbox
        SET available_at = LEAST(available_at, NOW())
        WHERE user_id = $1
          AND completed_at IS NULL
          AND dead_at IS NULL
      `,
      [userId],
    );
    if ((released.rowCount ?? 0) < minimumQueued) {
      throw new Error(
        `Expected at least ${minimumQueued} queued fixture media deletion(s), found ${released.rowCount ?? 0}.`,
      );
    }

    const response = await request.get('/api/internal/auth-cleanup', {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const responseText = await response.text();
    if (response.status() !== 200) {
      throw new Error(
        `Fixture media cleanup returned ${response.status()}: ${responseText.slice(0, 500)}`,
      );
    }

    let responseBody: { ok?: unknown };
    try {
      responseBody = JSON.parse(responseText) as { ok?: unknown };
    } catch {
      throw new Error('Fixture media cleanup did not return JSON.');
    }
    if (responseBody.ok !== true) {
      throw new Error('Fixture media cleanup did not report success.');
    }

    const deadline = Date.now() + 10_000;
    let result: MediaDeletionCleanupResult;
    do {
      const state = await client.query<{
        completed: string;
        dead_lettered: string;
        pending: string;
      }>(
        `
          SELECT
            COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::text AS completed,
            COUNT(*) FILTER (WHERE dead_at IS NOT NULL)::text AS dead_lettered,
            COUNT(*) FILTER (
              WHERE completed_at IS NULL AND dead_at IS NULL
            )::text AS pending
          FROM atlas_media_deletion_outbox
          WHERE user_id = $1
        `,
        [userId],
      );
      const queue = state.rows[0];
      result = {
        completed: Number(queue?.completed ?? 0),
        deadLettered: Number(queue?.dead_lettered ?? 0),
        pending: Number(queue?.pending ?? 0),
        released: released.rowCount ?? 0,
      };
      if (result.pending === 0 || result.deadLettered > 0) break;
      await wait(100);
    } while (Date.now() < deadline);

    if (result.pending !== 0 || result.deadLettered !== 0) {
      throw new Error(
        `Fixture media cleanup left ${result.pending} pending and ${result.deadLettered} dead-lettered deletion(s).`,
      );
    }
    return result;
  } finally {
    await client.end();
  }
}
