import 'server-only';

import {
  db as postgresDb,
  sql as postgresSql,
  type VercelPoolClient,
} from '@vercel/postgres';
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const E2E_DATABASE_NAME = 'field_atlas_e2e';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

let nativePool: Pool | undefined;

function configureRuntimeDatabase() {
  if (process.env.DATABASE_URL) {
    process.env.POSTGRES_URL = process.env.DATABASE_URL;
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for the production runtime.');
  }
}

function guardRuntimeDatabase(client: typeof postgresSql) {
  return new Proxy(client, {
    apply(target, thisArgument, argumentsList) {
      configureRuntimeDatabase();
      return Reflect.apply(target, thisArgument, argumentsList);
    },
    get(target, property, receiver) {
      configureRuntimeDatabase();
      return Reflect.get(target, property, receiver);
    },
  });
}

function getE2ENativeConnectionString() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required for the native E2E PostgreSQL adapter.',
    );
  }

  let connection;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  const overridesAuthorityHost = Array.from(
    connection.searchParams.keys(),
  ).some((key) => key.toLowerCase() === 'host');
  if (
    !['postgres:', 'postgresql:'].includes(connection.protocol) ||
    !LOOPBACK_HOSTS.has(connection.hostname.toLowerCase()) ||
    connection.pathname !== `/${E2E_DATABASE_NAME}` ||
    overridesAuthorityHost
  ) {
    throw new Error(
      `The native E2E PostgreSQL adapter is restricted to the loopback ${E2E_DATABASE_NAME} database.`,
    );
  }

  return connectionString;
}

function getNativePool() {
  nativePool ??= new Pool({
    connectionString: getE2ENativeConnectionString(),
    max: 12,
  });
  return nativePool;
}

function compileTemplate(
  strings: TemplateStringsArray,
  values: readonly unknown[],
) {
  let text = strings[0] ?? '';

  for (let index = 1; index < strings.length; index += 1) {
    text += `$${index}${strings[index] ?? ''}`;
  }

  return { text, values: [...values] };
}

function createSqlTag(queryable: Queryable) {
  return async function sqlTag<Row extends QueryResultRow = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<QueryResult<Row>> {
    const query = compileTemplate(strings, values);
    return queryable.query<Row>(query.text, query.values);
  };
}

async function nativeSqlTag<Row extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult<Row>> {
  return createSqlTag(getNativePool())<Row>(strings, ...values);
}

async function connectNativeDatabase() {
  const client = await getNativePool().connect();

  return {
    query: client.query.bind(client),
    release: client.release.bind(client),
    sql: createSqlTag(client),
  } as unknown as VercelPoolClient;
}

const nativeDatabase = Object.assign(nativeSqlTag, {
  connect: connectNativeDatabase,
  end: async () => {
    if (!nativePool) return;
    const pool = nativePool;
    nativePool = undefined;
    await pool.end();
  },
  query: <Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => getNativePool().query<Row>(text, values),
}) as unknown as typeof postgresSql;

// Next.js imports Route Handlers while collecting build metadata. Keep that
// import side-effect free, while still requiring the independently managed,
// least-privilege DATABASE_URL before the first runtime database operation.
const useNativeE2EDatabase = process.env.E2E_DATABASE_ADAPTER === 'pg';
const sql = useNativeE2EDatabase
  ? nativeDatabase
  : guardRuntimeDatabase(postgresSql ?? postgresDb);
const db = useNativeE2EDatabase
  ? nativeDatabase
  : guardRuntimeDatabase(postgresDb ?? postgresSql);

export { db, sql, type VercelPoolClient };
