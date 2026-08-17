import { sql } from '@vercel/postgres';

import {
  PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS,
  deleteExpiredPasskeyData,
} from '@/app/lib/auth/passkeys';

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

const sqlMock = jest.mocked(sql);

function statementAt(index: number) {
  const [parts] = sqlMock.mock.calls[index] ?? [];
  return Array.from(parts as TemplateStringsArray).join(' ');
}

describe('passkey ephemeral-data cleanup', () => {
  beforeEach(() => {
    sqlMock.mockResolvedValue({ rowCount: 0, rows: [] } as never);
  });

  it('removes expired challenges and stale reauthentication attempts', async () => {
    await deleteExpiredPasskeyData();

    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(statementAt(0)).toContain('DELETE FROM webauthn_challenges');
    expect(statementAt(0)).toContain('expires_at < NOW()');
    expect(statementAt(0)).toContain('used_at < NOW()');
    expect(statementAt(1)).toContain('DELETE FROM passkey_reauth_attempts');
    expect(statementAt(1)).toContain('attempted_at < NOW()');
    expect(sqlMock.mock.calls.flatMap((call) => call.slice(1))).toEqual([
      PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS,
      PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS,
      PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS,
    ]);
  });
});
