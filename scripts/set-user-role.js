const { randomUUID } = require('node:crypto');

const { createClient } = require('@vercel/postgres');

const APP_ROLES = new Set(['user', 'admin', 'owner']);

async function main() {
  const [, , emailInput, roleInput] = process.argv;
  const email = emailInput?.trim().toLowerCase();
  const role = roleInput?.trim().toLowerCase();

  if (!email || !role || !APP_ROLES.has(role)) {
    throw new Error('Usage: npm run role:set -- <email> <user|admin|owner>');
  }

  const connectionString = process.env.MIGRATION_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'Set MIGRATION_DATABASE_URL to the direct operator connection before changing roles.',
    );
  }

  const client = createClient({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `
        SELECT id, email, role, email_verified_at
        FROM users
        WHERE LOWER(email) = $1
        FOR UPDATE
      `,
      [email],
    );
    const account = existing.rows[0];

    if (!account) {
      throw new Error(`No account exists for ${email}.`);
    }

    if (account.role === role) {
      await client.query('COMMIT');
      console.log(`${account.email} is already assigned ${role}.`);
      return;
    }

    const changed = await client.query(
      `
        UPDATE users
        SET role = $2::user_role,
            session_version = session_version + 1
        WHERE id = $1
        RETURNING email, role, email_verified_at
      `,
      [account.id, role],
    );

    await client.query(
      `
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE user_id = $1
          AND revoked_at IS NULL
      `,
      [account.id],
    );

    if (role === 'user') {
      await client.query(
        `
          UPDATE privileged_recovery_code_sets
          SET revoked_at = COALESCE(revoked_at, clock_timestamp())
          WHERE user_id = $1
            AND revoked_at IS NULL
        `,
        [account.id],
      );
      await client.query(
        `
          UPDATE privileged_passkey_recovery_grants
          SET consumed_at = COALESCE(consumed_at, clock_timestamp())
          WHERE user_id = $1
            AND consumed_at IS NULL
        `,
        [account.id],
      );
    }

    await client.query(
      `
        INSERT INTO auth_security_events (
          event_id,
          category,
          event,
          outcome,
          target_user_id,
          details
        )
        VALUES ($1, 'authentication', 'management.user_role_changed', 'success', $2, $3::jsonb)
      `,
      [
        randomUUID(),
        account.id,
        JSON.stringify({
          source: 'operator-script',
          previousRole: account.role,
          targetRole: role,
        }),
      ],
    );

    await client.query('COMMIT');

    const updatedAccount = changed.rows[0];
    console.log(
      `${updatedAccount.email} is now ${updatedAccount.role}. Existing sessions were revoked.`,
    );

    if (!updatedAccount.email_verified_at) {
      console.log(
        'This account must still verify its email before signing in.',
      );
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Role assignment failed:', error.message);
  process.exitCode = 1;
});
