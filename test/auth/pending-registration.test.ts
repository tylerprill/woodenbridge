jest.mock('@vercel/postgres', () => {
  const clientSql = jest.fn();
  const release = jest.fn();
  const client = { sql: clientSql, release };
  const connect = jest.fn(async () => client);
  const sql = jest.fn();

  return {
    db: { connect },
    sql,
    __testMocks: { clientSql, release, connect, sql },
  };
});

import {
  createPendingRegistrationChallenge,
  verifyPendingRegistrationCode,
} from '@/app/lib/auth/email-verification';
import { hashEmailVerificationCode } from '@/app/lib/auth/security';

const { __testMocks } = jest.requireMock('@vercel/postgres') as {
  __testMocks: {
    clientSql: jest.Mock;
    release: jest.Mock;
    connect: jest.Mock;
    sql: jest.Mock;
  };
};
const mockClientSql = __testMocks.clientSql;
const mockRelease = __testMocks.release;
const mockDbConnect = __testMocks.connect;
const mockSql = __testMocks.sql;

const challengeId = 'a'.repeat(43);
const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnaWVzdA';

function queryText(strings: TemplateStringsArray) {
  return strings.join(' ').replace(/\s+/g, ' ').trim();
}

describe('pending registration security boundary', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'pending-registration-test-secret';
    mockClientSql.mockReset();
    mockRelease.mockReset();
    mockDbConnect.mockClear();
    mockSql.mockReset();
  });

  it('binds the normalized email, proposed profile, and proposed hash to the challenge', async () => {
    mockClientSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = queryText(strings);

      if (query.includes('SELECT id, email_verified_at FROM users')) {
        return {
          rows: [{ id: 'legacy-user', email_verified_at: null }],
        };
      }

      return { rows: [] };
    });

    const challenge = await createPendingRegistrationChallenge({
      email: '  Explorer@Example.COM ',
      firstName: 'New',
      lastName: 'Explorer',
      passwordHash,
    });

    expect(challenge).toEqual({
      challengeId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      code: expect.stringMatching(/^\d{6}$/),
    });

    const calls = mockClientSql.mock.calls.map(([strings, ...values]) => ({
      query: queryText(strings as TemplateStringsArray),
      values,
    }));
    const invalidateCredential = calls.find(({ query }) =>
      query.includes('SET password ='),
    );
    const pendingInsert = calls.find(({ query }) =>
      query.includes('INSERT INTO pending_registrations'),
    );

    expect(invalidateCredential?.values).toEqual([
      '!pending-registration-required!',
      'legacy-user',
    ]);
    expect(pendingInsert?.values.slice(1, 6)).toEqual([
      'explorer@example.com',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'New',
      'Explorer',
      passwordHash,
    ]);
    expect(calls.some(({ query }) => query.includes('INSERT INTO users'))).toBe(
      false,
    );
    expect(calls.indexOf(invalidateCredential!)).toBeLessThan(
      calls.indexOf(pendingInsert!),
    );
  });

  it('atomically replaces a legacy unverified credential only after the code matches', async () => {
    const code = '123456';
    const registration = {
      challenge_id: challengeId,
      email: 'explorer@example.com',
      email_hash: 'b'.repeat(64),
      first_name: 'Rightful',
      last_name: 'Explorer',
      password_hash: passwordHash,
      code_digest: hashEmailVerificationCode(challengeId, code),
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
    };
    const activated = {
      id: 'legacy-user',
      email: registration.email,
      first_name: registration.first_name,
      email_verified_at: new Date(),
    };

    mockClientSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = queryText(strings);

      if (
        query.startsWith('SELECT challenge_id') &&
        query.includes('FROM pending_registrations')
      ) {
        return { rows: [registration] };
      }
      if (query.includes('FROM pending_registration_attempts')) {
        return { rows: [{ email_count: '0', ip_count: '0' }] };
      }
      if (
        query.startsWith('SELECT id, email, first_name') &&
        query.includes('FROM users')
      ) {
        return {
          rows: [
            {
              id: 'legacy-user',
              email: registration.email,
              first_name: 'Attacker supplied',
              email_verified_at: null,
            },
          ],
        };
      }
      if (
        query.startsWith('UPDATE users') &&
        query.includes('SET first_name =')
      ) {
        return { rows: [activated] };
      }

      return { rows: [] };
    });

    await expect(
      verifyPendingRegistrationCode(challengeId, code, 'c'.repeat(64)),
    ).resolves.toEqual({ status: 'verified', user: activated });

    const activationCall = mockClientSql.mock.calls
      .map(([strings, ...values]) => ({
        query: queryText(strings as TemplateStringsArray),
        values,
      }))
      .find(
        ({ query }) =>
          query.startsWith('UPDATE users') &&
          query.includes('SET first_name ='),
      );

    expect(activationCall?.values).toEqual([
      'Rightful',
      'Explorer',
      'explorer@example.com',
      passwordHash,
      'legacy-user',
    ]);
    expect(activationCall?.query).toContain(
      'session_version = session_version + 1',
    );
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('does not create or update a user when the submitted code is wrong', async () => {
    const registration = {
      challenge_id: challengeId,
      email: 'explorer@example.com',
      email_hash: 'f'.repeat(64),
      first_name: 'Pending',
      last_name: 'Explorer',
      password_hash: passwordHash,
      code_digest: hashEmailVerificationCode(challengeId, '123456'),
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
    };

    mockClientSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = queryText(strings);

      if (
        query.startsWith('SELECT challenge_id') &&
        query.includes('FROM pending_registrations')
      ) {
        return { rows: [registration] };
      }
      if (query.includes('FROM pending_registration_attempts')) {
        return { rows: [{ email_count: '0', ip_count: '0' }] };
      }

      return { rows: [] };
    });

    await expect(
      verifyPendingRegistrationCode(challengeId, '654321', '1'.repeat(64)),
    ).resolves.toEqual({ status: 'invalid' });

    const queries = mockClientSql.mock.calls.map(([strings]) =>
      queryText(strings as TemplateStringsArray),
    );
    expect(queries.some((query) => query.includes('FROM users'))).toBe(false);
    expect(
      queries.some(
        (query) =>
          query.startsWith('UPDATE users') ||
          query.startsWith('INSERT INTO users'),
      ),
    ).toBe(false);
  });

  it('creates a new verified user inside successful challenge consumption', async () => {
    const code = '246810';
    const registration = {
      challenge_id: challengeId,
      email: 'new@example.com',
      email_hash: '2'.repeat(64),
      first_name: 'New',
      last_name: 'Member',
      password_hash: passwordHash,
      code_digest: hashEmailVerificationCode(challengeId, code),
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
    };
    const activated = {
      id: 'new-user',
      email: registration.email,
      first_name: registration.first_name,
      email_verified_at: new Date(),
    };

    mockClientSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = queryText(strings);

      if (
        query.startsWith('SELECT challenge_id') &&
        query.includes('FROM pending_registrations')
      ) {
        return { rows: [registration] };
      }
      if (query.includes('FROM pending_registration_attempts')) {
        return { rows: [{ email_count: '0', ip_count: '0' }] };
      }
      if (
        query.startsWith('SELECT id, email, first_name') &&
        query.includes('FROM users')
      ) {
        return { rows: [] };
      }
      if (query.startsWith('INSERT INTO users')) {
        return { rows: [activated] };
      }

      return { rows: [] };
    });

    await expect(
      verifyPendingRegistrationCode(challengeId, code, '3'.repeat(64)),
    ).resolves.toEqual({ status: 'verified', user: activated });

    const activationCall = mockClientSql.mock.calls
      .map(([strings, ...values]) => ({
        query: queryText(strings as TemplateStringsArray),
        values,
      }))
      .find(({ query }) => query.startsWith('INSERT INTO users'));
    expect(activationCall?.values).toEqual([
      'New',
      'Member',
      'new@example.com',
      passwordHash,
    ]);
    expect(activationCall?.query).toContain('email_verified_at');
  });

  it('never overwrites an account that became verified before activation', async () => {
    const code = '654321';
    const registration = {
      challenge_id: challengeId,
      email: 'member@example.com',
      email_hash: 'd'.repeat(64),
      first_name: 'Untrusted',
      last_name: 'Proposal',
      password_hash: passwordHash,
      code_digest: hashEmailVerificationCode(challengeId, code),
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
    };

    mockClientSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = queryText(strings);

      if (
        query.startsWith('SELECT challenge_id') &&
        query.includes('FROM pending_registrations')
      ) {
        return { rows: [registration] };
      }
      if (query.includes('FROM pending_registration_attempts')) {
        return { rows: [{ email_count: '0', ip_count: '0' }] };
      }
      if (
        query.startsWith('SELECT id, email, first_name') &&
        query.includes('FROM users')
      ) {
        return {
          rows: [
            {
              id: 'verified-user',
              email: registration.email,
              first_name: 'Existing',
              email_verified_at: new Date(),
            },
          ],
        };
      }

      return { rows: [] };
    });

    await expect(
      verifyPendingRegistrationCode(challengeId, code, 'e'.repeat(64)),
    ).resolves.toEqual({ status: 'invalid' });

    const queries = mockClientSql.mock.calls.map(([strings]) =>
      queryText(strings as TemplateStringsArray),
    );
    expect(
      queries.some(
        (query) =>
          query.startsWith('UPDATE users') ||
          query.startsWith('INSERT INTO users'),
      ),
    ).toBe(false);
    expect(
      queries.some(
        (query) =>
          query.startsWith('UPDATE pending_registrations') &&
          query.includes('used_at = NOW()'),
      ),
    ).toBe(true);
  });

  it('does not release the pooled client before verified-account preservation commits', async () => {
    const code = '135790';
    const registration = {
      challenge_id: challengeId,
      email: 'already-verified@example.com',
      email_hash: '9'.repeat(64),
      first_name: 'Untrusted',
      last_name: 'Proposal',
      password_hash: passwordHash,
      code_digest: hashEmailVerificationCode(challengeId, code),
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
    };
    let unblockPreservation!: () => void;
    let markPreservationStarted!: () => void;
    const preservationBlocked = new Promise<void>((resolve) => {
      unblockPreservation = resolve;
    });
    const preservationStarted = new Promise<void>((resolve) => {
      markPreservationStarted = resolve;
    });

    mockClientSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = queryText(strings);

      if (
        query.startsWith('SELECT challenge_id') &&
        query.includes('FROM pending_registrations')
      ) {
        return { rows: [registration] };
      }
      if (query.includes('FROM pending_registration_attempts')) {
        return { rows: [{ email_count: '0', ip_count: '0' }] };
      }
      if (
        query.startsWith('SELECT id, email, first_name') &&
        query.includes('FROM users')
      ) {
        return {
          rows: [
            {
              id: 'verified-user',
              email: registration.email,
              first_name: 'Existing',
              email_verified_at: new Date(),
            },
          ],
        };
      }
      if (
        query.startsWith('UPDATE pending_registrations') &&
        query.includes('used_at = NOW()')
      ) {
        markPreservationStarted();
        await preservationBlocked;
      }

      return { rows: [] };
    });

    const verification = verifyPendingRegistrationCode(
      challengeId,
      code,
      '8'.repeat(64),
    );
    await preservationStarted;

    expect(mockRelease).not.toHaveBeenCalled();

    unblockPreservation();
    await expect(verification).resolves.toEqual({ status: 'invalid' });
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
