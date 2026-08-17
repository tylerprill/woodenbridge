import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { db } from '@vercel/postgres';

import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from '@/app/lib/auth/reset-password';

const mockClientSql = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock('@vercel/postgres', () => ({
  db: {
    connect: jest.fn(async () => ({
      query: mockClientQuery,
      release: mockRelease,
      sql: mockClientSql,
    })),
  },
  sql: jest.fn(),
}));

describe('password reset token issuance', () => {
  beforeEach(() => {
    mockClientQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    mockClientSql.mockImplementation(async (parts) => {
      const statement = Array.from(parts as TemplateStringsArray).join(' ');

      if (statement.includes('SELECT 1') && statement.includes('FROM users')) {
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      }

      return { rowCount: 0, rows: [] };
    });
  });

  it('serializes token replacement for each user before invalidating and inserting', async () => {
    const userId = 'e1bc6706-060c-448f-9976-0273a66b35c1';

    await createPasswordResetToken(userId);

    expect(db.connect).toHaveBeenCalledTimes(1);
    const statements = mockClientSql.mock.calls.map(([parts, ...values]) => ({
      sql: Array.from(parts as TemplateStringsArray).join(' '),
      values,
    }));
    const lockIndex = statements.findIndex(({ sql }) =>
      sql.includes('pg_advisory_xact_lock'),
    );
    const eligibilityIndex = statements.findIndex(
      ({ sql }) => sql.includes('SELECT 1') && sql.includes('FROM users'),
    );
    const invalidateIndex = statements.findIndex(({ sql }) =>
      sql.includes('UPDATE password_reset_tokens'),
    );
    const insertIndex = statements.findIndex(({ sql }) =>
      sql.includes('INSERT INTO password_reset_tokens'),
    );

    expect(lockIndex).toBeGreaterThan(0);
    expect(eligibilityIndex).toBeGreaterThan(lockIndex);
    expect(eligibilityIndex).toBeLessThan(invalidateIndex);
    expect(invalidateIndex).toBeLessThan(insertIndex);
    expect(statements[lockIndex].values).toContain(
      `password-reset-user:${userId}`,
    );
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('does not issue a token when suspension wins the account lock', async () => {
    const userId = 'ecbb20c3-1997-49b5-9132-340a5cf4182c';
    mockClientSql.mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(createPasswordResetToken(userId)).resolves.toBeUndefined();

    const statements = mockClientSql.mock.calls.map(([parts]) =>
      Array.from(parts as TemplateStringsArray).join(' '),
    );
    const eligibilityIndex = statements.findIndex(
      (sql) => sql.includes('SELECT 1') && sql.includes('FROM users'),
    );
    const rollbackIndex = statements.findIndex((sql) =>
      sql.includes('ROLLBACK'),
    );

    expect(eligibilityIndex).toBeGreaterThan(0);
    expect(rollbackIndex).toBeGreaterThan(eligibilityIndex);
    expect(
      statements.some((sql) => sql.includes('UPDATE password_reset_tokens')),
    ).toBe(false);
    expect(
      statements.some((sql) =>
        sql.includes('INSERT INTO password_reset_tokens'),
      ),
    ).toBe(false);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('enforces one active token per user at the database boundary', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'migrations/015_session_hardening.sql'),
      'utf8',
    );

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX password_reset_tokens_active_user_idx\s+ON password_reset_tokens \(user_id\)\s+WHERE used_at IS NULL;/,
    );
  });

  it('rechecks token and account eligibility under the issuance lock before redemption', async () => {
    const userId = '45b56f16-c1fd-4ae9-a08e-16d035aec574';
    const token = 'a'.repeat(43);
    const resetUser = {
      user_id: userId,
      id: userId,
      email: 'traveler@example.com',
      first_name: 'Field',
      last_name: 'Traveler',
    };

    mockClientSql.mockImplementation(async (parts) => {
      const statement = Array.from(parts as TemplateStringsArray).join(' ');

      if (
        statement.includes('SELECT password_reset_tokens.user_id') &&
        !statement.includes('FOR UPDATE')
      ) {
        return { rowCount: 1, rows: [{ user_id: userId }] };
      }

      if (statement.includes('FOR UPDATE OF password_reset_tokens, users')) {
        return { rowCount: 1, rows: [resetUser] };
      }

      return { rowCount: 0, rows: [] };
    });

    await expect(
      consumePasswordResetToken(token, '$argon2id$replacement'),
    ).resolves.toEqual(resetUser);

    const statements = mockClientSql.mock.calls.map(([parts, ...values]) => ({
      sql: Array.from(parts as TemplateStringsArray)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      values,
    }));
    const candidateIndex = statements.findIndex(
      ({ sql }) =>
        sql.includes('SELECT password_reset_tokens.user_id') &&
        !sql.includes('FOR UPDATE'),
    );
    const lockIndex = statements.findIndex(({ sql }) =>
      sql.includes('pg_advisory_xact_lock'),
    );
    const lockedEligibilityIndex = statements.findIndex(({ sql }) =>
      sql.includes('FOR UPDATE OF password_reset_tokens, users'),
    );
    const userUpdateIndex = statements.findIndex(({ sql }) =>
      sql.includes('UPDATE users'),
    );
    const sessionRevocationIndex = statements.findIndex(({ sql }) =>
      sql.includes('UPDATE auth_sessions'),
    );
    const tokenInvalidationIndex = statements.findIndex(({ sql }) =>
      sql.includes('UPDATE password_reset_tokens'),
    );

    expect(candidateIndex).toBeGreaterThan(0);
    expect(candidateIndex).toBeLessThan(lockIndex);
    expect(lockIndex).toBeLessThan(lockedEligibilityIndex);
    expect(lockedEligibilityIndex).toBeLessThan(userUpdateIndex);
    expect(userUpdateIndex).toBeLessThan(sessionRevocationIndex);
    expect(sessionRevocationIndex).toBeLessThan(tokenInvalidationIndex);
    const outboxCall = mockClientQuery.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO security_notification_outbox'),
    );
    expect(outboxCall?.[1]).toEqual([
      userId,
      'password_changed',
      expect.any(String),
      '{}',
    ]);
    expect(
      mockClientQuery.mock.invocationCallOrder[
        mockClientQuery.mock.calls.indexOf(outboxCall!)
      ],
    ).toBeLessThan(
      mockClientSql.mock.invocationCallOrder[
        mockClientSql.mock.calls.findIndex(([parts]) =>
          Array.from(parts as TemplateStringsArray)
            .join(' ')
            .includes('COMMIT'),
        )
      ]!,
    );
    expect(statements[lockIndex].values).toContain(
      `password-reset-user:${userId}`,
    );

    const eligibilitySql = statements[lockedEligibilityIndex].sql;
    expect(eligibilitySql).toContain('used_at IS NULL');
    expect(eligibilitySql).toContain('expires_at > NOW()');
    expect(eligibilitySql).toContain('email_verified_at IS NOT NULL');
    expect(eligibilitySql).toContain("account_status = 'active'");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
