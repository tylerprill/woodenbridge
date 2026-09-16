const { createHmac } = require('node:crypto');
const { lstat, mkdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const E2E_LIFECYCLE_FIXTURE = Object.freeze({
  databaseName: 'field_atlas_e2e_lifecycle',
  email: 'field-atlas-lifecycle-e2e@example.test',
  userId: '8e91db0f-3c0e-4a46-9f3c-8ddab1f2c205',
});

const ARGON2_OPTIONS = Object.freeze({
  algorithm: 2,
  version: 1,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MIN_PASSWORD_CHARACTERS = 15;
const MAX_PASSWORD_CHARACTERS = 128;
const MAX_PASSWORD_BYTES = MAX_PASSWORD_CHARACTERS * 4;
const MINIMUM_HMAC_SECRET_BYTES = 32;
const E2E_LIFECYCLE_MEDIA_STORAGE_ROOT_PATTERN =
  /^field-atlas-e2e-media-lifecycle(?:-[A-Za-z0-9._-]+)?$/;

const EMPTY_ACCOUNT_COUNT_FIELDS = Object.freeze([
  'chapter_count',
  'chapter_entry_count',
  'entry_count',
  'import_batch_count',
  'import_item_count',
  'journey_feedback_count',
  'media_count',
  'session_count',
  'upload_intent_count',
]);

function assertE2ELifecycleMediaStorageConfiguration(configuration) {
  if (
    !configuration ||
    typeof configuration.boundary !== 'string' ||
    typeof configuration.storageRoot !== 'string' ||
    !path.isAbsolute(configuration.boundary) ||
    !path.isAbsolute(configuration.storageRoot)
  ) {
    throw new Error(
      'The lifecycle E2E media boundary and storage root must be absolute paths.',
    );
  }

  const boundary = path.resolve(configuration.boundary);
  const storageRoot = path.resolve(configuration.storageRoot);
  if (
    path.dirname(storageRoot) !== boundary ||
    !E2E_LIFECYCLE_MEDIA_STORAGE_ROOT_PATTERN.test(path.basename(storageRoot))
  ) {
    throw new Error(
      'E2E_MEDIA_STORAGE_ROOT must be a dedicated field-atlas-e2e-media-lifecycle directory directly inside the test temp directory.',
    );
  }

  return { boundary, storageRoot };
}

function getE2ELifecycleMediaStorageConfiguration(environment) {
  if (environment.E2E_MEDIA_STORAGE_ADAPTER !== 'filesystem') {
    throw new Error(
      'E2E_MEDIA_STORAGE_ADAPTER must be filesystem before lifecycle test media can be reset.',
    );
  }
  if (environment.VERCEL === '1' || environment.VERCEL_ENV) {
    throw new Error(
      'The lifecycle E2E filesystem media adapter cannot run in a Vercel environment.',
    );
  }

  const configuredBoundary = environment.RUNNER_TEMP || os.tmpdir();
  if (!path.isAbsolute(configuredBoundary)) {
    throw new Error('RUNNER_TEMP must be an absolute path when it is set.');
  }

  const configuredRoot = environment.E2E_MEDIA_STORAGE_ROOT;
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error('E2E_MEDIA_STORAGE_ROOT must be an absolute path.');
  }

  return assertE2ELifecycleMediaStorageConfiguration({
    boundary: path.resolve(configuredBoundary),
    storageRoot: path.resolve(configuredRoot),
  });
}

async function assertE2ELifecycleMediaStorageSafe(configuration) {
  const validated = assertE2ELifecycleMediaStorageConfiguration(configuration);
  const boundary = await lstat(validated.boundary);
  if (boundary.isSymbolicLink() || !boundary.isDirectory()) {
    throw new Error(
      'The lifecycle E2E media temp boundary must be a real directory.',
    );
  }

  try {
    const storageRoot = await lstat(validated.storageRoot);
    if (storageRoot.isSymbolicLink()) {
      throw new Error(
        'The lifecycle E2E media storage root must not be a symbolic link.',
      );
    }
    if (!storageRoot.isDirectory()) {
      throw new Error(
        'The lifecycle E2E media storage root must be a directory.',
      );
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return validated;
}

async function resetE2ELifecycleMediaStorage(configuration) {
  const validated = await assertE2ELifecycleMediaStorageSafe(configuration);
  await rm(validated.storageRoot, { recursive: true, force: true });
  await mkdir(validated.storageRoot, { recursive: true, mode: 0o700 });
}

function getE2ELifecycleSeedConfiguration(environment) {
  if (environment.E2E_LIFECYCLE_DATABASE_SEED !== '1') {
    throw new Error(
      'Refusing to seed without the explicit E2E_LIFECYCLE_DATABASE_SEED=1 opt-in.',
    );
  }

  const connectionString = environment.E2E_LIFECYCLE_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'E2E_LIFECYCLE_DATABASE_URL is required for the lifecycle E2E database seed.',
    );
  }

  let connection;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error(
      'E2E_LIFECYCLE_DATABASE_URL must be a valid PostgreSQL URL.',
    );
  }

  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    throw new Error(
      'E2E_LIFECYCLE_DATABASE_URL must use the PostgreSQL protocol.',
    );
  }
  if (!LOOPBACK_HOSTS.has(connection.hostname.toLowerCase())) {
    throw new Error('E2E_LIFECYCLE_DATABASE_URL must target a loopback host.');
  }
  if (connection.search || connection.hash) {
    throw new Error(
      'E2E_LIFECYCLE_DATABASE_URL must not contain query parameters or a fragment.',
    );
  }
  if (connection.pathname !== `/${E2E_LIFECYCLE_FIXTURE.databaseName}`) {
    throw new Error(
      `E2E_LIFECYCLE_DATABASE_URL must target the ${E2E_LIFECYCLE_FIXTURE.databaseName} database.`,
    );
  }

  const email = environment.E2E_LIFECYCLE_TEST_EMAIL;
  if (email !== E2E_LIFECYCLE_FIXTURE.email) {
    throw new Error(
      `E2E_LIFECYCLE_TEST_EMAIL must be exactly ${E2E_LIFECYCLE_FIXTURE.email}.`,
    );
  }

  const password = environment.E2E_LIFECYCLE_TEST_PASSWORD;
  if (!password) {
    throw new Error(
      'E2E_LIFECYCLE_TEST_PASSWORD is required for the lifecycle E2E database seed.',
    );
  }
  const normalizedPassword = password.normalize('NFC');
  const passwordCharacters = Array.from(normalizedPassword).length;
  if (
    passwordCharacters < MIN_PASSWORD_CHARACTERS ||
    passwordCharacters > MAX_PASSWORD_CHARACTERS ||
    Buffer.byteLength(normalizedPassword, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    throw new Error(
      `E2E_LIFECYCLE_TEST_PASSWORD must contain between ${MIN_PASSWORD_CHARACTERS} and ${MAX_PASSWORD_CHARACTERS} characters.`,
    );
  }

  const hmacSecret = environment.AUTH_HMAC_SECRET;
  if (
    !hmacSecret ||
    Buffer.byteLength(hmacSecret, 'utf8') < MINIMUM_HMAC_SECRET_BYTES
  ) {
    throw new Error(
      'AUTH_HMAC_SECRET must contain at least 32 bytes so lifecycle login state can be reset precisely.',
    );
  }

  const emailRateLimitHash = createHmac('sha256', hmacSecret)
    .update(`rate-limit:v1:email:${email}`)
    .digest('hex');

  return {
    connectionString,
    databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
    email,
    emailRateLimitHash,
    password: normalizedPassword,
  };
}

function assertE2ELifecycleSeedDatabaseState(configuration, databaseState) {
  if (databaseState.databaseName !== configuration.databaseName) {
    throw new Error(
      'The connected database is not the dedicated lifecycle E2E database.',
    );
  }
  if (!Array.isArray(databaseState.users) || databaseState.users.length > 1) {
    throw new Error(
      'The dedicated lifecycle E2E database contains users outside the deterministic fixture.',
    );
  }

  const existingUser = databaseState.users[0];
  if (!existingUser) return;
  if (
    existingUser.id !== E2E_LIFECYCLE_FIXTURE.userId ||
    existingUser.email !== E2E_LIFECYCLE_FIXTURE.email
  ) {
    throw new Error(
      'The deterministic lifecycle E2E user id or email belongs to a different account.',
    );
  }
  if (existingUser.role !== 'user') {
    throw new Error(
      'The deterministic lifecycle E2E account is not an ordinary user and cannot be safely reset.',
    );
  }
  if (existingUser.accountStatus !== 'active') {
    throw new Error(
      'The deterministic lifecycle E2E account is not active and cannot be safely reset.',
    );
  }
}

function assertE2ELifecycleEmptyAccountState(databaseState) {
  if (databaseState.account_count !== 1) {
    throw new Error(
      'The lifecycle E2E account was not recreated as one verified, active ordinary user.',
    );
  }
  if (databaseState.preference_count !== 1) {
    throw new Error(
      'The lifecycle E2E account must have exactly one Atlas preference row.',
    );
  }

  for (const field of EMPTY_ACCOUNT_COUNT_FIELDS) {
    if (databaseState[field] !== 0) {
      throw new Error(
        `The lifecycle E2E account is not empty: ${field} is ${databaseState[field]}.`,
      );
    }
  }
}

async function seedE2ELifecycleDatabase(environment = process.env) {
  const configuration = getE2ELifecycleSeedConfiguration(environment);
  const mediaStorageConfiguration =
    getE2ELifecycleMediaStorageConfiguration(environment);

  // Validate the boundary before touching the database. The destructive reset
  // validates it again immediately before removing anything.
  await assertE2ELifecycleMediaStorageSafe(mediaStorageConfiguration);

  const [{ hash }, { Client }] = await Promise.all([
    import('@node-rs/argon2'),
    import('pg'),
  ]);
  const passwordHash = await hash(configuration.password, ARGON2_OPTIONS);
  const client = new Client({
    connectionString: configuration.connectionString,
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('field-atlas-e2e-lifecycle-seed', 0))",
    );

    const identityResult = await client.query(
      'SELECT current_database() AS database_name',
    );
    const usersResult = await client.query(
      `
        SELECT
          id::text,
          email,
          role::text,
          account_status::text AS "accountStatus"
        FROM users
        ORDER BY id
        FOR UPDATE
      `,
    );
    assertE2ELifecycleSeedDatabaseState(configuration, {
      databaseName: identityResult.rows[0]?.database_name,
      users: usersResult.rows,
    });

    const fixtureUserId = E2E_LIFECYCLE_FIXTURE.userId;
    await client.query(
      'DELETE FROM atlas_media_upload_intents WHERE user_id = $1',
      [fixtureUserId],
    );
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [
      fixtureUserId,
    ]);
    await client.query(
      `
        DELETE FROM password_reset_attempts
        WHERE token_hash IN (
          SELECT token_hash
          FROM password_reset_tokens
          WHERE user_id = $1
        )
      `,
      [fixtureUserId],
    );
    await client.query(
      `
        DELETE FROM security_notification_outbox
        WHERE user_id = $1
          OR (user_id IS NULL AND LOWER(recipient_email) = $2)
      `,
      [fixtureUserId, configuration.email],
    );
    await client.query(
      `
        DELETE FROM auth_security_events
        WHERE actor_user_id = $1 OR target_user_id = $1
      `,
      [fixtureUserId],
    );
    await client.query('DELETE FROM users WHERE id = $1', [fixtureUserId]);

    await client.query(
      'DELETE FROM pending_registration_attempts WHERE email_hash = $1',
      [configuration.emailRateLimitHash],
    );
    await client.query(
      `
        DELETE FROM pending_registrations
        WHERE email_hash = $1 OR email = $2
      `,
      [configuration.emailRateLimitHash, configuration.email],
    );
    for (const table of [
      'account_creation_requests',
      'email_verification_requests',
      'login_attempts',
      'password_reset_requests',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE email_hash = $1`, [
        configuration.emailRateLimitHash,
      ]);
    }

    await client.query(
      `
        INSERT INTO users (
          id,
          first_name,
          last_name,
          email,
          password,
          email_verified_at,
          role,
          account_status
        )
        VALUES ($1, 'Lifecycle', 'Explorer', $2, $3, NOW(), 'user', 'active')
      `,
      [fixtureUserId, configuration.email, passwordHash],
    );
    await client.query(
      `
        INSERT INTO atlas_preferences (
          user_id,
          latitude,
          longitude,
          zoom,
          bearing,
          pitch
        )
        VALUES ($1, 42.3336, -83.0236, 11, 0, 0)
      `,
      [fixtureUserId],
    );

    const emptyState = await client.query(
      `
        SELECT
          (
            SELECT COUNT(*)::integer
            FROM users
            WHERE id = $1
              AND email = $2
              AND email_verified_at IS NOT NULL
              AND role = 'user'
              AND account_status = 'active'
          ) AS account_count,
          (SELECT COUNT(*)::integer FROM atlas_preferences WHERE user_id = $1) AS preference_count,
          (SELECT COUNT(*)::integer FROM atlas_entries WHERE user_id = $1) AS entry_count,
          (SELECT COUNT(*)::integer FROM atlas_media WHERE user_id = $1) AS media_count,
          (SELECT COUNT(*)::integer FROM atlas_media_upload_intents WHERE user_id = $1) AS upload_intent_count,
          (SELECT COUNT(*)::integer FROM atlas_chapters WHERE user_id = $1) AS chapter_count,
          (SELECT COUNT(*)::integer FROM atlas_chapter_entries WHERE user_id = $1) AS chapter_entry_count,
          (SELECT COUNT(*)::integer FROM atlas_import_batches WHERE user_id = $1) AS import_batch_count,
          (SELECT COUNT(*)::integer FROM atlas_import_items WHERE user_id = $1) AS import_item_count,
          (SELECT COUNT(*)::integer FROM atlas_journey_suggestion_feedback WHERE user_id = $1) AS journey_feedback_count,
          (SELECT COUNT(*)::integer FROM auth_sessions WHERE user_id = $1) AS session_count
      `,
      [fixtureUserId, configuration.email],
    );
    assertE2ELifecycleEmptyAccountState(emptyState.rows[0]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  await resetE2ELifecycleMediaStorage(mediaStorageConfiguration);
  console.log('Seeded the empty Field Atlas lifecycle E2E fixture.');
}

module.exports = {
  E2E_LIFECYCLE_FIXTURE,
  assertE2ELifecycleEmptyAccountState,
  assertE2ELifecycleMediaStorageSafe,
  assertE2ELifecycleSeedDatabaseState,
  getE2ELifecycleMediaStorageConfiguration,
  getE2ELifecycleSeedConfiguration,
  resetE2ELifecycleMediaStorage,
  seedE2ELifecycleDatabase,
};

if (require.main === module) {
  seedE2ELifecycleDatabase().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
