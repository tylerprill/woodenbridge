import 'server-only';

import {
  db as postgresDb,
  sql as postgresSql,
  type VercelPoolClient,
} from '@vercel/postgres';

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

// Next.js imports Route Handlers while collecting build metadata. Keep that
// import side-effect free, while still requiring the independently managed,
// least-privilege DATABASE_URL before the first runtime database operation.
const sql = guardRuntimeDatabase(postgresSql ?? postgresDb);
const db = guardRuntimeDatabase(postgresDb ?? postgresSql);

export { db, sql, type VercelPoolClient };
