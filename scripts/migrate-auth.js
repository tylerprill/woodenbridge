const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const { db } = require('@vercel/postgres');

async function main() {
  const migrationPath = resolve(
    process.cwd(),
    'migrations/001_password_reset.sql',
  );
  const migration = await readFile(migrationPath, 'utf8');
  const client = await db.connect();

  try {
    await client.query(migration);
    console.log('Password recovery migration applied successfully.');
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((error) => {
  console.error('Password recovery migration failed:', error.message);
  process.exitCode = 1;
});
