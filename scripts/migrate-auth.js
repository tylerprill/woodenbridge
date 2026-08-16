const { readFile, readdir } = require('node:fs/promises');
const { resolve } = require('node:path');

const { db } = require('@vercel/postgres');

async function main() {
  const migrationsDirectory = resolve(process.cwd(), 'migrations');
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  const client = await db.connect();

  try {
    for (const migrationFile of migrationFiles) {
      const migrationPath = resolve(migrationsDirectory, migrationFile);
      const migration = await readFile(migrationPath, 'utf8');
      await client.query(migration);
      console.log(`Applied ${migrationFile}.`);
    }

    console.log('Authentication migrations applied successfully.');
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((error) => {
  console.error('Authentication migration failed:', error.message);
  process.exitCode = 1;
});
