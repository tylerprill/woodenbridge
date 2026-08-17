import { db, sql } from '@vercel/postgres';

import {
  MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER,
  SESSION_ABSOLUTE_LIFETIME_SECONDS,
  SessionCapacityError,
  createAuthenticatedSession,
  createSessionId,
  deleteExpiredAuthenticatedSessions,
  getSessionAbsoluteExpiration,
  hashSessionId,
  isAuthenticatedSessionRowValid,
  isSessionId,
  isSessionReference,
  toEpochSeconds,
  type AuthenticatedSessionRow,
} from '@/app/lib/auth/session-record';

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

const sqlMock = jest.mocked(sql);
const connectMock = jest.mocked(db.connect);
const clientSqlMock = jest.fn();
const releaseMock = jest.fn();

function queryText(parts: TemplateStringsArray) {
  return Array.from(parts).join(' ');
}

function createValidRow(
  overrides: Partial<AuthenticatedSessionRow> = {},
): AuthenticatedSessionRow {
  return {
    account_status: 'active',
    absolute_expires_at: new Date('2026-08-18T12:00:00.000Z'),
    authenticated_at: new Date('2026-08-17T12:00:00.000Z'),
    email_verified_at: new Date('2026-08-01T12:00:00.000Z'),
    mfa_method: null,
    mfa_verified_at: null,
    revoked_at: null,
    role: 'admin',
    session_version: 4,
    ...overrides,
  };
}

