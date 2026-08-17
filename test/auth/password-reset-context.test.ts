import { sql } from '@vercel/postgres';

import {
  findPasswordResetContext,
  findRecoveryUser,
  isPasswordResetTokenValid,
} from '@/app/lib/auth/reset-password';

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

const sqlMock = jest.mocked(sql);

function statementText(call: unknown[]) {
  const [parts] = call as [TemplateStringsArray];
  return Array.from(parts).join(' ').replace(/\s+/g, ' ').trim();
}

describe('password recovery account context', () => {
  beforeEach(() => {
    sqlMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
  });

  it('only issues recovery for active, verified accounts', async () => {
    await findRecoveryUser('traveler@example.com');

    const query = statementText(sqlMock.mock.calls[0] as unknown[]);
    expect(query).toContain('email_verified_at IS NOT NULL');
    expect(query).toContain("account_status = 'active'");
  });

  it('rejects malformed tokens without touching the database', async () => {
    await expect(
      findPasswordResetContext('not-a-token'),
    ).resolves.toBeUndefined();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('binds password screening and form validity to the same eligible account', async () => {
    const token = 'a'.repeat(43);
    await findPasswordResetContext(token);
    await isPasswordResetTokenValid(token);

    for (const call of sqlMock.mock.calls) {
      const query = statementText(call as unknown[]);
      expect(query).toContain('INNER JOIN users');
      expect(query).toContain('email_verified_at IS NOT NULL');
      expect(query).toContain("account_status = 'active'");
      expect(query).toContain('expires_at > NOW()');
      expect(query).toContain('used_at IS NULL');
    }
  });
});
