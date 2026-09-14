import { access, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  E2E_FIXTURE,
  assertE2ESeedDatabaseState,
  getE2EMediaStorageConfiguration,
  getE2ESeedConfiguration,
  resetE2EMediaStorage,
} from '../../scripts/seed-e2e.js';

const validEnvironment = {
  E2E_DATABASE_SEED: '1',
  E2E_DATABASE_URL:
    'postgresql://field_atlas_runtime:test-password@127.0.0.1:5432/field_atlas_e2e',
  E2E_TEST_EMAIL: 'field-atlas-e2e@example.test',
  E2E_TEST_PASSWORD: 'A dedicated E2E password',
};

const validMediaEnvironment = {
  E2E_MEDIA_STORAGE_ADAPTER: 'filesystem',
  E2E_MEDIA_STORAGE_ROOT:
    '/tmp/field-atlas-e2e-tests/field-atlas-e2e-media-123',
  RUNNER_TEMP: '/tmp/field-atlas-e2e-tests',
};

describe('E2E database seed guard', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('accepts only a dedicated filesystem root inside the test temp directory', () => {
    expect(getE2EMediaStorageConfiguration(validMediaEnvironment)).toEqual({
      boundary: '/tmp/field-atlas-e2e-tests',
      storageRoot: '/tmp/field-atlas-e2e-tests/field-atlas-e2e-media-123',
    });
  });

  it.each([
    [
      'another adapter',
      { E2E_MEDIA_STORAGE_ADAPTER: 'blob' },
      'must be filesystem',
    ],
    [
      'a relative root',
      { E2E_MEDIA_STORAGE_ROOT: 'field-atlas-e2e-media-123' },
      'must be an absolute path',
    ],
    [
      'the temp boundary itself',
      { E2E_MEDIA_STORAGE_ROOT: '/tmp/field-atlas-e2e-tests' },
      'dedicated field-atlas-e2e-media directory',
    ],
    [
      'a root outside the temp boundary',
      { E2E_MEDIA_STORAGE_ROOT: '/tmp/field-atlas-e2e-media-123' },
      'dedicated field-atlas-e2e-media directory',
    ],
    [
      'an unrelated directory name',
      {
        E2E_MEDIA_STORAGE_ROOT:
          '/tmp/field-atlas-e2e-tests/unrelated-directory',
      },
      'dedicated field-atlas-e2e-media directory',
    ],
    ['a Vercel runtime', { VERCEL: '1' }, 'cannot run in a Vercel environment'],
  ])('rejects %s for media cleanup', (_label, override, expectedMessage) => {
    expect(() =>
      getE2EMediaStorageConfiguration({
        ...validMediaEnvironment,
        ...override,
      }),
    ).toThrow(expectedMessage);
  });

  it('resets only the validated media directory', async () => {
    const boundary = await mkdtemp(
      path.join(os.tmpdir(), 'field-atlas-e2e-seed-test-'),
    );
    temporaryDirectories.push(boundary);
    const storageRoot = path.join(boundary, 'field-atlas-e2e-media-unit');
    const configuration = getE2EMediaStorageConfiguration({
      ...validMediaEnvironment,
      E2E_MEDIA_STORAGE_ROOT: storageRoot,
      RUNNER_TEMP: boundary,
    });

    await resetE2EMediaStorage(configuration);
    await writeFile(path.join(storageRoot, 'stale-object'), 'stale');
    await resetE2EMediaStorage(configuration);

    await expect(access(storageRoot)).resolves.toBeUndefined();
    await expect(
      access(path.join(storageRoot, 'stale-object')),
    ).rejects.toThrow(/ENOENT/);
  });

  it('refuses to follow a symbolic-link media root', async () => {
    const boundary = await mkdtemp(
      path.join(os.tmpdir(), 'field-atlas-e2e-seed-test-'),
    );
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'field-atlas-e2e-seed-outside-'),
    );
    temporaryDirectories.push(boundary, outside);
    const storageRoot = path.join(boundary, 'field-atlas-e2e-media-unit');
    await writeFile(path.join(outside, 'must-survive'), 'safe');
    await symlink(outside, storageRoot);

    await expect(
      resetE2EMediaStorage({ boundary, storageRoot }),
    ).rejects.toThrow('must not be a symbolic link');
    await expect(
      access(path.join(outside, 'must-survive')),
    ).resolves.toBeUndefined();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the dedicated database on loopback host %s',
    (hostname) => {
      const environment = {
        ...validEnvironment,
        E2E_DATABASE_URL: `postgresql://runtime:test-password@${hostname}:5432/field_atlas_e2e`,
      };

      expect(getE2ESeedConfiguration(environment)).toEqual({
        connectionString: environment.E2E_DATABASE_URL,
        databaseName: 'field_atlas_e2e',
        email: 'field-atlas-e2e@example.test',
        password: 'A dedicated E2E password',
      });
    },
  );

  it('requires the explicit seed opt-in', () => {
    expect(() =>
      getE2ESeedConfiguration({
        ...validEnvironment,
        E2E_DATABASE_SEED: '0',
      }),
    ).toThrow('E2E_DATABASE_SEED=1');
  });

  it('never falls back to the application database URL', () => {
    const environment = {
      ...validEnvironment,
      DATABASE_URL: validEnvironment.E2E_DATABASE_URL,
      E2E_DATABASE_URL: '',
    };

    expect(() => getE2ESeedConfiguration(environment)).toThrow(
      'E2E_DATABASE_URL is required',
    );
  });

  it.each([
    [
      'a remote host',
      {
        E2E_DATABASE_URL:
          'postgresql://runtime:test-password@database.example.test:5432/field_atlas_e2e',
      },
      'loopback host',
    ],
    [
      'another database',
      {
        E2E_DATABASE_URL:
          'postgresql://runtime:test-password@127.0.0.1:5432/field_atlas',
      },
      'field_atlas_e2e database',
    ],
    [
      'a query-parameter host override',
      {
        E2E_DATABASE_URL:
          'postgresql://runtime:test-password@127.0.0.1:5432/field_atlas_e2e?host=database.example.test',
      },
      'must not override its loopback host',
    ],
    [
      'another email',
      { E2E_TEST_EMAIL: 'someone@example.test' },
      'E2E_TEST_EMAIL must be exactly',
    ],
    [
      'a short password',
      { E2E_TEST_PASSWORD: 'too-short' },
      'between 15 and 128 characters',
    ],
    [
      'an oversized password',
      { E2E_TEST_PASSWORD: 'x'.repeat(129) },
      'between 15 and 128 characters',
    ],
  ])('rejects %s', (_label, override, expectedMessage) => {
    expect(() =>
      getE2ESeedConfiguration({ ...validEnvironment, ...override }),
    ).toThrow(expectedMessage);
  });

  it('accepts an empty database or the exact existing fixture', () => {
    const configuration = getE2ESeedConfiguration(validEnvironment);

    expect(() =>
      assertE2ESeedDatabaseState(configuration, {
        databaseName: 'field_atlas_e2e',
        users: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertE2ESeedDatabaseState(configuration, {
        databaseName: 'field_atlas_e2e',
        users: [
          {
            id: E2E_FIXTURE.userId,
            email: E2E_FIXTURE.email,
            role: 'user',
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    [
      'a different connected database',
      {
        databaseName: 'field_atlas',
        users: [],
      },
      'not the dedicated E2E database',
    ],
    [
      'a conflicting fixture id',
      {
        databaseName: 'field_atlas_e2e',
        users: [
          {
            id: E2E_FIXTURE.userId,
            email: 'another-user@example.test',
            role: 'user',
          },
        ],
      },
      'belongs to a different account',
    ],
    [
      'a conflicting fixture email',
      {
        databaseName: 'field_atlas_e2e',
        users: [
          {
            id: 'fa3aa498-7488-4307-a870-3c793008eb74',
            email: E2E_FIXTURE.email,
            role: 'user',
          },
        ],
      },
      'belongs to a different account',
    ],
    [
      'an unrelated user',
      {
        databaseName: 'field_atlas_e2e',
        users: [
          {
            id: 'fa3aa498-7488-4307-a870-3c793008eb74',
            email: 'another-user@example.test',
            role: 'user',
          },
        ],
      },
      'belongs to a different account',
    ],
    [
      'multiple users',
      {
        databaseName: 'field_atlas_e2e',
        users: [
          {
            id: E2E_FIXTURE.userId,
            email: E2E_FIXTURE.email,
            role: 'user',
          },
          {
            id: 'fa3aa498-7488-4307-a870-3c793008eb74',
            email: 'another-user@example.test',
            role: 'user',
          },
        ],
      },
      'contains users outside the deterministic fixture',
    ],
    [
      'a protected owner in the fixture slot',
      {
        databaseName: 'field_atlas_e2e',
        users: [
          {
            id: E2E_FIXTURE.userId,
            email: E2E_FIXTURE.email,
            role: 'owner',
          },
        ],
      },
      'protected owner',
    ],
  ])('rejects %s', (_label, databaseState, expectedMessage) => {
    const configuration = getE2ESeedConfiguration(validEnvironment);

    expect(() =>
      assertE2ESeedDatabaseState(configuration, databaseState),
    ).toThrow(expectedMessage);
  });
});
