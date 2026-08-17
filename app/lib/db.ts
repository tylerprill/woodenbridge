import 'server-only';

import { db, sql, type VercelPoolClient } from '@vercel/postgres';

// @vercel/postgres reads POSTGRES_URL lazily on the first query. Production
// must explicitly provide the independently managed least-privilege runtime
// credential; legacy integration variables remain a local-development fallback.
if (process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
} else if (process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required for the production runtime.');
}

export { db, sql, type VercelPoolClient };
