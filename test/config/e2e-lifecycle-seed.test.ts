import { createHmac } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  E2E_LIFECYCLE_FIXTURE,
  assertE2ELifecycleEmptyAccountState,
  assertE2ELifecycleMediaStorageSafe,
  assertE2ELifecycleSeedDatabaseState,
  getE2ELifecycleMediaStorageConfiguration,
  getE2ELifecycleSeedConfiguration,
  resetE2ELifecycleMediaStorage,
} from '../../scripts/seed-e2e-lifecycle.js';

const authHmacSecret = 'lifecycle-e2e-hmac-secret-material';
const validEnvironment = {
  AUTH_HMAC_SECRET: authHmacSecret,
  E2E_LIFECYCLE_DATABASE_SEED: '1',
  E2E_LIFECYCLE_DATABASE_URL:
    'postgresql://migration_owner:test-password@127.0.0.1:5432/field_atlas_e2e_lifecycle',
  E2E_LIFECYCLE_TEST_EMAIL: 'field-atlas-lifecycle-e2e@example.test',
  E2E_LIFECYCLE_TEST_PASSWORD: 'A dedicated lifecycle E2E password',
};

const validMediaEnvironment = {
  E2E_MEDIA_STORAGE_ADAPTER: 'filesystem',
  E2E_MEDIA_STORAGE_ROOT:
    '/tmp/field-atlas-lifecycle-tests/field-atlas-e2e-media-lifecycle-123',
  RUNNER_TEMP: '/tmp/field-atlas-lifecycle-tests',
};

const emptyAccountState = {
  account_count: 1,
  chapter_count: 0,
  chapter_entry_count: 0,
  entry_count: 0,
  import_batch_count: 0,
  import_item_count: 0,
  journey_feedback_count: 0,
  media_count: 0,
  preference_count: 1,
  session_count: 0,
  upload_intent_count: 0,
};

