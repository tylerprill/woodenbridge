const { lstat, mkdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const E2E_FIXTURE = Object.freeze({
  chapterId: '6a67afcf-768f-4fe4-8c62-41b58a19840d',
  chapterIds: [
    '6a67afcf-768f-4fe4-8c62-41b58a19840d',
    '7b78c0ed-8790-4fb7-9d73-52c72f91540e',
  ],
  clientRequestId: '98bfaf78-21bc-4df8-94e6-707433c0e9fe',
  databaseName: 'field_atlas_e2e',
  email: 'field-atlas-e2e@example.test',
  entryId: '0a934c64-997f-43c2-88a3-8b102d517781',
  entryIds: [
    '0a934c64-997f-43c2-88a3-8b102d517781',
    'b19d274a-71a9-4c75-a02e-3f66bb943102',
    'c2ae385b-82ba-4d86-b13f-4a77cc054213',
    'd3bf496c-93cb-4e97-8240-5b88dd165324',
  ],
  overlapChapterId: '7b78c0ed-8790-4fb7-9d73-52c72f91540e',
  overlapShareId: 'b6752ec2-f201-4ee4-a044-36d25e73f436',
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
const E2E_MEDIA_STORAGE_ROOT_PATTERN =
  /^field-atlas-e2e-media(?:-[A-Za-z0-9._-]+)?$/;

function getE2EMediaStorageConfiguration(environment) {
  if (environment.E2E_MEDIA_STORAGE_ADAPTER !== 'filesystem') {
    throw new Error(
      'E2E_MEDIA_STORAGE_ADAPTER must be filesystem before test media can be reset.',
    );
  }
  if (environment.VERCEL === '1' || environment.VERCEL_ENV) {
    throw new Error(
      'The E2E filesystem media adapter cannot run in a Vercel environment.',
    );
  }

  const configuredRoot = environment.E2E_MEDIA_STORAGE_ROOT;
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error('E2E_MEDIA_STORAGE_ROOT must be an absolute path.');
  }

  const boundary = path.resolve(environment.RUNNER_TEMP || os.tmpdir());
  const storageRoot = path.resolve(configuredRoot);
  const relativeRoot = path.relative(boundary, storageRoot);
  if (
    !relativeRoot ||
    relativeRoot.startsWith(`..${path.sep}`) ||
    relativeRoot === '..' ||
    path.isAbsolute(relativeRoot) ||
    relativeRoot.includes(path.sep) ||
    !E2E_MEDIA_STORAGE_ROOT_PATTERN.test(path.basename(storageRoot))
  ) {
    throw new Error(
      'E2E_MEDIA_STORAGE_ROOT must be a dedicated field-atlas-e2e-media directory inside the test temp directory.',
    );
  }

  return { boundary, storageRoot };
}

async function resetE2EMediaStorage(configuration) {
  const boundary = await lstat(configuration.boundary);
  if (boundary.isSymbolicLink() || !boundary.isDirectory()) {
    throw new Error('The E2E media temp boundary must be a real directory.');
  }
  try {
    const current = await lstat(configuration.storageRoot);
    if (current.isSymbolicLink()) {
      throw new Error('E2E_MEDIA_STORAGE_ROOT must not be a symbolic link.');
    }
    if (!current.isDirectory()) {
      throw new Error('E2E_MEDIA_STORAGE_ROOT must be a directory.');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await rm(configuration.storageRoot, { recursive: true, force: true });
  await mkdir(configuration.storageRoot, { recursive: true, mode: 0o700 });
}

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

  const overridesAuthorityHost = Array.from(
    connection.searchParams.keys(),
  ).some((key) => key.toLowerCase() === 'host');
  if (overridesAuthorityHost) {
    throw new Error(
      'E2E_DATABASE_URL must not override its loopback host with a query parameter.',
    );
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
  let mediaStorageConfiguration = null;
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

    const mediaResult = await client.query(
      `
        SELECT
          (SELECT COUNT(*)::integer FROM atlas_media WHERE user_id = $1) AS media_count,
          (
            SELECT COUNT(*)::integer
            FROM atlas_media_upload_intents
            WHERE user_id = $1
          ) AS upload_intent_count
      `,
      [E2E_FIXTURE.userId],
    );
    const mediaCount = mediaResult.rows[0]?.media_count ?? 0;
    const uploadIntentCount = mediaResult.rows[0]?.upload_intent_count ?? 0;
    mediaStorageConfiguration =
      environment.E2E_MEDIA_STORAGE_ADAPTER === 'filesystem'
        ? getE2EMediaStorageConfiguration(environment)
        : null;

    if (
      (mediaCount > 0 || uploadIntentCount > 0) &&
      !mediaStorageConfiguration
    ) {
      throw new Error(
        'Refusing to reset an E2E fixture that has media or upload reservations without its isolated filesystem storage.',
      );
    }
    if (mediaStorageConfiguration) {
      await client.query(
        'DELETE FROM atlas_media_upload_intents WHERE user_id = $1',
        [E2E_FIXTURE.userId],
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

    const atlasEntries = [
      {
        id: E2E_FIXTURE.entryIds[0],
        clientRequestId: E2E_FIXTURE.clientRequestId,
        title: 'Morning along the Detroit RiverWalk',
        description:
          'Early light on the river, with the city waking up behind the trail.',
        placeLabel: 'Detroit RiverWalk, Detroit, Michigan',
        visitedOn: '2025-09-14',
        longitude: -83.0236,
        latitude: 42.3336,
        placeName: 'Detroit RiverWalk',
        locality: 'Detroit',
        region: 'Michigan',
      },
      {
        id: E2E_FIXTURE.entryIds[1],
        clientRequestId: 'a4c057ae-2ef9-4b5c-9501-4f76c6119301',
        title: 'Bikes beneath the Belle Isle trees',
        description: 'A slow lap through the island shade beside the river.',
        placeLabel: 'Belle Isle, Detroit, Michigan',
        visitedOn: '2025-09-15',
        longitude: -82.9857,
        latitude: 42.3403,
        placeName: 'Belle Isle',
        locality: 'Detroit',
        region: 'Michigan',
      },
      {
        id: E2E_FIXTURE.entryIds[2],
        clientRequestId: 'b5d168bf-3f0a-4c6d-a612-5087d7220412',
        title: 'Rain settling over Main Street',
        description: 'Storefront lights reflected across the wet pavement.',
        placeLabel: 'Main Street, Ann Arbor, Michigan',
        visitedOn: '2025-09-17',
        longitude: -83.7487,
        latitude: 42.2796,
        placeName: 'Main Street',
        locality: 'Ann Arbor',
        region: 'Michigan',
      },
      {
        id: E2E_FIXTURE.entryIds[3],
        clientRequestId: 'c6e279c0-401b-4d7e-b723-6198e8331523',
        title: 'Dunes above Lake Michigan',
        description: 'Wind drew new lines over the bluff before sunset.',
        placeLabel: 'Sleeping Bear Dunes, Michigan',
        visitedOn: '2025-09-20',
        longitude: -86.065,
        latitude: 44.8826,
        placeName: 'Sleeping Bear Dunes',
        locality: null,
        region: 'Michigan',
      },
    ];

    for (const entry of atlasEntries) {
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
          $4,
          $5,
          $6,
          $7::date,
          'saved',
          'visited',
          ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
          1,
          $10,
          $11,
          $12,
          'United States',
          'US',
          'e2e-fixture',
          TIMESTAMPTZ '2025-09-14 12:00:00+00'
        )
        `,
        [
          entry.id,
          E2E_FIXTURE.userId,
          entry.clientRequestId,
          entry.title,
          entry.description,
          entry.placeLabel,
          entry.visitedOn,
          entry.longitude,
          entry.latitude,
          entry.placeName,
          entry.locality,
          entry.region,
        ],
      );
    }

    const atlasChapters = [
      {
        id: E2E_FIXTURE.chapterId,
        title: 'Michigan, mile by mile',
        introduction:
          'Four remembered stops from the Detroit River to the Lake Michigan dunes.',
        shareId: E2E_FIXTURE.shareId,
        entryIds: E2E_FIXTURE.entryIds,
      },
      {
        id: E2E_FIXTURE.overlapChapterId,
        title: 'City streets and river light',
        introduction:
          'A shorter path through three memories shared with the longer Michigan journey.',
        shareId: E2E_FIXTURE.overlapShareId,
        entryIds: E2E_FIXTURE.entryIds.slice(0, 3),
      },
    ];

    for (const chapter of atlasChapters) {
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
          $3,
          $4,
          NULL,
          'private',
          $5,
          TRUE,
          'approximate',
          1
        )
        `,
        [
          chapter.id,
          E2E_FIXTURE.userId,
          chapter.title,
          chapter.introduction,
          chapter.shareId,
        ],
      );

      for (const [position, entryId] of chapter.entryIds.entries()) {
        await client.query(
          `
            INSERT INTO atlas_chapter_entries (
              chapter_id,
              entry_id,
              user_id,
              position,
              transition_note
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            chapter.id,
            entryId,
            E2E_FIXTURE.userId,
            position,
            position === 0
              ? ''
              : 'The road carried the story toward the next remembered place.',
          ],
        );
      }
    }

    await client.query('COMMIT');
    if (mediaStorageConfiguration) {
      await resetE2EMediaStorage(mediaStorageConfiguration);
    }
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
  getE2EMediaStorageConfiguration,
  getE2ESeedConfiguration,
  resetE2EMediaStorage,
  seedE2EDatabase,
};

if (require.main === module) {
  seedE2EDatabase().catch((error) => {
    console.error(`E2E database seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}
