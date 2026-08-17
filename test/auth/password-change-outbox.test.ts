import { db } from '@vercel/postgres';

import {
  consumePasswordResetToken,
  hashResetToken,
} from '@/app/lib/auth/reset-password';

const clientSqlMock = jest.fn();
const clientQueryMock = jest.fn();
const releaseMock = jest.fn();

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

const connectMock = jest.mocked(db.connect);
const userId = 'cc248324-3a37-4112-be21-5b7e64a1e027';

function queryText(parts: TemplateStringsArray) {
  return Array.from(parts).join(' ');
}

describe('password-change security notification', () => {
  beforeEach(() => {
    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: releaseMock,
      sql: clientSqlMock,
    } as never);
    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('SELECT password_reset_tokens.user_id')) {
        return { rows: [{ user_id: userId }] };
      }
      if (query.includes('users.first_name')) {
        return {
          rows: [
            {
              user_id: userId,
              id: userId,
              email: 'ada@example.com',
              first_name: 'Ada',
              last_name: 'Atlas',
            },
          ],
        };
      }

      return { rows: [] };
    });
    clientQueryMock.mockResolvedValue({
      rows: [{ id: 'notification-id' }],
    });
  });

  it('commits the no-secret notice atomically with password replacement', async () => {
    const token = 'a'.repeat(43);
    const hashedPassword = '$argon2id$stored-password-hash';

    await expect(
      consumePasswordResetToken(token, hashedPassword),
    ).resolves.toMatchObject({ id: userId, email: 'ada@example.com' });

    const outboxCall = clientQueryMock.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO security_notification_outbox'),
    );
    expect(outboxCall?.[1]).toEqual([
      userId,
      'password_changed',
      hashResetToken(token),
      '{}',
    ]);
    expect(JSON.stringify(outboxCall)).not.toContain(token);
    expect(JSON.stringify(outboxCall)).not.toContain(hashedPassword);

    const commitCall = clientSqlMock.mock.calls.find(([parts]) =>
      queryText(parts as TemplateStringsArray).includes('COMMIT'),
    );
    expect(
      clientQueryMock.mock.invocationCallOrder[
        clientQueryMock.mock.calls.indexOf(outboxCall!)
      ],
    ).toBeLessThan(
      clientSqlMock.mock.invocationCallOrder[
        clientSqlMock.mock.calls.indexOf(commitCall!)
      ]!,
    );
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
