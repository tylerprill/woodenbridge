const originalEnvironment = process.env;

type DatabaseModule = typeof import('@/app/lib/db');

function mockPostgresClient() {
  const query = Object.assign(jest.fn().mockResolvedValue({ rows: [] }), {
    connect: jest.fn(),
  });
  jest.doMock('@vercel/postgres', () => ({ db: query, sql: query }));
  return query;
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
});
