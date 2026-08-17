import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { db } from '@/app/lib/db';
import {
  sendAccountStatusChangedEmail,
  sendPasskeyChangedEmail,
  sendPasswordChangedEmail,
  sendPrivilegedRecoveryEmail,
} from '@/app/lib/auth/recovery-email';
import {
  enqueueSecurityNotificationWithinTransaction,
  processSecurityNotificationOutbox,
  securityNotificationRetryDelaySeconds,
} from '@/app/lib/auth/security-notification-outbox';

jest.mock('@/app/lib/db', () => ({ db: { connect: jest.fn() } }));
jest.mock('@/app/lib/auth/recovery-email', () => ({
  sendAccountStatusChangedEmail: jest.fn(),
  sendPasskeyChangedEmail: jest.fn(),
  sendPasswordChangedEmail: jest.fn(),
  sendPrivilegedRecoveryEmail: jest.fn(),
}));

const connectMock = jest.mocked(db.connect);
const sendAccountStatusChangedEmailMock = jest.mocked(
  sendAccountStatusChangedEmail,
);
const sendPasskeyChangedEmailMock = jest.mocked(sendPasskeyChangedEmail);
const sendPasswordChangedEmailMock = jest.mocked(sendPasswordChangedEmail);
const sendPrivilegedRecoveryEmailMock = jest.mocked(
  sendPrivilegedRecoveryEmail,
);
const userId = 'cc248324-3a37-4112-be21-5b7e64a1e027';

function queryText(query: unknown) {
  return typeof query === 'string'
    ? query
    : Array.from(query as TemplateStringsArray).join(' ');
}

