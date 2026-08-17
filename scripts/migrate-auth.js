const { createHash } = require('node:crypto');
const { readFile, readdir } = require('node:fs/promises');
const { resolve } = require('node:path');

const { createClient } = require('@vercel/postgres');

function getMigrationConnectionString() {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    throw new Error(
      'Set MIGRATION_DATABASE_URL to a direct connection owned by the migration role.',
    );
  }

  return connectionString;
}

function checksumMigration(migration) {
  return createHash('sha256').update(migration).digest('hex');
}

function withoutOuterTransaction(migration) {
  const match = migration.match(/^\s*BEGIN\s*;([\s\S]*?)COMMIT\s*;\s*$/i);
  return match?.[1] ?? migration;
}

async function main() {
  const migrationsDirectory = resolve(process.cwd(), 'migrations');
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  const client = createClient({
    connectionString: getMigrationConnectionString(),
  });
  let migrationLockAcquired = false;

  await client.connect();

  try {
    // A session-level advisory lock serializes independent deploy runners. Without
    // it, two processes can both observe a missing ledger row, apply the same DDL,
    // and then race while inserting into schema_migrations.
    await client.query(
      'SELECT pg_advisory_lock($1, $2)',
      [1180787795, 1096111171],
    );
    migrationLockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT schema_migrations_checksum_length
          CHECK (LENGTH(checksum) = 64)
      )
    `);

    for (const migrationFile of migrationFiles) {
      const migrationPath = resolve(migrationsDirectory, migrationFile);
      const migration = await readFile(migrationPath, 'utf8');
      const checksum = checksumMigration(migration);
      const appliedMigration = await client.query(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [migrationFile],
      );

      if (appliedMigration.rowCount === 1) {
        if (appliedMigration.rows[0].checksum.trim() !== checksum) {
          throw new Error(
            `Migration ${migrationFile} was changed after it was applied. Add a new migration instead.`,
          );
        }

        console.log(`Skipped ${migrationFile}; already applied.`);
        continue;
      }

      await client.query('BEGIN');

      try {
        await client.query(withoutOuterTransaction(migration));
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [migrationFile, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      console.log(`Applied ${migrationFile}.`);
    }

    console.log('Database migrations applied successfully.');
  } finally {
    try {
      if (migrationLockAcquired) {
        await client.query(
          'SELECT pg_advisory_unlock($1, $2)',
          [1180787795, 1096111171],
        );
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
});