describe('authenticated session records', () => {
  beforeEach(() => {
    sqlMock.mockResolvedValue({ rowCount: 1, rows: [] } as never);
    clientSqlMock.mockResolvedValue({ rowCount: 1, rows: [] });
    connectMock.mockResolvedValue({
      release: releaseMock,
      sql: clientSqlMock,
    } as never);
  });

  it('creates an unpredictable session identifier and a one-way reference', () => {
    const first = createSessionId();
    const second = createSessionId();
    const reference = hashSessionId(first);

    expect(first).not.toBe(second);
    expect(isSessionId(first)).toBe(true);
    expect(isSessionReference(reference)).toBe(true);
    expect(reference).not.toContain(first);
  });

  it('stores only the hash while returning the raw id for the encrypted JWT', async () => {
    const authenticatedAt = new Date('2026-08-17T12:00:00.000Z');
    const result = await createAuthenticatedSession(
      '2a88e2c9-a061-4ec8-8686-569199b8468a',
      'owner',
      authenticatedAt,
    );
    const insertCall = clientSqlMock.mock.calls.find(([parts]) =>
      queryText(parts as TemplateStringsArray).includes(
        'INSERT INTO auth_sessions',
      ),
    );
    const sqlArguments = insertCall?.slice(1) ?? [];

    expect(sqlArguments).toContain(hashSessionId(result.sessionId));
    expect(sqlArguments).not.toContain(result.sessionId);
    expect(result.authenticatedAt).toBe(toEpochSeconds(authenticatedAt));
  });

  it('serializes session creation and retires the oldest active sessions', async () => {
    await createAuthenticatedSession(
      '2a88e2c9-a061-4ec8-8686-569199b8468a',
      'user',
      new Date('2026-08-17T12:00:00.000Z'),
    );

    const statements = clientSqlMock.mock.calls.map(([parts]) =>
      queryText(parts as TemplateStringsArray),
    );
    const lockIndex = statements.findIndex((query) =>
      query.includes('pg_advisory_xact_lock'),
    );
    const insertIndex = statements.findIndex((query) =>
      query.includes('INSERT INTO auth_sessions'),
    );
    const pruneIndex = statements.findIndex((query) =>
      query.includes('ranked_active_sessions'),
    );

    expect(statements[0]).toContain('BEGIN');
    expect(lockIndex).toBeGreaterThan(0);
    expect(insertIndex).toBeGreaterThan(lockIndex);
    expect(pruneIndex).toBeGreaterThan(insertIndex);
    expect(statements.at(-1)).toContain('COMMIT');
    expect(statements[pruneIndex]).toMatch(
      /mfa_verified_at IS NOT NULL\) DESC,[\s\S]*session_hash =/,
    );
    expect(clientSqlMock.mock.calls[pruneIndex]?.slice(1)).toContain(
      MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER,
    );
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back a new login instead of evicting a full protected session set', async () => {
    clientSqlMock.mockImplementation(
      async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const query = queryText(parts);

        if (query.includes('ranked_active_sessions')) {
          return {
            rowCount: 1,
            rows: [{ session_hash: values[0] }],
          };
        }

        return { rowCount: 0, rows: [] };
      },
    );

    await expect(
      createAuthenticatedSession(
        '2a88e2c9-a061-4ec8-8686-569199b8468a',
        'owner',
      ),
    ).rejects.toBeInstanceOf(SessionCapacityError);

    const statements = clientSqlMock.mock.calls.map(([parts]) =>
      queryText(parts as TemplateStringsArray),
    );

    expect(statements.some((query) => query.includes('ROLLBACK'))).toBe(true);
    expect(statements.some((query) => query.includes('COMMIT'))).toBe(false);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the connection when session persistence fails', async () => {
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('INSERT INTO auth_sessions')) {
        throw new Error('database unavailable');
      }

      return { rowCount: 0, rows: [] };
    });

    await expect(
      createAuthenticatedSession(
        '2a88e2c9-a061-4ec8-8686-569199b8468a',
        'user',
      ),
    ).rejects.toThrow('database unavailable');

    expect(
      clientSqlMock.mock.calls.some(([parts]) =>
        queryText(parts as TemplateStringsArray).includes('ROLLBACK'),
      ),
    ).toBe(true);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('uses a shorter immutable absolute lifetime for privileged roles', () => {
    const authenticatedAt = new Date('2026-08-17T12:00:00.000Z');

    expect(
      getSessionAbsoluteExpiration('user', authenticatedAt).getTime() -
        authenticatedAt.getTime(),
    ).toBe(SESSION_ABSOLUTE_LIFETIME_SECONDS.user * 1_000);
    expect(SESSION_ABSOLUTE_LIFETIME_SECONDS.admin).toBeLessThan(
      SESSION_ABSOLUTE_LIFETIME_SECONDS.user,
    );
    expect(SESSION_ABSOLUTE_LIFETIME_SECONDS.owner).toBe(
      SESSION_ABSOLUTE_LIFETIME_SECONDS.admin,
    );
  });

  it('requires the active account, original authentication time, version, and lifetime', () => {
    const claims = {
      authenticatedAt: toEpochSeconds(new Date('2026-08-17T12:00:00.000Z')),
      sessionVersion: 4,
    };
    const now = new Date('2026-08-17T13:00:00.000Z');

    expect(isAuthenticatedSessionRowValid(createValidRow(), claims, now)).toBe(
      true,
    );
    expect(
      isAuthenticatedSessionRowValid(
        createValidRow({ account_status: 'suspended' }),
        claims,
        now,
      ),
    ).toBe(false);
    expect(
      isAuthenticatedSessionRowValid(
        createValidRow({ revoked_at: new Date() }),
        claims,
        now,
      ),
    ).toBe(false);
    expect(
      isAuthenticatedSessionRowValid(
        createValidRow({ absolute_expires_at: now }),
        claims,
        now,
      ),
    ).toBe(false);
    expect(
      isAuthenticatedSessionRowValid(
        createValidRow({ authenticated_at: new Date('2026-08-17T12:00:01Z') }),
        claims,
        now,
      ),
    ).toBe(false);
    expect(
      isAuthenticatedSessionRowValid(
        createValidRow({ session_version: 5 }),
        claims,
        now,
      ),
    ).toBe(false);
  });

  it('removes expired and revoked session records after a short grace period', async () => {
    await deleteExpiredAuthenticatedSessions();

    const [parts] = sqlMock.mock.calls.at(-1) ?? [];
    const statement = Array.from(parts as TemplateStringsArray).join(' ');

    expect(statement).toContain('DELETE FROM auth_sessions');
    expect(statement).toContain(
      "absolute_expires_at < NOW() - INTERVAL '1 day'",
    );
    expect(statement).toContain("revoked_at < NOW() - INTERVAL '1 day'");
  });
});
