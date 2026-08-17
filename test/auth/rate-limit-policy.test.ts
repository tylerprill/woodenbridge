import { db } from '@vercel/postgres';

import {
  LOGIN_LIMITS,
  SIGNUP_LIMITS,
  completeLoginAttempt,
  isAccountCreationAllowed,
  isLoginAttemptAllowed,
  reserveLoginAttempt,
} from '@/app/lib/auth/auth-rate-limit';

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

const connectMock = jest.mocked(db.connect);
const clientSqlMock = jest.fn();
const releaseMock = jest.fn();

function queryText(parts: TemplateStringsArray) {
  return Array.from(parts).join(' ');
}

describe('authentication rate-limit policy', () => {
  beforeEach(() => {
    clientSqlMock.mockResolvedValue({ rowCount: 0, rows: [] });
    connectMock.mockResolvedValue({
      release: releaseMock,
      sql: clientSqlMock,
    } as never);
  });

  it('allows login attempts below both limits', () => {
    expect(
      isLoginAttemptAllowed(
        LOGIN_LIMITS.emailFailures - 1,
        LOGIN_LIMITS.ipFailures - 1,
        LOGIN_LIMITS.emailAttempts - 1,
        LOGIN_LIMITS.ipAttempts - 1,
      ),
    ).toBe(true);
  });

  it('blocks login attempts when a failure or total ceiling is reached', () => {
    expect(isLoginAttemptAllowed(LOGIN_LIMITS.emailFailures, 0, 0, 0)).toBe(
      false,
    );
    expect(isLoginAttemptAllowed(0, LOGIN_LIMITS.ipFailures, 0, 0)).toBe(false);
    expect(isLoginAttemptAllowed(0, 0, LOGIN_LIMITS.emailAttempts, 0)).toBe(
      false,
    );
    expect(isLoginAttemptAllowed(0, 0, 0, LOGIN_LIMITS.ipAttempts)).toBe(false);
  });

  it('blocks account creation when either limit is reached', () => {
    expect(
      isAccountCreationAllowed(
        SIGNUP_LIMITS.emailRequests - 1,
        SIGNUP_LIMITS.ipRequests - 1,
      ),
    ).toBe(true);
    expect(isAccountCreationAllowed(SIGNUP_LIMITS.emailRequests, 0)).toBe(
      false,
    );
    expect(isAccountCreationAllowed(0, SIGNUP_LIMITS.ipRequests)).toBe(false);
  });

  it('counts successful and in-flight requests toward the total ceilings', async () => {
    clientSqlMock.mockImplementation(
      async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const query = queryText(parts);

        if (query.includes('AS email_attempt_count')) {
          return {
            rowCount: 1,
            rows: [
              {
                email_attempt_count: String(LOGIN_LIMITS.emailAttempts),
                email_count: '0',
                ip_attempt_count: '1',
                ip_count: '0',
              },
            ],
          };
        }

        return { rowCount: 0, rows: [], values };
      },
    );

    await expect(
      reserveLoginAttempt('a'.repeat(64), 'b'.repeat(64)),
    ).resolves.toBeUndefined();

    expect(
      clientSqlMock.mock.calls.some(([parts]) =>
        queryText(parts as TemplateStringsArray).includes(
          'INSERT INTO login_attempts',
        ),
      ),
    ).toBe(false);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('completes the reserved row and clears failures without erasing total-attempt history', async () => {
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('UPDATE login_attempts')) {
        return { rowCount: 1, rows: [{ id: '42' }] };
      }

      return { rowCount: 0, rows: [] };
    });

    await completeLoginAttempt({
      attemptId: '42',
      emailHash: 'c'.repeat(64),
      successful: true,
    });

    const statements = clientSqlMock.mock.calls.map(([parts]) =>
      queryText(parts as TemplateStringsArray),
    );
    const completion = statements.find(
      (query) =>
        query.includes('UPDATE login_attempts') &&
        query.includes('completed_at = clock_timestamp()'),
    );
    const cleanup = statements.find(
      (query) =>
        query.includes('UPDATE login_attempts') &&
        query.includes('failure_cleared_at = clock_timestamp()'),
    );

    expect(completion).toContain('completed_at = clock_timestamp()');
    expect(completion).toContain('completed_at IS NULL');
    expect(cleanup).toContain('successful = FALSE');
    expect(cleanup).toContain('completed_at IS NOT NULL');
    expect(cleanup).toContain('failure_cleared_at IS NULL');
    expect(cleanup).toContain('failure_cleared_at = clock_timestamp()');
    expect(statements.join(' ')).not.toContain('DELETE FROM login_attempts');
  });
});
