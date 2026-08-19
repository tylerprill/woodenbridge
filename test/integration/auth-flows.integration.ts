import { randomUUID } from 'node:crypto';

import { auth } from '@/auth';
import { createAtlasImportBatchAction } from '@/app/lib/actions/atlas-import';
import { setManagedUserAccountStatus } from '@/app/lib/actions/owner-users';
import type { CreateAtlasImportBatchInput } from '@/app/lib/atlas/import-definitions';
import { LOGIN_LIMITS } from '@/app/lib/auth/auth-rate-limit';
import { authorizeCredentials } from '@/app/lib/auth/credentials';
import {
  createPendingRegistrationChallenge,
  verifyPendingRegistrationCode,
} from '@/app/lib/auth/email-verification';
import { hashPassword, verifyPassword } from '@/app/lib/auth/password-hash';
import { getActiveRecoveryGrant } from '@/app/lib/auth/recovery-codes';
import { hashRateLimitKey } from '@/app/lib/auth/security';
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  isPasswordResetTokenValid,
} from '@/app/lib/auth/reset-password';
import {
  MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER,
  createAuthenticatedSession,
  getAuthenticatedSessionState,
  hashSessionId,
  isAuthenticatedSessionRowValid,
  markAuthenticatedSessionMfaVerified,
  revokeAllAuthenticatedSessions,
  revokeAuthenticatedSession,
} from '@/app/lib/auth/session-record';
import { db, sql, type VercelPoolClient } from '@/app/lib/db';

