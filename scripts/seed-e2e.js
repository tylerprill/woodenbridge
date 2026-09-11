const E2E_FIXTURE = Object.freeze({
  chapterId: '6a67afcf-768f-4fe4-8c62-41b58a19840d',
  clientRequestId: '98bfaf78-21bc-4df8-94e6-707433c0e9fe',
  databaseName: 'field_atlas_e2e',
  email: 'field-atlas-e2e@example.test',
  entryId: '0a934c64-997f-43c2-88a3-8b102d517781',
  shareId: 'a5641db1-e1f0-4dd1-9876-21444a0cc325',
  userId: 'f2b7d9e0-44d8-4a8d-9b44-0c2e1f47a513',
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

function getE2ESeedConfiguration(environment) {
  if (environment.E2E_DATABASE_SEED !== '1') {
    throw new Error(
      'Refusing to seed without the explicit E2E_DATABASE_SEED=1 opt-in.',
    );
  }

  const connectionString = environment.E2E_DATABASE_URL;
  if (!connectionString) {
    throw new Error('E2E_DATABASE_URL is required for the E2E database seed.');
  }

  let connection;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error('E2E_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    throw new Error('E2E_DATABASE_URL must use the PostgreSQL protocol.');
  }

  if (!LOOPBACK_HOSTS.has(connection.hostname.toLowerCase())) {
    throw new Error('E2E_DATABASE_URL must target a loopback host.');
  }

  if (connection.pathname !== `/${E2E_FIXTURE.databaseName}`) {
    throw new Error(
      `E2E_DATABASE_URL must target the ${E2E_FIXTURE.databaseName} database.`,
    );
  }

  const email = environment.E2E_TEST_EMAIL;
  if (email !== E2E_FIXTURE.email) {
    throw new Error(`E2E_TEST_EMAIL must be exactly ${E2E_FIXTURE.email}.`);
  }

  const password = environment.E2E_TEST_PASSWORD;
  if (!password) {
    throw new Error('E2E_TEST_PASSWORD is required for the E2E database seed.');
  }

  const normalizedPassword = password.normalize('NFC');
  const passwordCharacters = Array.from(normalizedPassword).length;
  if (
    passwordCharacters < MIN_PASSWORD_CHARACTERS ||
    passwordCharacters > MAX_PASSWORD_CHARACTERS ||
    Buffer.byteLength(normalizedPassword, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    throw new Error(
      `E2E_TEST_PASSWORD must contain between ${MIN_PASSWORD_CHARACTERS} and ${MAX_PASSWORD_CHARACTERS} characters.`,
    );
  }

  return {
    connectionString,
    databaseName: E2E_FIXTURE.databaseName,
    email,
    password: normalizedPassword,
  };
}

function assertE2ESeedDatabaseState(configuration, databaseState) {
  if (databaseState.databaseName !== configuration.databaseName) {
    throw new Error(
      'The connected database is not the dedicated E2E database.',
    );
  }

  if (databaseState.users.length > 1) {
    throw new Error(
      'The dedicated E2E database contains users outside the deterministic fixture.',
    );
  }

  const existingUser = databaseState.users[0];
  if (!existingUser) return;

  if (
    existingUser.id !== E2E_FIXTURE.userId ||
    existingUser.email.toLowerCase() !== E2E_FIXTURE.email
  ) {
    throw new Error(
      'The deterministic E2E user id or email belongs to a different account.',
    );
  }

  if (existingUser.role === 'owner') {
    throw new Error(
      'The deterministic E2E account is a protected owner and cannot be safely reset.',
    );
  }
}

async function seedE2EDatabase(environment = process.env) {
  const configuration = getE2ESeedConfiguration(environment);
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
      "SELECT pg_advisory_xact_lock(hashtextextended('field-atlas-e2e-seed', 0))",
    );

    const identityResult = await client.query(
      'SELECT current_database() AS database_name',
    );
    const usersResult = await client.query(
      'SELECT id::text, email, role::text FROM users ORDER BY id FOR UPDATE',
    );

    assertE2ESeedDatabaseState(configuration, {
      databaseName: identityResult.rows[0]?.database_name,
      users: usersResult.rows,
    });

    // Upload reservations deliberately use RESTRICT so deleting database rows
    // cannot orphan Blob objects. The audit stops at local review; if that ever
    // changes, destroy the disposable database instead of resetting it here.
    const uploadIntentResult = await client.query(
      'SELECT COUNT(*)::integer AS count FROM atlas_media_upload_intents WHERE user_id = $1',
      [E2E_FIXTURE.userId],
    );
    if ((uploadIntentResult.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Refusing to reset an E2E fixture that has media upload reservations.',
      );
    }

    await client.query('DELETE FROM users WHERE id = $1', [E2E_FIXTURE.userId]);
    await client.query('DELETE FROM login_attempts');

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
        VALUES ($1, 'Field Atlas', 'Explorer', $2, $3, NOW(), 'user', 'active')
      `,
      [E2E_FIXTURE.userId, configuration.email, passwordHash],
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
      [E2E_FIXTURE.userId],
    );

    await client.query(
      `
        INSERT INTO atlas_entries (
          id,
          user_id,
          client_request_id,
          title,
          description,
          place_label,
          visited_on,
          record_state,
          journey_state,
          location,
          version,
          place_name,
          place_locality,
          place_region,
          place_country,
          place_country_code,
          place_geocoder,
          place_geocoded_at
        )
        VALUES (
          $1,
          $2,
          $3,
          'Morning along the Detroit RiverWalk',
          'Early light on the river, with the city waking up behind the trail.',
          'Detroit RiverWalk, Detroit, Michigan',
          DATE '2025-09-14',
          'saved',
          'visited',
          ST_SetSRID(ST_MakePoint(-83.0236, 42.3336), 4326)::geography,
          1,
          'Detroit RiverWalk',
          'Detroit',
          'Michigan',
          'United States',
          'US',
          'e2e-fixture',
          TIMESTAMPTZ '2025-09-14 12:00:00+00'
        )
      `,
      [E2E_FIXTURE.entryId, E2E_FIXTURE.userId, E2E_FIXTURE.clientRequestId],
    );

    await client.query(
      `
        INSERT INTO atlas_chapters (
          id,
          user_id,
          title,
          introduction,
          cover_media_id,
          visibility,
          share_id,
          share_map,
          share_location_precision,
          version
        )
        VALUES (
          $1,
          $2,
          'A morning on the Detroit River',
          'One remembered walk along the water, saved as a small field note.',
          NULL,
          'private',
          $3,
          TRUE,
          'approximate',
          1
        )
      `,
      [E2E_FIXTURE.chapterId, E2E_FIXTURE.userId, E2E_FIXTURE.shareId],
    );

    await client.query(
      `
        INSERT INTO atlas_chapter_entries (
          chapter_id,
          entry_id,
          user_id,
          position,
          transition_note
        )
        VALUES ($1, $2, $3, 0, '')
      `,
      [E2E_FIXTURE.chapterId, E2E_FIXTURE.entryId, E2E_FIXTURE.userId],
    );

    await client.query('COMMIT');
    console.log('Seeded the deterministic Field Atlas E2E fixture.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

module.exports = {
  E2E_FIXTURE,
  assertE2ESeedDatabaseState,
  getE2ESeedConfiguration,
  seedE2EDatabase,
};

if (require.main === module) {
  seedE2EDatabase().catch((error) => {
    console.error(`E2E database seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}
