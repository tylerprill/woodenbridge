import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { db } from '@/app/lib/db';
import {
  completeRecoveryWithinTransaction,
  consumeRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  isPrivilegedRecoveryAttemptAllowed,
  normalizeRecoveryCode,
  PRIVILEGED_RECOVERY_CODE_COUNT,
  PRIVILEGED_RECOVERY_LIMITS,
  regenerateRecoveryCodes,
} from '@/app/lib/auth/recovery-codes';

jest.mock('@/app/lib/db', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

const connectMock = jest.mocked(db.connect);
const clientSqlMock = jest.fn();
const clientQueryMock = jest.fn();
const releaseMock = jest.fn();
const userId = 'cc248324-3a37-4112-be21-5b7e64a1e027';
const sessionReference = 'a'.repeat(64);
const ipHash = 'b'.repeat(64);
const originalAuthSecret = process.env.AUTH_SECRET;
const originalHmacSecret = process.env.AUTH_HMAC_SECRET;

function queryText(parts: TemplateStringsArray | string) {
  return typeof parts === 'string' ? parts : Array.from(parts).join(' ');
}

function allSqlText() {
  return clientSqlMock.mock.calls
    .map(([parts]) => queryText(parts as TemplateStringsArray))
    .join('\n');
}

describe('privileged passkey recovery codes', () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = 'session-secret-material-that-is-long-enough';
    process.env.AUTH_HMAC_SECRET = 'independent-recovery-hmac-secret-material';
  });

  afterAll(() => {
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalAuthSecret;

    if (originalHmacSecret === undefined) delete process.env.AUTH_HMAC_SECRET;
    else process.env.AUTH_HMAC_SECRET = originalHmacSecret;
  });

  beforeEach(() => {
    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: releaseMock,
      sql: clientSqlMock,
    } as never);
  });

  it('generates high-entropy, human-readable codes with no duplicates', () => {
    const codes = Array.from({ length: 100 }, generateRecoveryCode);

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^FA-(?:[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-){5}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/,
        ),
      ]),
    );
  });

  it('normalizes separators, case, and common transcription ambiguities', () => {
    expect(normalizeRecoveryCode(' fa-abcd-efgh-jkmp-qrst-vwxy-z012 ')).toBe(
      'ABCDEFGHJKMPQRSTVWXYZ012',
    );
    expect(normalizeRecoveryCode('FA-OOOO-IIII-LLLL-0000-1111-2222')).toBe(
      '000011111111000011112222',
    );
    expect(normalizeRecoveryCode('not a recovery code')).toBeNull();
  });

  it('uses a user-bound HMAC and never returns plaintext as stored material', () => {
    const normalized = 'ABCDEFGHJKMPQRSTVWXYZ012';
    const first = hashRecoveryCode(userId, normalized);
    const anotherUser = hashRecoveryCode(
      '996cbbfc-8c35-4f09-a096-050cecfa23f5',
      normalized,
    );

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(normalized);
    expect(anotherUser).not.toBe(first);
  });

  it('enforces session, user, and IP failure ceilings independently', () => {
    expect(
      isPrivilegedRecoveryAttemptAllowed(
        PRIVILEGED_RECOVERY_LIMITS.sessionFailures - 1,
        PRIVILEGED_RECOVERY_LIMITS.userFailures - 1,
        PRIVILEGED_RECOVERY_LIMITS.ipFailures - 1,
      ),
    ).toBe(true);

    expect(
      isPrivilegedRecoveryAttemptAllowed(
        PRIVILEGED_RECOVERY_LIMITS.sessionFailures,
        0,
        0,
      ),
    ).toBe(false);
    expect(
      isPrivilegedRecoveryAttemptAllowed(
        0,
        PRIVILEGED_RECOVERY_LIMITS.userFailures,
        0,
      ),
    ).toBe(false);
    expect(
      isPrivilegedRecoveryAttemptAllowed(
        0,
        0,
        PRIVILEGED_RECOVERY_LIMITS.ipFailures,
      ),
    ).toBe(false);
  });

  it('stores only unique HMACs when replacing a code set', async () => {
    const createdAt = new Date('2026-08-17T12:00:00.000Z');

    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('AS has_passkey')) {
        return {
          rows: [{ has_passkey: true, has_recent_passkey_step_up: true }],
        };
      }
      if (
        query.includes('SELECT id') &&
        query.includes('FROM privileged_recovery_code_sets')
      ) {
        return { rows: [] };
      }
      if (query.includes('INSERT INTO privileged_recovery_code_sets')) {
        return { rows: [{ id: 'set-id', created_at: createdAt }] };
      }

      return { rows: [] };
    });
    clientQueryMock.mockResolvedValue({ rows: [] });

    const result = await regenerateRecoveryCodes({
      userId,
      sessionReference,
    });

    expect(result.status).toBe('issued');
    if (result.status !== 'issued') throw new Error('Expected issued codes.');
    expect(result.codes).toHaveLength(PRIVILEGED_RECOVERY_CODE_COUNT);

    const codeInsert = clientQueryMock.mock.calls.find(([query]) =>
      queryText(query as string).includes(
        'INSERT INTO privileged_recovery_codes',
      ),
    );
    const storedHashes = (codeInsert?.[1] as [string, string[]])?.[1];

    expect(storedHashes).toHaveLength(PRIVILEGED_RECOVERY_CODE_COUNT);
    expect(new Set(storedHashes).size).toBe(storedHashes.length);
    expect(storedHashes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)]),
    );
    for (const code of result.codes) {
      expect(storedHashes).not.toContain(code);
      expect(storedHashes).not.toContain(normalizeRecoveryCode(code));
    }
    const sql = allSqlText();
    expect(sql).toMatch(
      /UPDATE privileged_passkey_recovery_grants[\s\S]*consumed_at = COALESCE/,
    );
    expect(sql).toMatch(
      /UPDATE privileged_passkey_recovery_grants[\s\S]*clock_timestamp\(\)/,
    );
    expect(sql).toMatch(
      /UPDATE webauthn_challenges[\s\S]*purpose = 'registration'[\s\S]*used_at IS NULL/,
    );
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('serializes redemption, consumes a code once, and creates only a scoped grant', async () => {
    let used = false;
    let attemptNumber = 0;
    const expiresAt = new Date('2026-08-17T12:10:00.000Z');

    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (query.includes('AS session_count')) {
        return {
          rows: [{ session_count: '0', user_count: '0', ip_count: '0' }],
        };
      }
      if (query.includes('INSERT INTO privileged_recovery_attempts')) {
        attemptNumber += 1;
        return { rows: [{ id: String(attemptNumber) }] };
      }
      if (query.includes('SELECT auth_sessions.session_hash')) {
        return { rows: [{ session_hash: sessionReference }] };
      }
      if (query.includes('SELECT code.id, code.set_id')) {
        return used
          ? { rows: [] }
          : { rows: [{ id: 'code-id', set_id: 'set-id' }] };
      }
      if (query.includes('UPDATE privileged_recovery_codes')) {
        if (used) return { rows: [] };
        used = true;
        return { rows: [{ id: 'code-id' }] };
      }
      if (query.includes('INSERT INTO privileged_passkey_recovery_grants')) {
        return {
          rows: [
            {
              id: 'grant-id',
              created_at: new Date('2026-08-17T12:00:00.000Z'),
              expires_at: expiresAt,
            },
          ],
        };
      }
      if (query.includes('AS remaining_codes')) {
        return { rows: [{ remaining_codes: '9' }] };
      }

      return { rows: [] };
    });
    clientQueryMock.mockResolvedValue({ rows: [] });
    const code = 'FA-ABCD-EFGH-JKMP-QRST-VWXY-Z012';

    await expect(
      consumeRecoveryCode({
        userId,
        sessionReference,
        ipHash,
        codeInput: code,
      }),
    ).resolves.toMatchObject({
      status: 'used',
      grant: { grantId: 'grant-id', expiresAt: expiresAt.toISOString() },
      remainingCodes: 9,
    });
    await expect(
      consumeRecoveryCode({
        userId,
        sessionReference,
        ipHash,
        codeInput: code,
      }),
    ).resolves.toEqual({ status: 'invalid' });

    const sql = allSqlText();
    const boundValues = clientSqlMock.mock.calls.flatMap((call) =>
      call.slice(1),
    );
    expect(boundValues).toContain(`passkey-user:${userId}`);
    expect(boundValues).toContain(`recovery-session:${sessionReference}`);
    expect(boundValues).toContain(`recovery-ip:${ipHash}`);
    expect(sql).toContain('FOR UPDATE OF auth_sessions, users');
    expect(sql).toContain('FOR UPDATE OF code, code_set');
    expect(sql).toMatch(
      /UPDATE privileged_recovery_codes[\s\S]*used_at IS NULL/,
    );
    expect(sql).toMatch(
      /UPDATE privileged_recovery_codes[\s\S]*SET used_at = clock_timestamp\(\)/,
    );
    expect(sql).toContain('INSERT INTO privileged_passkey_recovery_grants');
    expect(sql).toMatch(
      /INSERT INTO privileged_passkey_recovery_grants[\s\S]*clock_timestamp\(\)/,
    );
    expect(sql).not.toContain('SET mfa_verified_at');
    expect(sql).not.toContain("mfa_method = 'passkey'");

    const durableEvents = clientQueryMock.mock.calls.filter(([query]) =>
      queryText(query as string).includes('INSERT INTO auth_security_events'),
    );
    expect(durableEvents).toHaveLength(1);
    expect(durableEvents[0]?.[1]).toEqual(
      expect.arrayContaining(['passkey.recovery_code_used', userId]),
    );
    const outbox = clientQueryMock.mock.calls.find(([query]) =>
      queryText(query as string).includes(
        'INSERT INTO security_notification_outbox',
      ),
    );
    expect(outbox?.[1]).toEqual([
      userId,
      'recovery_code_used',
      expect.any(String),
      JSON.stringify({ remainingCodes: 9 }),
    ]);
    expect(JSON.stringify(outbox)).not.toContain(code);
  });

  it('atomically consumes the one-purpose grant, revokes other sessions, and rotates codes', async () => {
    const client = {
      query: clientQueryMock,
      release: releaseMock,
      sql: clientSqlMock,
    };
    const createdAt = new Date('2026-08-17T12:30:00.000Z');

    clientSqlMock.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = queryText(parts);

      if (
        query.includes('UPDATE privileged_passkey_recovery_grants') &&
        query.includes('WHERE id =')
      ) {
        return { rows: [{ id: 'grant-id' }] };
      }
      if (query.includes('INSERT INTO privileged_recovery_code_sets')) {
        return { rows: [{ id: 'replacement-set', created_at: createdAt }] };
      }

      return { rows: [] };
    });
    clientQueryMock.mockResolvedValue({ rows: [] });

    const result = await completeRecoveryWithinTransaction({
      client: client as never,
      userId,
      sessionReference,
      recoveryGrantId: 'grant-id',
      passkeyId: 'replacement-passkey-id',
    });

    expect(result).toMatchObject({
      setId: 'replacement-set',
      totalCodes: PRIVILEGED_RECOVERY_CODE_COUNT,
      remainingCodes: PRIVILEGED_RECOVERY_CODE_COUNT,
      notification: { recoveryGrantId: 'grant-id' },
    });
    const sql = allSqlText();
    expect(sql).toMatch(
      /UPDATE auth_sessions[\s\S]*mfa_verified_at = NULL[\s\S]*mfa_method = NULL[\s\S]*session_hash <>/,
    );
    expect(sql).toMatch(/UPDATE webauthn_challenges[\s\S]*used_at/);
    expect(sql).toMatch(
      /UPDATE privileged_recovery_code_sets[\s\S]*revoked_at/,
    );
    expect(sql).toMatch(
      /UPDATE privileged_recovery_code_sets[\s\S]*clock_timestamp\(\)/,
    );

    const durableEvent = clientQueryMock.mock.calls.find(([query]) =>
      queryText(query as string).includes('INSERT INTO auth_security_events'),
    );
    expect(durableEvent?.[1]).toEqual(
      expect.arrayContaining(['passkey.recovery_completed', userId]),
    );
    const outbox = clientQueryMock.mock.calls.find(([query]) =>
      queryText(query as string).includes(
        'INSERT INTO security_notification_outbox',
      ),
    );
    expect(outbox?.[1]).toEqual([
      userId,
      'recovery_completed',
      expect.any(String),
      '{}',
    ]);
  });

  it('codifies one active set, one active session grant, hash-only storage, and passkey-only MFA', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'migrations/020_privileged_recovery_codes.sql'),
      'utf8',
    );
    const source = await readFile(
      resolve(process.cwd(), 'app/lib/auth/recovery-codes.ts'),
      'utf8',
    );
    const redemptionSource = source.slice(
      source.indexOf('export async function consumeRecoveryCode'),
      source.indexOf('export async function getRecoveryGrantWithinTransaction'),
    );

    expect(migration).toMatch(
      /privileged_recovery_code_sets_active_user_idx[\s\S]*WHERE revoked_at IS NULL/,
    );
    expect(migration).toMatch(
      /privileged_passkey_recovery_grants_active_session_idx[\s\S]*WHERE consumed_at IS NULL/,
    );
    expect(migration).toMatch(/code_hash CHAR\(64\) NOT NULL UNIQUE/);
    expect(migration).not.toMatch(/plaintext|plain_text|code_value/i);
    expect(migration).toMatch(
      /mfa_verified_at IS NOT NULL[\s\S]*mfa_method = 'passkey'/,
    );
    expect(redemptionSource).not.toContain('UPDATE auth_sessions');
    expect(redemptionSource).not.toContain('mfa_verified_at');
    expect(redemptionSource).toContain("'passkey.recovery_code_used'");
  });
});