jest.mock('@/auth', () => ({ auth: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/navigation', () => ({
  redirect: jest.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

const authMock = jest.mocked(auth);
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const emailPrefix = `auth-integration-${runId}`;
const dayMilliseconds = 24 * 60 * 60 * 1_000;
let databaseReady = false;

type TestUser = {
  account_status: 'active' | 'suspended' | 'closed';
  email: string;
  email_verified_at: Date | null;
  id: string;
  role: 'user' | 'admin' | 'owner';
  session_version: number;
};

function testEmail(label: string) {
  return `${emailPrefix}-${label}@example.test`;
}

function assertEphemeralIntegrationDatabase() {
  if (process.env.AUTH_INTEGRATION_TESTS !== '1') {
    throw new Error(
      'Refusing to run auth integration tests without AUTH_INTEGRATION_TESTS=1.',
    );
  }

  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('The auth integration database connection is missing.');
  }

  const connection = new URL(connectionString);
  const isLoopback = ['127.0.0.1', 'localhost'].includes(connection.hostname);

  if (!isLoopback || connection.pathname !== '/field_atlas_ci') {
    throw new Error(
      'Auth integration tests are restricted to the local field_atlas_ci database.',
    );
  }
}

async function deleteTestFixtures() {
  await sql`
    DELETE FROM pending_registrations
    WHERE email LIKE ${`${emailPrefix}-%`}
  `;
  await sql`
    DELETE FROM users
    WHERE email LIKE ${`${emailPrefix}-%`}
  `;

  // These tables intentionally hold only one-way identifiers, so there is no
  // email foreign key to target. The database guard above makes clearing them
  // safe: this suite can run only against the disposable CI database.
  await Promise.all([
    sql`DELETE FROM account_creation_requests`,
    sql`DELETE FROM email_verification_requests`,
    sql`DELETE FROM login_attempts`,
    sql`DELETE FROM password_reset_attempts`,
    sql`DELETE FROM password_reset_requests`,
  ]);
}

async function insertUser({
  label,
  passwordHash,
  verified = true,
  role = 'user',
  status = 'active',
}: {
  label: string;
  passwordHash: string;
  verified?: boolean;
  role?: TestUser['role'];
  status?: TestUser['account_status'];
}) {
  const email = testEmail(label);
  const verifiedAt = verified ? new Date().toISOString() : null;
  const result = await sql<TestUser>`
    INSERT INTO users (
      first_name,
      last_name,
      email,
      password,
      email_verified_at,
      role,
      account_status
    )
    VALUES (
      'Integration',
      'Explorer',
      ${email},
      ${passwordHash},
      ${verifiedAt},
      ${role}::user_role,
      ${status}::account_status
    )
    RETURNING
      id,
      email,
      email_verified_at,
      role,
      account_status,
      session_version
  `;

  const user = result.rows[0];
  if (!user) throw new Error('The integration user could not be created.');
  return user;
}

async function createPrivilegedManagementActor(label: string) {
  const actor = await insertUser({
    label,
    passwordHash: await hashPassword('Management actor password 2026!'),
    role: 'admin',
  });
  const actorSession = await createAuthenticatedSession(actor.id, 'admin');
  const sessionReference = hashSessionId(actorSession.sessionId);

  await sql`
    INSERT INTO user_passkeys (
      id,
      user_id,
      credential_id,
      public_key,
      counter,
      device_type,
      backed_up,
      transports,
      label
    )
    VALUES (
      ${randomUUID()},
      ${actor.id},
      ${`management-credential-${randomUUID()}`},
      decode('01', 'hex'),
      0,
      'multiDevice',
      TRUE,
      ARRAY['internal'],
      'CI management passkey'
    )
  `;
  await sql`
    UPDATE auth_sessions
    SET mfa_verified_at = NOW(), mfa_method = 'passkey'
    WHERE session_hash = ${sessionReference}
  `;

  authMock.mockResolvedValue({
    accountStatus: 'active',
    authenticatedAt: actorSession.authenticatedAt,
    emailVerified: true,
    mfaMethod: 'passkey',
    mfaVerifiedAt: Math.floor(Date.now() / 1_000),
    role: 'admin',
    sessionReference,
    sessionValid: true,
    sessionVersion: actor.session_version,
    user: { id: actor.id },
  } as never);

  return { actor, actorSession, sessionReference };
}

async function waitForAdvisoryLockWaiters(
  observer: VercelPoolClient,
  expectedWaiters: number,
) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const result = await observer.query<{ waiter_count: string }>(`
      SELECT COUNT(*)::text AS waiter_count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
    `);

    if (Number(result.rows[0]?.waiter_count ?? 0) >= expectedWaiters) return;

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(
    `Timed out waiting for ${expectedWaiters} password-reset lock waiter(s).`,
  );
}

beforeAll(async () => {
  assertEphemeralIntegrationDatabase();
  process.env.AUTH_HMAC_SECRET =
    'ci-auth-hmac-secret-with-at-least-thirty-two-bytes';

  const identity = await sql<{
    current_database: string;
    current_user: string;
  }>`SELECT current_database(), current_user`;

  expect(identity.rows[0]).toEqual({
    current_database: 'field_atlas_ci',
    current_user: 'field_atlas_runtime',
  });
  databaseReady = true;
  await deleteTestFixtures();
});

afterAll(async () => {
  if (databaseReady) await deleteTestFixtures();
  await db.end();
});

describe('production authentication flows against PostgreSQL', () => {
  it('binds an Atlas import idempotency key to its original canonical payload', async () => {
    const user = await insertUser({
      label: 'atlas-import-idempotency',
      passwordHash: await hashPassword('Atlas import password 2026!'),
    });
    authMock.mockResolvedValue({
      accountStatus: 'active',
      emailVerified: true,
      role: 'user',
      sessionValid: true,
      sessionVersion: user.session_version,
      user: { id: user.id },
    } as never);

    const input = {
      clientRequestId: randomUUID(),
      chapterTitle: 'A lake remembered',
      chapterIntroduction: 'One summer afternoon.',
      coverClientItemId: randomUUID(),
      items: [
        {
          clientItemId: randomUUID(),
          title: 'The original title',
          description: 'Wind moving across the water.',
          placeLabel: 'Sandusky, Michigan',
          placeName: 'Sandusky',
          placeLocality: 'Sandusky',
          placeRegion: 'Michigan',
          placeCountry: 'United States',
          placeCountryCode: 'US',
          placeGeocoder: null,
          placeGeocodedAt: null,
          visitedOn: '2026-08-18',
          latitude: 43.4203,
          longitude: -82.8297,
          locationSource: 'photo_gps',
          dateSource: 'photo_metadata',
          dateConfirmed: true,
          sourceName: 'IMG_1364.HEIC',
          sourceMimeType: 'image/heic',
          sourceByteSize: 3_200_000,
          sourceHash: 'b'.repeat(64),
          sourceWidth: null,
          sourceHeight: null,
          mediaWidth: null,
          mediaHeight: null,
          preparedByteSize: null,
          thumbnailByteSize: null,
        },
        {
          clientItemId: randomUUID(),
          title: 'The chosen cover',
          description: 'Light settling over the shoreline.',
          placeLabel: 'Port Austin, Michigan',
          placeName: 'Port Austin',
          placeLocality: 'Port Austin',
          placeRegion: 'Michigan',
          placeCountry: 'United States',
          placeCountryCode: 'US',
          placeGeocoder: null,
          placeGeocodedAt: null,
          visitedOn: '2026-08-19',
          latitude: 44.0475,
          longitude: -82.9941,
          locationSource: 'photo_gps',
          dateSource: 'photo_metadata',
          dateConfirmed: true,
          sourceName: 'IMG_1365.HEIC',
          sourceMimeType: 'image/heic',
          sourceByteSize: 3_100_000,
          sourceHash: 'c'.repeat(64),
          sourceWidth: null,
          sourceHeight: null,
          mediaWidth: null,
          mediaHeight: null,
          preparedByteSize: null,
          thumbnailByteSize: null,
        },
      ],
    } satisfies CreateAtlasImportBatchInput;
    input.coverClientItemId = input.items[1].clientItemId;

    const [created, concurrentLostResponseRetry] = await Promise.all([
      createAtlasImportBatchAction(input),
      createAtlasImportBatchAction({
        ...input,
        chapterTitle: ` ${input.chapterTitle} `,
      }),
    ]);
    expect(created.ok).toBe(true);
    expect(concurrentLostResponseRetry.ok).toBe(true);
    if (!created.ok || !concurrentLostResponseRetry.ok) {
      throw new Error('The concurrent Atlas import could not be created.');
    }
    expect(concurrentLostResponseRetry.data.id).toBe(created.data.id);
    expect(created.data.coverClientItemId).toBe(input.coverClientItemId);
    expect(concurrentLostResponseRetry.data.coverClientItemId).toBe(
      input.coverClientItemId,
    );

    const editedRetry = await createAtlasImportBatchAction({
      ...input,
      items: input.items.map((item, index) =>
        index === 0 ? { ...item, title: 'An edited stale title' } : item,
      ),
    });
    expect(editedRetry).toMatchObject({ ok: false, error: 'conflict' });

    const persisted = await sql<{
      batch_count: number;
      entry_count: number;
      cover_client_item_id: string;
      title: string;
    }>`
      SELECT
        COUNT(DISTINCT batch.id)::int AS batch_count,
        COUNT(DISTINCT entry.id)::int AS entry_count,
        MAX(batch.cover_client_item_id::text) AS cover_client_item_id,
        MAX(
          CASE
            WHEN item.client_item_id = ${input.items[0].clientItemId}
            THEN entry.title
            ELSE NULL
          END
        ) AS title
      FROM atlas_import_batches AS batch
      INNER JOIN atlas_import_items AS item
        ON item.batch_id = batch.id AND item.user_id = batch.user_id
      INNER JOIN atlas_entries AS entry
        ON entry.id = item.entry_id AND entry.user_id = item.user_id
      WHERE batch.user_id = ${user.id}
        AND batch.client_request_id = ${input.clientRequestId}
    `;
    expect(persisted.rows[0]).toEqual({
      batch_count: 1,
      entry_count: 2,
      cover_client_item_id: input.coverClientItemId,
      title: 'The original title',
    });
  });

  it('prevents an unverified registration from pre-hijacking an address', async () => {
    const email = testEmail('pending');
    const attackerPassword = 'Attacker-selected password 2026!';
    const rightfulPassword = 'Inbox-owner password 2026!';
    const attackerPasswordHash = await hashPassword(attackerPassword);
    const rightfulPasswordHash = await hashPassword(rightfulPassword);
    const attackerChallenge = await createPendingRegistrationChallenge({
      email,
      firstName: 'Attacker',
      lastName: 'Proposal',
      passwordHash: attackerPasswordHash,
    });

    expect(attackerChallenge).toBeDefined();
    await expect(
      sql`SELECT 1 FROM users WHERE LOWER(email) = ${email}`,
    ).resolves.toMatchObject({ rowCount: 0 });

    const rightfulChallenge = await createPendingRegistrationChallenge({
      email: email.toUpperCase(),
      firstName: 'Rightful',
      lastName: 'Explorer',
      passwordHash: rightfulPasswordHash,
    });

    expect(rightfulChallenge).toBeDefined();
    const pendingRows = await sql<{
      challenge_id: string;
      used_at: Date | null;
    }>`
      SELECT challenge_id, used_at
      FROM pending_registrations
      WHERE email = ${email}
      ORDER BY created_at ASC
    `;
    expect(pendingRows.rows).toHaveLength(2);
    expect(
      pendingRows.rows.find(
        (row) => row.challenge_id === attackerChallenge?.challengeId,
      )?.used_at,
    ).toBeInstanceOf(Date);
    expect(
      pendingRows.rows.find(
        (row) => row.challenge_id === rightfulChallenge?.challengeId,
      )?.used_at,
    ).toBeNull();

    await expect(
      verifyPendingRegistrationCode(
        attackerChallenge!.challengeId,
        attackerChallenge!.code,
        '1'.repeat(64),
      ),
    ).resolves.toEqual({ status: 'invalid' });

    const concurrentResults = await Promise.all([
      verifyPendingRegistrationCode(
        rightfulChallenge!.challengeId,
        rightfulChallenge!.code,
        '2'.repeat(64),
      ),
      verifyPendingRegistrationCode(
        rightfulChallenge!.challengeId,
        rightfulChallenge!.code,
        '3'.repeat(64),
      ),
    ]);

    expect(
      concurrentResults.filter((result) => result.status === 'verified'),
    ).toHaveLength(1);
    expect(
      concurrentResults.filter((result) => result.status === 'invalid'),
    ).toHaveLength(1);

    const activated = await sql<{
      first_name: string;
      last_name: string;
      password: string;
      email_verified_at: Date | null;
    }>`
      SELECT first_name, last_name, password, email_verified_at
      FROM users
      WHERE LOWER(email) = ${email}
    `;
    const activatedUser = activated.rows[0];

    expect(activatedUser).toMatchObject({
      first_name: 'Rightful',
      last_name: 'Explorer',
      email_verified_at: expect.any(Date),
    });
    await expect(
      verifyPassword(activatedUser!.password, rightfulPassword),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(activatedUser!.password, attackerPassword),
    ).resolves.toBe(false);

    await expect(
      createPendingRegistrationChallenge({
        email,
        firstName: 'Later attacker',
        lastName: 'Must not replace',
        passwordHash: attackerPasswordHash,
      }),
    ).resolves.toBeUndefined();

    const preserved = await sql<{
      first_name: string;
      password: string;
    }>`SELECT first_name, password FROM users WHERE LOWER(email) = ${email}`;
    expect(preserved.rows[0]).toEqual({
      first_name: 'Rightful',
      password: rightfulPasswordHash,
    });
  });

  it('invalidates a legacy unverified credential before preserving its identity on verification', async () => {
    const attackerPassword = 'Legacy attacker password 2026!';
    const rightfulPassword = 'Legacy inbox owner password 2026!';
    const legacy = await insertUser({
      label: 'legacy-unverified',
      passwordHash: await hashPassword(attackerPassword),
      verified: false,
    });
    const legacySession = await createAuthenticatedSession(legacy.id, 'user');
    const challenge = await createPendingRegistrationChallenge({
      email: legacy.email,
      firstName: 'Recovered',
      lastName: 'Identity',
      passwordHash: await hashPassword(rightfulPassword),
    });

    expect(challenge).toBeDefined();
    const invalidated = await sql<{
      password: string;
      session_version: number;
    }>`SELECT password, session_version FROM users WHERE id = ${legacy.id}`;
    expect(invalidated.rows[0]).toEqual({
      password: '!pending-registration-required!',
      session_version: legacy.session_version + 1,
    });

    const invalidatedSession = await getAuthenticatedSessionState(
      legacy.id,
      legacySession.sessionId,
    );
    expect(invalidatedSession.status).toBe('found');
    if (invalidatedSession.status !== 'found') {
      throw new Error('Legacy session is missing.');
    }
    expect(
      isAuthenticatedSessionRowValid(invalidatedSession.row, {
        authenticatedAt: legacySession.authenticatedAt,
        sessionVersion: legacy.session_version,
      }),
    ).toBe(false);

    const verification = await verifyPendingRegistrationCode(
      challenge!.challengeId,
      challenge!.code,
      '9'.repeat(64),
    );
    expect(verification).toMatchObject({
      status: 'verified',
      user: { id: legacy.id },
    });

    const recovered = await sql<{
      email_verified_at: Date | null;
      first_name: string;
      password: string;
    }>`
      SELECT first_name, password, email_verified_at
      FROM users
      WHERE id = ${legacy.id}
    `;
    expect(recovered.rows[0]).toMatchObject({
      email_verified_at: expect.any(Date),
      first_name: 'Recovered',
    });
    await expect(
      verifyPassword(recovered.rows[0]!.password, rightfulPassword),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(recovered.rows[0]!.password, attackerPassword),
    ).resolves.toBe(false);
  });

  it('issues sessions only after verified active credential authentication and enforces revocation and absolute expiry', async () => {
    const password = 'Verified account password 2026!';
    const passwordHash = await hashPassword(password);
    const verified = await insertUser({
      label: 'login-verified',
      passwordHash,
    });
    const unverified = await insertUser({
      label: 'login-unverified',
      passwordHash,
      verified: false,
    });
    const suspended = await insertUser({
      label: 'login-suspended',
      passwordHash,
      status: 'suspended',
    });

    await expect(
      authorizeCredentials(
        { email: unverified.email, password },
        '4'.repeat(64),
      ),
    ).resolves.toBeNull();
    await expect(
      authorizeCredentials(
        { email: suspended.email, password },
        '5'.repeat(64),
      ),
    ).resolves.toBeNull();
    await expect(
      authorizeCredentials(
        { email: verified.email, password: 'incorrect password' },
        '6'.repeat(64),
      ),
    ).resolves.toBeNull();

    const rejectedSessions = await sql<{ session_count: string }>`
      SELECT COUNT(*)::text AS session_count
      FROM auth_sessions
      WHERE user_id IN (${unverified.id}, ${suspended.id})
    `;
    expect(rejectedSessions.rows[0]?.session_count).toBe('0');

    const login = await authorizeCredentials(
      { email: verified.email.toUpperCase(), password },
      '7'.repeat(64),
    );

    expect(login).toMatchObject({
      accountStatus: 'active',
      email: verified.email,
      emailVerified: true,
      id: verified.id,
      role: 'user',
      sessionId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });

    const sessionReference = hashSessionId(login!.sessionId);
    const storedSession = await sql<{ session_hash: string }>`
      SELECT session_hash
      FROM auth_sessions
      WHERE user_id = ${verified.id}
        AND revoked_at IS NULL
    `;
    expect(storedSession.rows).toEqual([{ session_hash: sessionReference }]);
    expect(storedSession.rows[0]?.session_hash).not.toBe(login!.sessionId);

    const initialState = await getAuthenticatedSessionState(
      verified.id,
      login!.sessionId,
    );
    expect(initialState.status).toBe('found');
    if (initialState.status !== 'found') throw new Error('Session is missing.');
    expect(
      isAuthenticatedSessionRowValid(initialState.row, {
        authenticatedAt: login!.authenticatedAt,
        sessionVersion: login!.sessionVersion,
      }),
    ).toBe(true);

    await expect(
      revokeAuthenticatedSession(verified.id, sessionReference),
    ).resolves.toBe(true);
    const revokedState = await getAuthenticatedSessionState(
      verified.id,
      login!.sessionId,
    );
    expect(revokedState.status).toBe('found');
    if (revokedState.status !== 'found') throw new Error('Session is missing.');
    expect(
      isAuthenticatedSessionRowValid(revokedState.row, {
        authenticatedAt: login!.authenticatedAt,
        sessionVersion: login!.sessionVersion,
      }),
    ).toBe(false);

    const replacementLogin = await authorizeCredentials(
      { email: verified.email, password },
      '8'.repeat(64),
    );
    expect(replacementLogin).not.toBeNull();
    await revokeAllAuthenticatedSessions(verified.id);

    const revokedAllState = await getAuthenticatedSessionState(
      verified.id,
      replacementLogin!.sessionId,
    );
    expect(revokedAllState.status).toBe('found');
    if (revokedAllState.status !== 'found') {
      throw new Error('Replacement session is missing.');
    }
    expect(
      isAuthenticatedSessionRowValid(revokedAllState.row, {
        authenticatedAt: replacementLogin!.authenticatedAt,
        sessionVersion: replacementLogin!.sessionVersion,
      }),
    ).toBe(false);

    const currentUser = await sql<{ session_version: number }>`
      SELECT session_version FROM users WHERE id = ${verified.id}
    `;
    expect(currentUser.rows[0]?.session_version).toBe(
      replacementLogin!.sessionVersion + 1,
    );

    const oldAuthenticationTime = new Date(Date.now() - 8 * dayMilliseconds);
    const expired = await createAuthenticatedSession(
      verified.id,
      'user',
      oldAuthenticationTime,
    );
    const expiredState = await getAuthenticatedSessionState(
      verified.id,
      expired.sessionId,
    );
    expect(expiredState.status).toBe('found');
    if (expiredState.status !== 'found') {
      throw new Error('Expired session is missing.');
    }
    expect(
      isAuthenticatedSessionRowValid(expiredState.row, {
        authenticatedAt: expired.authenticatedAt,
        sessionVersion: currentUser.rows[0]!.session_version,
      }),
    ).toBe(false);
  });

  it('serializes reset issuance and permits exactly one concurrent token consumption', async () => {
    const originalPassword = 'Original reset password 2026!';
    const user = await insertUser({
      label: 'password-reset',
      passwordHash: await hashPassword(originalPassword),
    });
    const firstSession = await createAuthenticatedSession(user.id, 'user');
    const secondSession = await createAuthenticatedSession(user.id, 'user');
    const [firstToken, secondToken] = await Promise.all([
      createPasswordResetToken(user.id),
      createPasswordResetToken(user.id),
    ]);
    if (!firstToken || !secondToken) {
      throw new Error('Eligible reset tokens were not created.');
    }
    const validity = await Promise.all([
      isPasswordResetTokenValid(firstToken.token),
      isPasswordResetTokenValid(secondToken.token),
    ]);

    expect(validity.filter(Boolean)).toHaveLength(1);
    const activeToken = validity[0] ? firstToken.token : secondToken.token;
    const firstReplacement = 'First concurrent replacement 2026!';
    const secondReplacement = 'Second concurrent replacement 2026!';
    const [firstHash, secondHash] = await Promise.all([
      hashPassword(firstReplacement),
      hashPassword(secondReplacement),
    ]);
    const consumed = await Promise.all([
      consumePasswordResetToken(activeToken, firstHash),
      consumePasswordResetToken(activeToken, secondHash),
    ]);

    expect(consumed.filter(Boolean)).toHaveLength(1);
    await expect(
      consumePasswordResetToken(activeToken, firstHash),
    ).resolves.toBeUndefined();

    const resetState = await sql<{
      active_tokens: string;
      password: string;
      session_version: number;
    }>`
      SELECT
        users.password,
        users.session_version,
        (
          SELECT COUNT(*)::text
          FROM password_reset_tokens
          WHERE user_id = users.id AND used_at IS NULL
        ) AS active_tokens
      FROM users
      WHERE users.id = ${user.id}
    `;
    const resetUser = resetState.rows[0]!;
    const matchesFirst = await verifyPassword(
      resetUser.password,
      firstReplacement,
    );
    const matchesSecond = await verifyPassword(
      resetUser.password,
      secondReplacement,
    );

    expect([matchesFirst, matchesSecond].filter(Boolean)).toHaveLength(1);
    expect(resetUser.session_version).toBe(user.session_version + 1);
    expect(resetUser.active_tokens).toBe('0');
    await expect(isPasswordResetTokenValid(activeToken)).resolves.toBe(false);

    const resetSessions = await sql<{
      revoked_sessions: string;
      total_sessions: string;
    }>`
      SELECT
        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::text AS revoked_sessions,
        COUNT(*)::text AS total_sessions
      FROM auth_sessions
      WHERE user_id = ${user.id}
        AND session_hash IN (
          ${hashSessionId(firstSession.sessionId)},
          ${hashSessionId(secondSession.sessionId)}
        )
    `;
    expect(resetSessions.rows[0]).toEqual({
      revoked_sessions: '2',
      total_sessions: '2',
    });
  });

  it('serializes reset redemption and replacement issuance on the same account lock', async () => {
    const user = await insertUser({
      label: 'password-reset-cross-operation-race',
      passwordHash: await hashPassword('Password before reset race 2026!'),
    });
    const existingSession = await createAuthenticatedSession(user.id, 'user');
    const initialToken = await createPasswordResetToken(user.id);
    if (!initialToken) throw new Error('Initial reset token was not created.');
    const replacementPassword = 'Password after reset race 2026!';
    const replacementHash = await hashPassword(replacementPassword);
    const blocker = await db.connect();
    const observer = await db.connect();
    let blockerReleased = false;
    let redemption: ReturnType<typeof consumePasswordResetToken> | undefined;
    let issuance: ReturnType<typeof createPasswordResetToken> | undefined;

    try {
      await blocker.sql`BEGIN`;
      await blocker.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`password-reset-user:${user.id}`}, 0)
        )
      `;

      redemption = consumePasswordResetToken(
        initialToken.token,
        replacementHash,
      );
      await waitForAdvisoryLockWaiters(observer, 1);

      issuance = createPasswordResetToken(user.id);
      await waitForAdvisoryLockWaiters(observer, 2);

      await blocker.sql`COMMIT`;
      blockerReleased = true;

      const [redeemedUser, replacementToken] = await Promise.all([
        redemption,
        issuance,
      ]);
      if (!replacementToken) {
        throw new Error('Replacement reset token was not created.');
      }

      expect(redeemedUser).toMatchObject({ user_id: user.id });
      await expect(isPasswordResetTokenValid(initialToken.token)).resolves.toBe(
        false,
      );
      await expect(
        isPasswordResetTokenValid(replacementToken.token),
      ).resolves.toBe(true);

      const state = await sql<{
        active_token_hash: string | null;
        password: string;
        revoked_at: Date | null;
        session_version: number;
      }>`
        SELECT
          users.password,
          users.session_version,
          auth_sessions.revoked_at,
          (
            SELECT token_hash
            FROM password_reset_tokens
            WHERE user_id = users.id AND used_at IS NULL
            LIMIT 1
          ) AS active_token_hash
        FROM users
        INNER JOIN auth_sessions
          ON auth_sessions.user_id = users.id
         AND auth_sessions.session_hash = ${hashSessionId(existingSession.sessionId)}
        WHERE users.id = ${user.id}
      `;

      expect(state.rows[0]).toMatchObject({
        active_token_hash: replacementToken.tokenHash,
        revoked_at: expect.any(Date),
        session_version: user.session_version + 1,
      });
      await expect(
        verifyPassword(state.rows[0]!.password, replacementPassword),
      ).resolves.toBe(true);
    } finally {
      if (!blockerReleased) {
        await blocker.sql`ROLLBACK`.catch(() => undefined);
      }
      blocker.release();
      observer.release();
      const pendingOperations: Promise<unknown>[] = [];
      if (redemption) pendingOperations.push(redemption);
      if (issuance) pendingOperations.push(issuance);
      await Promise.allSettled(pendingOperations);
    }
  });

  it('consumes a reset token when issuance wins the race, and it stays dead after reactivation', async () => {
    await createPrivilegedManagementActor('suspension-issuance-first-actor');
    const target = await insertUser({
      label: 'suspension-issuance-first-target',
      passwordHash: await hashPassword(
        'Target password before suspension 2026!',
      ),
    });
    const blocker = await db.connect();
    const observer = await db.connect();
    const suspensionInput = new FormData();
    suspensionInput.set('targetUserId', target.id);
    suspensionInput.set('status', 'suspended');
    let blockerReleased = false;
    let issuance: ReturnType<typeof createPasswordResetToken> | undefined;
    let suspension: Promise<unknown> | undefined;

    try {
      await blocker.sql`BEGIN`;
      await blocker.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`password-reset-user:${target.id}`}, 0)
        )
      `;

      issuance = createPasswordResetToken(target.id);
      await waitForAdvisoryLockWaiters(observer, 1);

      suspension = setManagedUserAccountStatus(suspensionInput).catch(
        (error) => error,
      );
      await waitForAdvisoryLockWaiters(observer, 2);

      await blocker.sql`COMMIT`;
      blockerReleased = true;

      const [issuedToken, suspensionResult] = await Promise.all([
        issuance,
        suspension,
      ]);
      if (!issuedToken) {
        throw new Error('Issuance was expected to win the reset lock.');
      }
      expect(suspensionResult).toEqual(
        expect.objectContaining({
          message:
            'NEXT_REDIRECT:/dashboard/owner/users?notice=account-suspended',
        }),
      );
      await expect(isPasswordResetTokenValid(issuedToken.token)).resolves.toBe(
        false,
      );

      const suspendedState = await sql<{
        account_status: TestUser['account_status'];
        active_tokens: string;
        consumed_tokens: string;
      }>`
        SELECT
          users.account_status,
          COUNT(*) FILTER (
            WHERE password_reset_tokens.used_at IS NULL
          )::text AS active_tokens,
          COUNT(*) FILTER (
            WHERE password_reset_tokens.used_at IS NOT NULL
          )::text AS consumed_tokens
        FROM users
        LEFT JOIN password_reset_tokens
          ON password_reset_tokens.user_id = users.id
        WHERE users.id = ${target.id}
        GROUP BY users.id
      `;
      expect(suspendedState.rows[0]).toEqual({
        account_status: 'suspended',
        active_tokens: '0',
        consumed_tokens: '1',
      });

      const reactivationInput = new FormData();
      reactivationInput.set('targetUserId', target.id);
      reactivationInput.set('status', 'active');
      await expect(
        setManagedUserAccountStatus(reactivationInput),
      ).rejects.toThrow(
        'NEXT_REDIRECT:/dashboard/owner/users?notice=account-reactivated',
      );
      await expect(isPasswordResetTokenValid(issuedToken.token)).resolves.toBe(
        false,
      );
    } finally {
      if (!blockerReleased) {
        await blocker.sql`ROLLBACK`.catch(() => undefined);
      }
      blocker.release();
      observer.release();
      const pendingOperations: Promise<unknown>[] = [];
      if (issuance) pendingOperations.push(issuance);
      if (suspension) pendingOperations.push(suspension);
      await Promise.allSettled(pendingOperations);
    }
  });

  it('refuses reset issuance when suspension wins the account lock', async () => {
    await createPrivilegedManagementActor('suspension-first-actor');
    const target = await insertUser({
      label: 'suspension-first-target',
      passwordHash: await hashPassword(
        'Target password before reset race 2026!',
      ),
    });
    const blocker = await db.connect();
    const observer = await db.connect();
    const suspensionInput = new FormData();
    suspensionInput.set('targetUserId', target.id);
    suspensionInput.set('status', 'suspended');
    let blockerReleased = false;
    let suspension: Promise<unknown> | undefined;
    let issuance: ReturnType<typeof createPasswordResetToken> | undefined;

    try {
      await blocker.sql`BEGIN`;
      await blocker.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`password-reset-user:${target.id}`}, 0)
        )
      `;

      suspension = setManagedUserAccountStatus(suspensionInput).catch(
        (error) => error,
      );
      await waitForAdvisoryLockWaiters(observer, 1);

      issuance = createPasswordResetToken(target.id);
      await waitForAdvisoryLockWaiters(observer, 2);

      await blocker.sql`COMMIT`;
      blockerReleased = true;

      const [suspensionResult, issuedToken] = await Promise.all([
        suspension,
        issuance,
      ]);
      expect(suspensionResult).toEqual(
        expect.objectContaining({
          message:
            'NEXT_REDIRECT:/dashboard/owner/users?notice=account-suspended',
        }),
      );
      expect(issuedToken).toBeUndefined();

      const finalState = await sql<{
        account_status: TestUser['account_status'];
        active_tokens: string;
      }>`
        SELECT
          users.account_status,
          COUNT(password_reset_tokens.token_hash) FILTER (
            WHERE password_reset_tokens.used_at IS NULL
          )::text AS active_tokens
        FROM users
        LEFT JOIN password_reset_tokens
          ON password_reset_tokens.user_id = users.id
        WHERE users.id = ${target.id}
        GROUP BY users.id
      `;
      expect(finalState.rows[0]).toEqual({
        account_status: 'suspended',
        active_tokens: '0',
      });
    } finally {
      if (!blockerReleased) {
        await blocker.sql`ROLLBACK`.catch(() => undefined);
      }
      blocker.release();
      observer.release();
      const pendingOperations: Promise<unknown>[] = [];
      if (suspension) pendingOperations.push(suspension);
      if (issuance) pendingOperations.push(issuance);
      await Promise.allSettled(pendingOperations);
    }
  });

  it('rejects a management mutation when the actor becomes stale after the request check', async () => {
    const { actor, sessionReference } = await createPrivilegedManagementActor(
      'stale-management-actor',
    );
    const target = await insertUser({
      label: 'stale-management-target',
      passwordHash: await hashPassword('Unchanged target password 2026!'),
    });
    const blocker = await db.connect();
    const observer = await db.connect();
    const suspensionInput = new FormData();
    suspensionInput.set('targetUserId', target.id);
    suspensionInput.set('status', 'suspended');
    let blockerReleased = false;
    let managementAttempt: Promise<unknown> | undefined;

    try {
      await blocker.sql`BEGIN`;
      await blocker.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${'field-atlas:management-user-mutation'}, 0)
        )
      `;

      managementAttempt = setManagedUserAccountStatus(suspensionInput).catch(
        (error) => error,
      );
      await waitForAdvisoryLockWaiters(observer, 1);

      await sql`
        UPDATE users
        SET role = 'user', session_version = session_version + 1
        WHERE id = ${actor.id}
      `;
      await sql`
        UPDATE auth_sessions
        SET revoked_at = NOW()
        WHERE session_hash = ${sessionReference}
      `;

      await blocker.sql`COMMIT`;
      blockerReleased = true;

      const result = await managementAttempt;
      expect(result).toEqual(
        expect.objectContaining({
          message: 'NEXT_REDIRECT:/dashboard/owner/users?error=failed',
        }),
      );
      const targetState = await sql<{
        account_status: TestUser['account_status'];
        session_version: number;
      }>`
        SELECT account_status, session_version
        FROM users
        WHERE id = ${target.id}
      `;
      expect(targetState.rows[0]).toEqual({
        account_status: 'active',
        session_version: target.session_version,
      });
    } finally {
      if (!blockerReleased) {
        await blocker.sql`ROLLBACK`.catch(() => undefined);
      }
      blocker.release();
      observer.release();
      if (managementAttempt) await Promise.allSettled([managementAttempt]);
    }
  });

  it('applies the same bounded total-login ceiling to valid and unknown accounts', async () => {
    const password = 'Availability integration password 2026!';
    const user = await insertUser({
      label: 'login-availability',
      passwordHash: await hashPassword(password),
    });
    const ipHash = 'a'.repeat(64);
    const knownEmailHash = hashRateLimitKey(`email:${user.email}`);
    const unknownEmail = testEmail('login-availability-unknown');
    const unknownEmailHash = hashRateLimitKey(`email:${unknownEmail}`);

    await sql`
      INSERT INTO login_attempts (
        email_hash,
        ip_hash,
        successful,
        attempted_at,
        completed_at
      )
      SELECT
        ${knownEmailHash},
        ${ipHash},
        TRUE,
        NOW(),
        NOW()
      FROM generate_series(1, ${LOGIN_LIMITS.emailAttempts})
    `;
    await sql`
      INSERT INTO login_attempts (
        email_hash,
        ip_hash,
        successful,
        attempted_at,
        completed_at
      )
      SELECT
        ${unknownEmailHash},
        ${'b'.repeat(64)},
        TRUE,
        NOW(),
        NOW()
      FROM generate_series(1, ${LOGIN_LIMITS.emailAttempts})
    `;

    await expect(
      authorizeCredentials({ email: user.email, password }, ipHash),
    ).resolves.toBeNull();
    await expect(
      authorizeCredentials({ email: unknownEmail, password }, 'b'.repeat(64)),
    ).resolves.toBeNull();

    const state = await sql<{
      attempt_count: string;
      session_count: string;
    }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM login_attempts
          WHERE email_hash = ${knownEmailHash}
        ) AS attempt_count,
        (
          SELECT COUNT(*)::text
          FROM auth_sessions
          WHERE user_id = ${user.id}
        ) AS session_count
    `;
    expect(state.rows[0]).toEqual({
      attempt_count: String(LOGIN_LIMITS.emailAttempts),
      session_count: '0',
    });
  });

  it('uses wall-clock completion timestamps after a reversed advisory-lock wait', async () => {
    const emailHash = hashRateLimitKey(`clock-regression:${runId}`);
    const ipHash = 'e'.repeat(64);
    const older = await db.connect();
    const newer = await db.connect();
    const observer = await db.connect();
    let olderFinished = false;
    let newerFinished = false;
    let waitingLock: Promise<unknown> | undefined;

    try {
      await older.sql`BEGIN`;
      const olderClock = await older.sql<{ transaction_now: Date }>`
        SELECT NOW() AS transaction_now
      `;

      await newer.sql`BEGIN`;
      await newer.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`login-email:${emailHash}`}, 0)
        )
      `;
      await newer.sql`SELECT pg_sleep(0.02)`;
      const pending = await newer.sql<{ id: string; attempted_at: Date }>`
        INSERT INTO login_attempts (email_hash, ip_hash)
        VALUES (${emailHash}, ${ipHash})
        RETURNING id::text, attempted_at
      `;
      const failed = await newer.sql<{
        attempted_at: Date;
        completed_at: Date;
        id: string;
      }>`
        INSERT INTO login_attempts (
          email_hash,
          ip_hash,
          successful,
          attempted_at,
          completed_at
        )
        VALUES (
          ${emailHash},
          ${ipHash},
          FALSE,
          NOW(),
          clock_timestamp()
        )
        RETURNING id::text, attempted_at, completed_at
      `;

      waitingLock = older.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`login-email:${emailHash}`}, 0)
        )
      `;
      await waitForAdvisoryLockWaiters(observer, 1);
      await newer.sql`COMMIT`;
      newerFinished = true;
      await waitingLock;

      await older.sql`
        UPDATE login_attempts
        SET completed_at = clock_timestamp()
        WHERE id = ${pending.rows[0]!.id}
      `;
      await older.sql`
        UPDATE login_attempts
        SET failure_cleared_at = clock_timestamp()
        WHERE id = ${failed.rows[0]!.id}
      `;
      const transitions = await older.sql<{
        attempted_at: Date;
        completed_at: Date;
        failure_cleared_at: Date | null;
        id: string;
      }>`
        SELECT id::text, attempted_at, completed_at, failure_cleared_at
        FROM login_attempts
        WHERE id IN (${pending.rows[0]!.id}, ${failed.rows[0]!.id})
        ORDER BY id
      `;

      expect(olderClock.rows[0]!.transaction_now.getTime()).toBeLessThan(
        pending.rows[0]!.attempted_at.getTime(),
      );
      expect(
        transitions.rows.every(
          (attempt) =>
            attempt.completed_at >= attempt.attempted_at &&
            (!attempt.failure_cleared_at ||
              attempt.failure_cleared_at >= attempt.completed_at),
        ),
      ).toBe(true);
      await older.sql`COMMIT`;
      olderFinished = true;
    } finally {
      if (!olderFinished) await older.sql`ROLLBACK`.catch(() => undefined);
      if (!newerFinished) await newer.sql`ROLLBACK`.catch(() => undefined);
      older.release();
      newer.release();
      observer.release();
      if (waitingLock) await Promise.allSettled([waitingLock]);
    }
  });

  it('serializes concurrent logins and keeps a bounded active session set', async () => {
    const user = await insertUser({
      label: 'session-cap',
      passwordHash: await hashPassword('Session cap password 2026!'),
    });
    const sessionCount = MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER + 5;

    await Promise.all(
      Array.from({ length: sessionCount }, () =>
        createAuthenticatedSession(user.id, 'user'),
      ),
    );

    const state = await sql<{
      active_count: string;
      revoked_count: string;
      total_count: string;
    }>`
      SELECT
        COUNT(*) FILTER (
          WHERE revoked_at IS NULL AND absolute_expires_at > NOW()
        )::text AS active_count,
        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::text AS revoked_count,
        COUNT(*)::text AS total_count
      FROM auth_sessions
      WHERE user_id = ${user.id}
    `;

    expect(state.rows[0]).toEqual({
      active_count: String(MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER),
      revoked_count: String(
        sessionCount - MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER,
      ),
      total_count: String(sessionCount),
    });
  });

  it('keeps a stepped privileged session through repeated password-only session creation', async () => {
    const admin = await insertUser({
      label: 'protected-session-survival',
      passwordHash: await hashPassword('Protected session password 2026!'),
      role: 'admin',
    });
    const protectedSession = await createAuthenticatedSession(
      admin.id,
      'admin',
    );
    const protectedReference = hashSessionId(protectedSession.sessionId);

    await expect(
      markAuthenticatedSessionMfaVerified(admin.id, protectedReference),
    ).resolves.toBe(true);
    await Promise.all(
      Array.from({ length: 15 }, () =>
        createAuthenticatedSession(admin.id, 'admin'),
      ),
    );

    const state = await sql<{
      active_count: string;
      protected_mfa_verified_at: Date | null;
      protected_revoked_at: Date | null;
      revoked_count: string;
      total_count: string;
    }>`
      SELECT
        COUNT(*) FILTER (
          WHERE revoked_at IS NULL AND absolute_expires_at > NOW()
        )::text AS active_count,
        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::text AS revoked_count,
        COUNT(*)::text AS total_count,
        MAX(mfa_verified_at) FILTER (
          WHERE session_hash = ${protectedReference}
        ) AS protected_mfa_verified_at,
        MAX(revoked_at) FILTER (
          WHERE session_hash = ${protectedReference}
        ) AS protected_revoked_at
      FROM auth_sessions
      WHERE user_id = ${admin.id}
    `;

    expect(state.rows[0]).toEqual({
      active_count: String(MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER),
      protected_mfa_verified_at: expect.any(Date),
      protected_revoked_at: null,
      revoked_count: '6',
      total_count: '16',
    });
  });

  it('rejects an eleventh password login without mutating ten stepped sessions', async () => {
    const password = 'Full protected session set password 2026!';
    const admin = await insertUser({
      label: 'protected-session-capacity',
      passwordHash: await hashPassword(password),
      role: 'admin',
    });
    const protectedSessions = await Promise.all(
      Array.from({ length: MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER }, () =>
        createAuthenticatedSession(admin.id, 'admin'),
      ),
    );

    await Promise.all(
      protectedSessions.map((session) =>
        markAuthenticatedSessionMfaVerified(
          admin.id,
          hashSessionId(session.sessionId),
        ),
      ),
    );

    const readSessionState = () => sql<{
      mfa_verified_at: Date | null;
      revoked_at: Date | null;
      session_hash: string;
    }>`
      SELECT session_hash, mfa_verified_at, revoked_at
      FROM auth_sessions
      WHERE user_id = ${admin.id}
      ORDER BY session_hash
    `;
    const before = await readSessionState();

    await expect(
      authorizeCredentials({ email: admin.email, password }, 'd'.repeat(64)),
    ).resolves.toBeNull();

    const after = await readSessionState();
    expect(before.rows).toHaveLength(
      MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER,
    );
    expect(before.rows.every((session) => session.mfa_verified_at)).toBe(true);
    expect(after.rows).toEqual(before.rows);
  });

  it('never lets an active recovery grant bypass passkey-only management step-up', async () => {
    const passwordHash = await hashPassword(
      'Privileged integration password 2026!',
    );
    const admin = await insertUser({
      label: 'step-up-admin',
      passwordHash,
      role: 'admin',
    });
    const target = await insertUser({
      label: 'step-up-target',
      passwordHash,
    });
    const adminSession = await createAuthenticatedSession(admin.id, 'admin');
    const sessionReference = hashSessionId(adminSession.sessionId);
    const passkeyId = randomUUID();
    const recoverySetId = randomUUID();
    const recoveryCodeId = randomUUID();
    const recoveryGrantId = randomUUID();

    await sql`
      INSERT INTO user_passkeys (
        id,
        user_id,
        credential_id,
        public_key,
        counter,
        device_type,
        backed_up,
        transports,
        label
      )
      VALUES (
        ${passkeyId},
        ${admin.id},
        ${`integration-credential-${runId}`},
        decode('01', 'hex'),
        0,
        'multiDevice',
        TRUE,
        ARRAY['internal'],
        'CI virtual passkey'
      )
    `;
    await sql`
      INSERT INTO privileged_recovery_code_sets (id, user_id)
      VALUES (${recoverySetId}, ${admin.id})
    `;
    await sql`
      INSERT INTO privileged_recovery_codes (
        id,
        set_id,
        code_hash,
        position,
        used_at
      )
      VALUES (
        ${recoveryCodeId},
        ${recoverySetId},
        ${'a'.repeat(64)},
        1,
        NOW()
      )
    `;
    await sql`
      INSERT INTO privileged_passkey_recovery_grants (
        id,
        user_id,
        session_hash,
        recovery_code_id,
        expires_at
      )
      VALUES (
        ${recoveryGrantId},
        ${admin.id},
        ${sessionReference},
        ${recoveryCodeId},
        ${new Date(Date.now() + 10 * 60 * 1_000).toISOString()}
      )
    `;

    await expect(
      sql`
        UPDATE auth_sessions
        SET mfa_verified_at = NOW(), mfa_method = 'recovery_code'
        WHERE session_hash = ${sessionReference}
      `,
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      getActiveRecoveryGrant({
        userId: admin.id,
        sessionReference,
      }),
    ).resolves.toMatchObject({ grantId: recoveryGrantId });

    const sessionState = await getAuthenticatedSessionState(
      admin.id,
      adminSession.sessionId,
    );
    expect(sessionState.status).toBe('found');
    if (sessionState.status !== 'found') {
      throw new Error('Privileged session is missing.');
    }
    expect(sessionState.row.mfa_method).toBeNull();
    expect(sessionState.row.mfa_verified_at).toBeNull();

    authMock.mockResolvedValue({
      accountStatus: sessionState.row.account_status,
      authenticatedAt: adminSession.authenticatedAt,
      emailVerified: true,
      mfaMethod: null,
      mfaVerifiedAt: null,
      role: sessionState.row.role,
      sessionReference,
      sessionValid: true,
      user: { id: admin.id },
    } as never);

    const actionInput = new FormData();
    actionInput.set('targetUserId', target.id);
    actionInput.set('status', 'suspended');

    await expect(setManagedUserAccountStatus(actionInput)).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard/security?required=passkey&returnTo=%2Fdashboard%2Fowner%2Fusers',
    );

    const targetAfterAttempt = await sql<{
      account_status: TestUser['account_status'];
      session_version: number;
    }>`
      SELECT account_status, session_version
      FROM users
      WHERE id = ${target.id}
    `;
    expect(targetAfterAttempt.rows[0]).toEqual({
      account_status: 'active',
      session_version: target.session_version,
    });
  });
});