describe('dedicated lifecycle E2E fixture guard', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts only the lifecycle database on loopback host %s',
    (hostname) => {
      const environment = {
        ...validEnvironment,
        E2E_LIFECYCLE_DATABASE_URL: `postgresql://migration_owner:test-password@${hostname}:5432/field_atlas_e2e_lifecycle`,
      };
      const configuration = getE2ELifecycleSeedConfiguration(environment);

      expect(configuration).toEqual({
        connectionString: environment.E2E_LIFECYCLE_DATABASE_URL,
        databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
        email: E2E_LIFECYCLE_FIXTURE.email,
        emailRateLimitHash: createHmac('sha256', authHmacSecret)
          .update(`rate-limit:v1:email:${E2E_LIFECYCLE_FIXTURE.email}`)
          .digest('hex'),
        password: validEnvironment.E2E_LIFECYCLE_TEST_PASSWORD,
      });
    },
  );

  it('requires its dedicated opt-in and never falls back to application database variables', () => {
    expect(() =>
      getE2ELifecycleSeedConfiguration({
        ...validEnvironment,
        E2E_LIFECYCLE_DATABASE_SEED: '0',
      }),
    ).toThrow('E2E_LIFECYCLE_DATABASE_SEED=1');

    expect(() =>
      getE2ELifecycleSeedConfiguration({
        ...validEnvironment,
        DATABASE_URL: validEnvironment.E2E_LIFECYCLE_DATABASE_URL,
        E2E_LIFECYCLE_DATABASE_URL: '',
      }),
    ).toThrow('E2E_LIFECYCLE_DATABASE_URL is required');
  });

  it.each([
    [
      'a remote host',
      {
        E2E_LIFECYCLE_DATABASE_URL:
          'postgresql://migration_owner:test-password@database.example.test:5432/field_atlas_e2e_lifecycle',
      },
      'loopback host',
    ],
    [
      'the existing shared browser-test database',
      {
        E2E_LIFECYCLE_DATABASE_URL:
          'postgresql://migration_owner:test-password@127.0.0.1:5432/field_atlas_e2e',
      },
      'field_atlas_e2e_lifecycle database',
    ],
    [
      'a host override query',
      {
        E2E_LIFECYCLE_DATABASE_URL:
          'postgresql://migration_owner:test-password@127.0.0.1:5432/field_atlas_e2e_lifecycle?host=database.example.test',
      },
      'must not contain query parameters',
    ],
    [
      'a connection fragment',
      {
        E2E_LIFECYCLE_DATABASE_URL:
          'postgresql://migration_owner:test-password@127.0.0.1:5432/field_atlas_e2e_lifecycle#unexpected',
      },
      'must not contain query parameters or a fragment',
    ],
    [
      'the shared fixture identity',
      { E2E_LIFECYCLE_TEST_EMAIL: 'field-atlas-e2e@example.test' },
      'E2E_LIFECYCLE_TEST_EMAIL must be exactly',
    ],
    [
      'a short password',
      { E2E_LIFECYCLE_TEST_PASSWORD: 'too-short' },
      'between 15 and 128 characters',
    ],
    [
      'a short HMAC secret',
      { AUTH_HMAC_SECRET: 'too-short' },
      'at least 32 bytes',
    ],
  ])('rejects %s', (_label, override, expectedMessage) => {
    expect(() =>
      getE2ELifecycleSeedConfiguration({
        ...validEnvironment,
        ...override,
      }),
    ).toThrow(expectedMessage);
  });

  it('accepts an empty database or the exact active ordinary fixture account', () => {
    const configuration = getE2ELifecycleSeedConfiguration(validEnvironment);

    expect(() =>
      assertE2ELifecycleSeedDatabaseState(configuration, {
        databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
        users: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertE2ELifecycleSeedDatabaseState(configuration, {
        databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
        users: [
          {
            accountStatus: 'active',
            email: E2E_LIFECYCLE_FIXTURE.email,
            id: E2E_LIFECYCLE_FIXTURE.userId,
            role: 'user',
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    [
      'another database',
      {
        databaseName: 'field_atlas_e2e',
        users: [],
      },
      'not the dedicated lifecycle E2E database',
    ],
    [
      'another identity',
      {
        databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
        users: [
          {
            accountStatus: 'active',
            email: 'another-user@example.test',
            id: E2E_LIFECYCLE_FIXTURE.userId,
            role: 'user',
          },
        ],
      },
      'belongs to a different account',
    ],
    [
      'multiple users',
      {
        databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
        users: [
          {
            accountStatus: 'active',
            email: E2E_LIFECYCLE_FIXTURE.email,
            id: E2E_LIFECYCLE_FIXTURE.userId,
            role: 'user',
          },
          {
            accountStatus: 'active',
            email: 'another-user@example.test',
            id: 'f5b061b2-5ec5-4c98-8329-e1634f6951c7',
            role: 'user',
          },
        ],
      },
      'contains users outside the deterministic fixture',
    ],
    [
      'an owner role',
      {
        databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
        users: [
          {
            accountStatus: 'active',
            email: E2E_LIFECYCLE_FIXTURE.email,
            id: E2E_LIFECYCLE_FIXTURE.userId,
            role: 'owner',
          },
        ],
      },
      'not an ordinary user',
    ],
    [
      'a suspended fixture account',
      {
        databaseName: E2E_LIFECYCLE_FIXTURE.databaseName,
        users: [
          {
            accountStatus: 'suspended',
            email: E2E_LIFECYCLE_FIXTURE.email,
            id: E2E_LIFECYCLE_FIXTURE.userId,
            role: 'user',
          },
        ],
      },
      'not active',
    ],
  ])('refuses to reset %s', (_label, databaseState, expectedMessage) => {
    expect(() =>
      assertE2ELifecycleSeedDatabaseState(
        getE2ELifecycleSeedConfiguration(validEnvironment),
        databaseState,
      ),
    ).toThrow(expectedMessage);
  });

  it('accepts only a dedicated lifecycle media root directly inside the test temp directory', () => {
    expect(
      getE2ELifecycleMediaStorageConfiguration(validMediaEnvironment),
    ).toEqual({
      boundary: '/tmp/field-atlas-lifecycle-tests',
      storageRoot:
        '/tmp/field-atlas-lifecycle-tests/field-atlas-e2e-media-lifecycle-123',
    });
  });

  it.each([
    [
      'another adapter',
      { E2E_MEDIA_STORAGE_ADAPTER: 'blob' },
      'must be filesystem',
    ],
    [
      'a relative temp boundary',
      { RUNNER_TEMP: 'relative-temp' },
      'RUNNER_TEMP must be an absolute path',
    ],
    [
      'a relative root',
      { E2E_MEDIA_STORAGE_ROOT: 'field-atlas-e2e-media-lifecycle-123' },
      'must be an absolute path',
    ],
    [
      'the shared full-import root name',
      {
        E2E_MEDIA_STORAGE_ROOT:
          '/tmp/field-atlas-lifecycle-tests/field-atlas-e2e-media-123',
      },
      'dedicated field-atlas-e2e-media-lifecycle directory',
    ],
    [
      'a nested lifecycle root',
      {
        E2E_MEDIA_STORAGE_ROOT:
          '/tmp/field-atlas-lifecycle-tests/nested/field-atlas-e2e-media-lifecycle-123',
      },
      'directly inside the test temp directory',
    ],
    [
      'a root outside the boundary',
      {
        E2E_MEDIA_STORAGE_ROOT: '/tmp/field-atlas-e2e-media-lifecycle-123',
      },
      'directly inside the test temp directory',
    ],
    ['a Vercel runtime', { VERCEL: '1' }, 'cannot run in a Vercel environment'],
  ])('rejects %s for media cleanup', (_label, override, expectedMessage) => {
    expect(() =>
      getE2ELifecycleMediaStorageConfiguration({
        ...validMediaEnvironment,
        ...override,
      }),
    ).toThrow(expectedMessage);
  });

  it('removes stale lifecycle media and recreates only the validated root', async () => {
    const boundary = await mkdtemp(
      path.join(os.tmpdir(), 'field-atlas-lifecycle-seed-test-'),
    );
    temporaryDirectories.push(boundary);
    const storageRoot = path.join(
      boundary,
      'field-atlas-e2e-media-lifecycle-unit',
    );
    const configuration = getE2ELifecycleMediaStorageConfiguration({
      ...validMediaEnvironment,
      E2E_MEDIA_STORAGE_ROOT: storageRoot,
      RUNNER_TEMP: boundary,
    });

    await resetE2ELifecycleMediaStorage(configuration);
    await writeFile(path.join(storageRoot, 'stale-object'), 'stale');
    await resetE2ELifecycleMediaStorage(configuration);

    await expect(access(storageRoot)).resolves.toBeUndefined();
    await expect(
      access(path.join(storageRoot, 'stale-object')),
    ).rejects.toThrow(/ENOENT/);
  });

  it('refuses to follow a symbolic-link lifecycle media root', async () => {
    const boundary = await mkdtemp(
      path.join(os.tmpdir(), 'field-atlas-lifecycle-seed-test-'),
    );
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'field-atlas-lifecycle-seed-outside-'),
    );
    temporaryDirectories.push(boundary, outside);
    const storageRoot = path.join(
      boundary,
      'field-atlas-e2e-media-lifecycle-unit',
    );
    await writeFile(path.join(outside, 'must-survive'), 'safe');
    await symlink(outside, storageRoot);

    await expect(
      resetE2ELifecycleMediaStorage({ boundary, storageRoot }),
    ).rejects.toThrow('must not be a symbolic link');
    await expect(
      access(path.join(outside, 'must-survive')),
    ).resolves.toBeUndefined();
  });

  it('refuses a symbolic-link temp boundary', async () => {
    const container = await mkdtemp(
      path.join(os.tmpdir(), 'field-atlas-lifecycle-boundary-test-'),
    );
    temporaryDirectories.push(container);
    const realBoundary = path.join(container, 'real-boundary');
    const linkedBoundary = path.join(container, 'linked-boundary');
    await mkdir(realBoundary);
    await symlink(realBoundary, linkedBoundary);

    await expect(
      assertE2ELifecycleMediaStorageSafe({
        boundary: linkedBoundary,
        storageRoot: path.join(
          linkedBoundary,
          'field-atlas-e2e-media-lifecycle-unit',
        ),
      }),
    ).rejects.toThrow('temp boundary must be a real directory');
  });

  it('verifies the seeded account is empty and has one preference row', () => {
    expect(() =>
      assertE2ELifecycleEmptyAccountState(emptyAccountState),
    ).not.toThrow();
    expect(() =>
      assertE2ELifecycleEmptyAccountState({
        ...emptyAccountState,
        session_count: 1,
      }),
    ).toThrow('session_count is 1');
    expect(() =>
      assertE2ELifecycleEmptyAccountState({
        ...emptyAccountState,
        preference_count: 0,
      }),
    ).toThrow('exactly one Atlas preference row');
  });
});
