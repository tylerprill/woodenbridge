\set ON_ERROR_STOP on

-- Run this file with a privileged, direct MIGRATION_DATABASE_URL. The password
-- is read from the environment so it is not exposed in the process arguments:
--
-- FIELD_ATLAS_RUNTIME_DATABASE_PASSWORD='...' psql "$MIGRATION_DATABASE_URL" \
--   --set=runtime_role=field_atlas_runtime \
--   --file=scripts/provision-runtime-database-role.sql

\if :{?runtime_role}
\else
  \echo 'Missing --set=runtime_role=<role_name>.'
  \quit 3
\endif

\getenv runtime_password FIELD_ATLAS_RUNTIME_DATABASE_PASSWORD

\if :{?runtime_password}
\else
  \echo 'Missing FIELD_ATLAS_RUNTIME_DATABASE_PASSWORD.'
  \quit 3
\endif

SELECT (:'runtime_role' = current_user) AS runtime_is_current_user \gset

\if :runtime_is_current_user
  \echo 'The runtime role must be different from the connected migration role.'
  \quit 4
\endif

SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_roles AS target
  WHERE target.rolname = :'runtime_role'
    AND (
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class
        WHERE relowner = target.oid
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace
        WHERE nspowner = target.oid
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database
        WHERE datdba = target.oid
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members
        WHERE member = target.oid
      )
    )
) AS runtime_has_elevated_relationship \gset

\if :runtime_has_elevated_relationship
  \echo 'The requested runtime role owns objects or inherits another role. Create a fresh runtime-only role.'
  \quit 4
\endif

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'runtime_role',
  :'runtime_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'runtime_role'
) \gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'runtime_role',
  :'runtime_password'
) \gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  current_database(),
  :'runtime_role'
) \gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_role') \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'runtime_role') \gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'runtime_role'
) \gexec
SELECT format(
  'REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM %I',
  :'runtime_role'
) \gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',
  to_regclass('public.schema_migrations'),
  :'runtime_role'
)
WHERE to_regclass('public.schema_migrations') IS NOT NULL \gexec
SELECT format(
  'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'runtime_role'
) \gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  current_user,
  :'runtime_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM %I',
  current_user,
  :'runtime_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
  current_user,
  :'runtime_role'
) \gexec

SELECT has_schema_privilege(:'runtime_role', 'public', 'CREATE')
  AS runtime_can_create_in_public \gset

\if :runtime_can_create_in_public
  \echo 'The runtime role still has effective CREATE through another grant (often PUBLIC). Review that grant explicitly.'
  \quit 4
\endif

SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_class AS relation
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND has_table_privilege(
      :'runtime_role',
      format('%I.%I', namespace.nspname, relation.relname),
      'TRUNCATE'
    )
) AS runtime_can_truncate_application_table \gset

\if :runtime_can_truncate_application_table
  \echo 'The runtime role still has effective TRUNCATE through another grant.'
  \quit 4
\endif

SELECT
  rolname,
  rolsuper,
  rolcreaterole,
  rolcreatedb,
  rolreplication,
  rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname = :'runtime_role';
