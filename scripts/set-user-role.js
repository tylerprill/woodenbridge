const { db } = require('@vercel/postgres');

const APP_ROLES = new Set(['user', 'admin', 'owner']);

async function main() {
  const [, , emailInput, roleInput] = process.argv;
  const email = emailInput?.trim().toLowerCase();
  const role = roleInput?.trim().toLowerCase();

  if (!email || !role || !APP_ROLES.has(role)) {
    throw new Error('Usage: npm run role:set -- <email> <user|admin|owner>');
  }

  const client = await db.connect();

  try {
    const result = await client.query(
      `
        UPDATE users
        SET role = $2::user_role,
            session_version = session_version + 1
        WHERE LOWER(email) = $1
          AND role <> $2::user_role
        RETURNING email, role, email_verified_at
      `,
      [email, role],
    );

    if (result.rowCount === 0) {
      const existing = await client.query(
        'SELECT email, role, email_verified_at FROM users WHERE LOWER(email) = $1 LIMIT 1',
        [email],
      );

      if (existing.rowCount === 0) {
        throw new Error(`No account exists for ${email}.`);
      }

      console.log(`${existing.rows[0].email} is already assigned ${role}.`);
      return;
    }

    const account = result.rows[0];
    console.log(
      `${account.email} is now ${account.role}. Existing sessions were revoked.`,
    );

    if (!account.email_verified_at) {
      console.log(
        'This account must still verify its email before signing in.',
      );
    }
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((error) => {
  console.error('Role assignment failed:', error.message);
  process.exitCode = 1;
});