describe('durable security-notification outbox', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enqueues idempotently using an allowlisted, no-secret payload', async () => {
    const seen = new Set<string>();
    const query = jest.fn(async (_sql: string, values: unknown[]) => {
      const key = `${values[1]}:${values[2]}`;

      if (seen.has(key)) return { rows: [] };
      seen.add(key);
      return { rows: [{ id: 'notification-id' }] };
    });
    const client = { query } as never;
    const input = {
      userId,
      kind: 'recovery_code_used' as const,
      changeId: 'security-event-id',
      payload: { remainingCodes: 7 },
    };

    await expect(
      enqueueSecurityNotificationWithinTransaction(client, input),
    ).resolves.toBe('notification-id');
    await expect(
      enqueueSecurityNotificationWithinTransaction(client, input),
    ).resolves.toBeNull();

    const [statement, values] = query.mock.calls[0] ?? [];
    expect(statement).toContain('ON CONFLICT (kind, change_id) DO NOTHING');
    expect(values).toEqual([
      userId,
      'recovery_code_used',
      'security-event-id',
      JSON.stringify({ remainingCodes: 7 }),
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toMatch(
      /password|token|credential|FA-[A-Z0-9-]{20,}/i,
    );
  });

  it('rejects secret-bearing or extra fields before querying PostgreSQL', async () => {
    const query = jest.fn();
    const client = { query } as never;

    await expect(
      enqueueSecurityNotificationWithinTransaction(client, {
        userId,
        kind: 'recovery_codes_created',
        changeId: 'event-id',
        payload: { codes: ['FA-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'] } as never,
      }),
    ).rejects.toThrow();
    await expect(
      enqueueSecurityNotificationWithinTransaction(client, {
        userId,
        kind: 'password_changed',
        changeId: 'password-event-id',
        payload: { resetToken: 'plaintext-token' } as never,
      }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('claims with a lease and SKIP LOCKED, then marks successful delivery', async () => {
    const query = jest.fn(async (statement: string, _values?: unknown[]) => {
      if (statement.includes('WITH claimable')) {
        return {
          rows: [
            {
              id: 'notification-id',
              kind: 'passkey_added',
              change_id: 'passkey-id',
              recipient_email: 'admin@example.com',
              recipient_first_name: 'Ada',
              payload: { passkeyLabel: 'Primary passkey' },
              attempt_count: 1,
            },
          ],
        };
      }
      if (statement.includes('delivered_at = NOW()')) {
        return { rows: [{ id: 'notification-id' }] };
      }
      return { rows: [] };
    });
    const sql = jest.fn().mockResolvedValue({ rows: [] });
    const release = jest.fn();
    connectMock.mockResolvedValue({ query, sql, release } as never);

    await expect(processSecurityNotificationOutbox()).resolves.toEqual({
      claimed: 1,
      deadLettered: 0,
      delivered: 1,
      failed: 0,
    });

    const claim = query.mock.calls.find(([statement]) =>
      queryText(statement).includes('WITH claimable'),
    );
    expect(queryText(claim?.[0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(queryText(claim?.[0])).toContain(
      'leased_until IS NULL OR leased_until <= NOW()',
    );
    expect(sendPasskeyChangedEmailMock).toHaveBeenCalledWith({
      to: 'admin@example.com',
      firstName: 'Ada',
      changeId: 'passkey-id',
      action: 'added',
      passkeyLabel: 'Primary passkey',
    });
    expect(
      query.mock.calls.some(([statement]) =>
        queryText(statement).includes('lease_token = NULL'),
      ),
    ).toBe(true);
  });

  it('releases a failed lease with bounded backoff and a non-sensitive error code', async () => {
    sendPasswordChangedEmailMock.mockRejectedValueOnce(
      new Error('provider response included a private diagnostic'),
    );
    const query = jest.fn(async (statement: string, _values?: unknown[]) => {
      if (statement.includes('WITH claimable')) {
        return {
          rows: [
            {
              id: 'notification-id',
              kind: 'password_changed',
              change_id: 'password-change-id',
              recipient_email: 'admin@example.com',
              recipient_first_name: 'Ada',
              payload: {},
              attempt_count: 2,
            },
          ],
        };
      }
      if (statement.includes("last_error_code = 'delivery_failed'")) {
        return { rows: [{ id: 'notification-id', dead_at: null }] };
      }
      return { rows: [] };
    });
    connectMock.mockResolvedValue({
      query,
      sql: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    } as never);

    await expect(processSecurityNotificationOutbox()).resolves.toEqual({
      claimed: 1,
      deadLettered: 0,
      delivered: 0,
      failed: 1,
    });

    const failureUpdate = query.mock.calls.find(([statement]) =>
      queryText(statement).includes("last_error_code = 'delivery_failed'"),
    );
    expect(failureUpdate?.[1]).toEqual([
      'notification-id',
      expect.any(String),
      300,
      12,
    ]);
    expect(JSON.stringify(failureUpdate)).not.toContain('private diagnostic');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('security_notification.delivery_failure'),
    );
  });

  it('reclaims an expired twelfth-attempt lease and dead-letters only after a completed failure', async () => {
    sendPrivilegedRecoveryEmailMock.mockRejectedValueOnce(
      new Error('provider unavailable'),
    );
    const query = jest.fn(async (statement: string) => {
      if (statement.includes('WITH claimable')) {
        return {
          rows: [
            {
              id: 'notification-id',
              kind: 'recovery_completed',
              change_id: 'recovery-event-id',
              recipient_email: 'admin@example.com',
              recipient_first_name: 'Ada',
              payload: {},
              attempt_count: 12,
            },
          ],
        };
      }
      if (statement.includes("last_error_code = 'delivery_failed'")) {
        return {
          rows: [{ id: 'notification-id', dead_at: new Date() }],
        };
      }
      return { rows: [] };
    });
    connectMock.mockResolvedValue({
      query,
      sql: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    } as never);

    await expect(processSecurityNotificationOutbox()).resolves.toEqual({
      claimed: 1,
      deadLettered: 1,
      delivered: 0,
      failed: 1,
    });
    const claim = query.mock.calls.find(([statement]) =>
      queryText(statement).includes('WITH claimable'),
    );
    const claimText = queryText(claim?.[0]);
    expect(claimText).toContain('attempt_count = $1');
    expect(claimText).toContain('lease_token IS NOT NULL');
    expect(claimText).toContain('leased_until <= NOW()');
    expect(claimText).toContain('LEAST(notification.attempt_count + 1, $1)');
  });

  it('uses capped retry delays and a schema-level payload allowlist', async () => {
    expect(
      [1, 2, 3, 4, 5, 6, 12].map(securityNotificationRetryDelaySeconds),
    ).toEqual([60, 300, 900, 3600, 14_400, 43_200, 43_200]);

    const migration = await readFile(
      resolve('migrations/023_security_notification_outbox.sql'),
      'utf8',
    );
    expect(migration).toContain('UNIQUE (kind, change_id)');
    expect(migration).toContain('security_notification_outbox_safe_payload');
    expect(migration).toContain("payload ? 'passkeyLabel'");
    expect(migration).toContain("payload ? 'remainingCodes'");
    expect(migration).not.toMatch(
      /payload\s*->\s*'(?:password|token|code|credential)'/i,
    );
    expect(sendAccountStatusChangedEmailMock).not.toHaveBeenCalled();
  });
});
