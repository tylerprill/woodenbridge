const { createClient } = require('@vercel/postgres');

const DEFAULT_RUNTIME_ROLE = 'field_atlas_runtime';
const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

function getMigrationConnectionString() {
  return (
    process.env.MIGRATION_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

async function formattedStatement(client, template, values) {
  const result = await client.query(
    `SELECT format(${template}) AS statement`,
    values,
  );
  return result.rows[0].statement;
}

async function executeFormatted(client, template, values) {
  const statement = await formattedStatement(client, template, values);
  await client.query(statement);
}

async function main() {
  const connectionString = getMigrationConnectionString();
  const runtimeRole =
    process.env.FIELD_ATLAS_RUNTIME_DATABASE_ROLE ?? DEFAULT_RUNTIME_ROLE;
  const runtimePassword =
    process.env.FIELD_ATLAS_RUNTIME_DATABASE_PASSWORD ?? '';

  if (!connectionString) {
    throw new Error(
      'Set MIGRATION_DATABASE_URL to a direct connection owned by the migration role.',
    );
  }

  if (!ROLE_NAME_PATTERN.test(runtimeRole)) {
    throw new Error('The runtime database role name is not valid.');
  }

  if (Buffer.byteLength(runtimePassword, 'utf8') < 32) {
    throw new Error(
      'FIELD_ATLAS_RUNTIME_DATABASE_PASSWORD must contain at least 32 bytes.',
    );
  }

  const client = createClient({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    const identity = await client.query(
      'SELECT current_user, current_database() AS database_name',
    );
    const currentUser = identity.rows[0].current_user;
    const databaseName = identity.rows[0].database_name;

    if (currentUser === runtimeRole) {
      throw new Error(
        'The runtime role must differ from the connected migration role.',
      );
    }

    const existing = await client.query(
      `
        SELECT
          role.rolsuper,
          role.rolcreaterole,
          role.rolcreatedb,
          role.rolreplication,
          role.rolbypassrls,
          EXISTS (
            SELECT 1 FROM pg_catalog.pg_class WHERE relowner = role.oid
          ) OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = role.oid
          ) OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_database WHERE datdba = role.oid
          ) AS owns_objects,
          EXISTS (
            SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = role.oid
          ) AS inherits_roles
        FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = $1
      `,
      [runtimeRole],
    );

    const existingRole = existing.rows[0];
    if (
      existingRole &&
      (existingRole.rolsuper ||
        existingRole.rolcreaterole ||
        existingRole.rolcreatedb ||
        existingRole.rolreplication ||
        existingRole.rolbypassrls ||
        existingRole.owns_objects ||
        existingRole.inherits_roles)
    ) {
      throw new Error(
        'The requested runtime role has elevated privileges or relationships.',
      );
    }

    if (!existingRole) {
      await executeFormatted(
        client,
        "'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', $1::text, $2::text",
        [runtimeRole, runtimePassword],
      );
    }

    await executeFormatted(
      client,
      "'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', $1::text, $2::text",
      [runtimeRole, runtimePassword],
    );
    await executeFormatted(
      client,
      "'GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text",
      [databaseName, runtimeRole],
    );
    await executeFormatted(
      client,
      "'GRANT USAGE ON SCHEMA public TO %I', $1::text",
      [runtimeRole],
    );
    await executeFormatted(
      client,
      "'REVOKE CREATE ON SCHEMA public FROM %I', $1::text",
      [runtimeRole],
    );
    await executeFormatted(
      client,
      "'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', $1::text",
      [runtimeRole],
    );
    await executeFormatted(
      client,
      "'REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM %I', $1::text",
      [runtimeRole],
    );
    await executeFormatted(
      client,
      "'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', $1::text",
      [runtimeRole],
    );
    await executeFormatted(
      client,
      "'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', $1::text, $2::text",
      [currentUser, runtimeRole],
    );
    await executeFormatted(
      client,
      "'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM %I', $1::text, $2::text",
      [currentUser, runtimeRole],
    );
    await executeFormatted(
      client,
      "'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', $1::text, $2::text",
      [currentUser, runtimeRole],
    );

    const effectivePrivileges = await client.query(
      `
        SELECT
          has_schema_privilege($1, 'public', 'CREATE') AS can_create_in_public,
          EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class AS relation
            INNER JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relkind IN ('r', 'p')
              AND has_table_privilege(
                $1,
                format('%I.%I', namespace.nspname, relation.relname),
                'TRUNCATE'
              )
          ) AS can_truncate_application_table
      `,
      [runtimeRole],
    );
    const privileges = effectivePrivileges.rows[0];

    if (
      privileges?.can_create_in_public ||
      privileges?.can_truncate_application_table
    ) {
      throw new Error(
        'The runtime role still has effective CREATE or TRUNCATE privileges, possibly through PUBLIC grants.',
      );
    }

    const migrationLedger = await client.query(
      "SELECT to_regclass('public.schema_migrations') AS table_name",
    );
    if (migrationLedger.rows[0].table_name) {
      await executeFormatted(
        client,
        "'REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM %I', $1::text",
        [runtimeRole],
      );
    }

    await client.query('COMMIT');

    const verification = await client.query(
      `
        SELECT
          rolname,
          rolsuper,
          rolcreaterole,
          rolcreatedb,
          rolreplication,
          rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname = $1
      `,
      [runtimeRole],
    );
    console.log('Runtime database role provisioned:', verification.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Runtime database role provisioning failed:', error.message);
  process.exitCode = 1;
});
