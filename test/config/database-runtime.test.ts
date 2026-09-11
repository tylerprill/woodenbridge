const originalEnvironment = process.env;

type DatabaseModule = typeof import('@/app/lib/db');

function mockPostgresClient() {
  const query = Object.assign(jest.fn().mockResolvedValue({ rows: [] }), {
    connect: jest.fn(),
  });
  jest.doMock('@vercel/postgres', () => ({ db: query, sql: query }));
  return query;
}

function mockNativePostgres() {
  const clientQuery = jest.fn().mockResolvedValue({ rows: [] });
  const release = jest.fn();
  const client = { query: clientQuery, release };
  const poolQuery = jest.fn().mockResolvedValue({ rows: [] });
  const connect = jest.fn().mockResolvedValue(client);
  const end = jest.fn().mockResolvedValue(undefined);
  const pool = { connect, end, query: poolQuery };
  const Pool = jest.fn(() => pool);

  jest.doMock('pg', () => ({ Pool }));

  return { clientQuery, connect, end, poolQuery, Pool, release };
}

async function loadDatabaseModule() {
  let databaseModule: DatabaseModule | undefined;
  await jest.isolateModulesAsync(async () => {
    databaseModule = await import('@/app/lib/db');
  });
  if (!databaseModule) throw new Error('Database module did not load.');
  return databaseModule;
}

describe('runtime database configuration', () => {
  afterEach(() => {
    process.env = originalEnvironment;
    jest.resetModules();
    jest.dontMock('@vercel/postgres');
    jest.dontMock('pg');
  });

  it('allows the database module to load without build-time credentials', async () => {
    process.env = { ...originalEnvironment, NODE_ENV: 'production' };
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    const query = mockPostgresClient();

    const database = await loadDatabaseModule();

    expect(query).not.toHaveBeenCalled();
    expect(() => database.sql`SELECT 1`).toThrow(
      'DATABASE_URL is required for the production runtime.',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a legacy production POSTGRES_URL without DATABASE_URL', async () => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'production',
      POSTGRES_URL: 'postgresql://legacy.example.test/database',
    };
    delete process.env.DATABASE_URL;
    const query = mockPostgresClient();
    const database = await loadDatabaseModule();

    expect(() => database.db.connect).toThrow(
      'DATABASE_URL is required for the production runtime.',
    );
    expect(query.connect).not.toHaveBeenCalled();
  });

  it('maps the least-privilege runtime URL immediately before use', async () => {
    const runtimeUrl =
      'postgresql://runtime:password@runtime-pooler.example.test/database';
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL: runtimeUrl,
    };
    delete process.env.POSTGRES_URL;
    const query = mockPostgresClient();
    const database = await loadDatabaseModule();

    await database.sql`SELECT 1`;

    expect(process.env.POSTGRES_URL).toBe(runtimeUrl);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('uses native PostgreSQL only for the explicitly opted-in E2E database', async () => {
    const runtimeUrl =
      'postgresql://runtime:password@127.0.0.1:5432/field_atlas_e2e';
    process.env = {
      ...originalEnvironment,
      DATABASE_URL: runtimeUrl,
      E2E_DATABASE_ADAPTER: 'pg',
      NODE_ENV: 'production',
    };
    delete process.env.POSTGRES_URL;
    const vercelQuery = mockPostgresClient();
    const native = mockNativePostgres();
    const database = await loadDatabaseModule();

    expect(native.Pool).not.toHaveBeenCalled();
    await database.sql`SELECT ${'atlas'}::text`;
    await database.sql.query('SELECT $1::integer', [7]);
    const client = await database.db.connect();
    await client.sql`SELECT ${42}::integer`;
    await client.query('SELECT $1::text', ['client']);
    client.release();
    await database.sql.end();

    expect(native.Pool).toHaveBeenCalledWith({
      connectionString: runtimeUrl,
      max: 12,
    });
    expect(native.poolQuery).toHaveBeenNthCalledWith(1, 'SELECT $1::text', [
      'atlas',
    ]);
    expect(native.poolQuery).toHaveBeenNthCalledWith(
      2,
      'SELECT $1::integer',
      [7],
    );
    expect(native.connect).toHaveBeenCalledTimes(1);
    expect(native.clientQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT $1::integer',
      [42],
    );
    expect(native.clientQuery).toHaveBeenNthCalledWith(2, 'SELECT $1::text', [
      'client',
    ]);
    expect(native.release).toHaveBeenCalledTimes(1);
    expect(native.end).toHaveBeenCalledTimes(1);
    expect(vercelQuery).not.toHaveBeenCalled();
  });

  it.each([
    [
      'postgresql://runtime:password@database.example.test:5432/field_atlas_e2e',
      'restricted to the loopback field_atlas_e2e database',
    ],
    [
      'postgresql://runtime:password@localhost:5432/field_atlas',
      'restricted to the loopback field_atlas_e2e database',
    ],
    [
      'https://localhost/field_atlas_e2e',
      'restricted to the loopback field_atlas_e2e database',
    ],
    [
      'postgresql://runtime:password@127.0.0.1:5432/field_atlas_e2e?host=database.example.test',
      'restricted to the loopback field_atlas_e2e database',
    ],
    ['not-a-url', 'DATABASE_URL must be a valid PostgreSQL URL'],
  ])(
    'rejects an unsafe native E2E target: %s',
    async (runtimeUrl, expectedMessage) => {
      process.env = {
        ...originalEnvironment,
        DATABASE_URL: runtimeUrl,
        E2E_DATABASE_ADAPTER: 'pg',
        NODE_ENV: 'production',
      };
      const vercelQuery = mockPostgresClient();
      const native = mockNativePostgres();
      const database = await loadDatabaseModule();

      await expect(database.sql`SELECT 1`).rejects.toThrow(expectedMessage);

      expect(native.Pool).not.toHaveBeenCalled();
      expect(vercelQuery).not.toHaveBeenCalled();
    },
  );

  it('requires DATABASE_URL for the native E2E adapter', async () => {
    process.env = {
      ...originalEnvironment,
      E2E_DATABASE_ADAPTER: 'pg',
      NODE_ENV: 'production',
    };
    delete process.env.DATABASE_URL;
    const vercelQuery = mockPostgresClient();
    const native = mockNativePostgres();
    const database = await loadDatabaseModule();

    await expect(database.sql`SELECT 1`).rejects.toThrow(
      'DATABASE_URL is required for the native E2E PostgreSQL adapter',
    );

    expect(native.Pool).not.toHaveBeenCalled();
    expect(vercelQuery).not.toHaveBeenCalled();
  });
});
