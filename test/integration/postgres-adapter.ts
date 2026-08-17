import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

type Queryable = Pick<Pool | PoolClient, 'query'>;

function getIntegrationConnectionString() {
  if (process.env.AUTH_INTEGRATION_TESTS !== '1') {
    throw new Error(
      'Refusing to create the auth integration pool without AUTH_INTEGRATION_TESTS=1.',
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

  return connectionString;
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

const pool = new Pool({
  connectionString: getIntegrationConnectionString(),
  max: 12,
});
const poolSql = createSqlTag(pool);

async function connect() {
  const client = await pool.connect();

  return {
    query: client.query.bind(client),
    release: () => client.release(),
    sql: createSqlTag(client),
  };
}

export const sql = Object.assign(poolSql, {
  connect,
  end: () => pool.end(),
  query: pool.query.bind(pool),
});

export const db = sql;
