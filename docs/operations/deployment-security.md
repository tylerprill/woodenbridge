# Deployment and database security runbook

This runbook covers the controls that live outside the authentication code:
database identities, migrations, deployment gates, scheduled retention, and
security-event operations. Treat every database credential, authentication
secret, maintenance secret, Blob credential, and email-provider key as a
production credential.

## Database identities

Use two independent PostgreSQL roles and connection strings:

| Environment variable     | Role                                     | Connection | Where it belongs                      |
| ------------------------ | ---------------------------------------- | ---------- | ------------------------------------- |
| `DATABASE_URL`           | Least-privilege application runtime      | Pooled     | Vercel Runtime, Preview, local app    |
| `MIGRATION_DATABASE_URL` | Schema owner or dedicated migration role | Direct     | CI migration job and operator machine |

The runtime role may select, insert, update, and delete application data and
use application sequences. It must not own the schema and must not have
`SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, schema
`CREATE`, table `TRUNCATE`, `REFERENCES`, or `TRIGGER` privileges. Keep the
migration URL out of the deployed application's environment whenever the
deployment platform permits a separate migration job. The runtime role has no
access to the `schema_migrations` integrity ledger.

The provisioning script is intentionally operator-run; it never connects by
itself. Test it on a preview database first, take a current backup, and run it
as the role that owns the existing application objects. Always select a fresh,
dedicated runtime role; the script refuses to weaken the connected migration
role or reuse a role that owns objects or inherits another role:

```bash
export MIGRATION_DATABASE_URL='postgresql://migration-owner:...@direct-host/database?sslmode=require'
export FIELD_ATLAS_RUNTIME_DATABASE_PASSWORD='a-new-random-runtime-password'

psql "$MIGRATION_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=runtime_role=field_atlas_runtime \
  --file=scripts/provision-runtime-database-role.sql
```

Put the resulting pooled runtime connection in `DATABASE_URL`. Do not reuse the
migration password. Remove the temporary password shell variable after the
connection has been configured:

```bash
unset FIELD_ATLAS_RUNTIME_DATABASE_PASSWORD
```

Neon migration roles with delegated `CREATEROLE` are supported and do not need
PostgreSQL `SUPERUSER`. The provisioner avoids superuser-only role attribute
clauses, then verifies from `pg_catalog` before commit that the runtime identity
is not a superuser and has no `CREATEDB`, `CREATEROLE`, `REPLICATION`,
`BYPASSRLS`, ownership, or inherited-role relationship.

Verify from the runtime connection that normal reads work and DDL fails:

```bash
psql "$DATABASE_URL" --command='SELECT COUNT(*) FROM users;'
psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 --command='TRUNCATE TABLE users;'
```

The second command must fail with `permission denied`. If the runtime role can
create objects in `public`, inspect grants inherited through `PUBLIC` before
changing them. Revoking a grant from `PUBLIC` affects every database role and
must be reviewed separately.

## Migration lifecycle

`npm run migrate` accepts only a direct privileged connection, in this order:

1. `MIGRATION_DATABASE_URL`
2. `DATABASE_URL_UNPOOLED` (legacy local fallback)
3. `POSTGRES_URL_NON_POOLING` (legacy Vercel fallback)

The runner records each filename and SHA-256 checksum in `schema_migrations`.
Applied migrations are skipped. If an applied file changes, migration stops;
write a new numbered migration instead of rewriting history. A PostgreSQL
session advisory lock serializes concurrent migration runners so two deploys
cannot race between applying DDL and recording the checksum.

For the first ledger-enabled production run, create a backup and exercise the
same database snapshot in preview. Historical migrations are idempotent and
will be applied once so their checksums can be recorded. Deploy database
migrations before application code that requires the new schema.

The break-glass role command also requires the explicit direct operator
connection. It locks the account, revokes its sessions, invalidates privileged
recovery material on demotion, and writes a durable audit event:

```bash
MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
  npm run role:set -- person@example.com user
```

## GitHub deployment gates

The repository defines separate checks for formatting/lint, TypeScript, unit
and component tests, dependency audit, production build, and PostgreSQL
migration/database integration. Database integration uses PostgreSQL 16 with
PostGIS, applies the complete migration set twice, checks authentication
constraints, provisions a runtime role, and proves that role cannot truncate
tables. It then runs the production pending-registration, credential-login,
session, reset, and privileged-action functions through a test-only `pg`
transport against that runtime role. This covers real PostgreSQL transactions,
row locks, advisory locks, concurrent one-time consumption, and least-privilege
grants rather than replaying equivalent SQL in mocks.

The flow suite requires `AUTH_INTEGRATION_TESTS=1` and refuses every database
except a loopback `field_atlas_ci` database. Run it only after the migrations
and runtime-role provisioning steps shown in the workflow:

```bash
npm run test:integration:auth
```

In GitHub repository settings, protect `main` and require these checks before
merge:

- `Lint and formatting`
- `TypeScript`
- `Unit and component tests`
- `Dependency audit`
- `Production build`
- `PostgreSQL migrations and authorization`
- `Dependency review`
- `JavaScript and TypeScript analysis`

Also require pull requests, dismiss stale approvals after security-sensitive
changes, block force pushes and branch deletion, enable secret scanning and push
protection, and enable Dependabot security updates. Workflow action references
are pinned to immutable commits; Dependabot proposes controlled updates.

Vercel production should deploy only from protected `main`. Give preview
deployments a separate Neon branch/database and separate `AUTH_SECRET`,
`AUTH_HMAC_SECRET`, `MEDIA_GRANT_SECRET`, `CRON_SECRET`, Server Action key,
Resend key, and Blob store connection. Never connect an untrusted pull request
preview to production data or production credentials.

Secret scanning, push protection, Dependabot security updates, restricted
GitHub Actions publishers, and immutable action-SHA enforcement should remain
enabled. These controls supplement branch protection; they do not replace
required pull-request checks.

## Private Blob authentication

Production and preview deployments use Vercel's short-lived OIDC credential,
which Vercel injects as `VERCEL_OIDC_TOKEN`. Scope every Atlas operation to the
connected private store with `ATLAS_BLOB_STORE_ID`. Browser uploads use a
server-issued, path-scoped presigned URL; upload-completion callbacks are
verified with `ATLAS_BLOB_WEBHOOK_PUBLIC_KEY` before application state changes.

Do not copy `VERCEL_OIDC_TOKEN` into project settings or expose it to the
browser. Vercel rotates it automatically. `ATLAS_BLOB_READ_WRITE_TOKEN` is an
optional local or non-Vercel fallback only. If that fallback is used, it must
belong to the same store declared by `ATLAS_BLOB_STORE_ID`, and the webhook
public key is still required for completion callbacks.

## Scheduled security, media deletion, and upload retention

Vercel calls `GET /api/internal/auth-cleanup` daily according to `vercel.json`.
Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; the route rejects a
missing or incorrect secret, disables caching, and exposes no database error
details. Generate at least 32 random bytes for every environment:

```bash
openssl rand -base64 32
```

Security-change emails are first inserted into
`security_notification_outbox` in the same PostgreSQL transaction as the
password, passkey, recovery-code, or account-status mutation. An `after()`
callback drains bounded batches for low latency; the daily job drains up to four
additional batches as the durable safety net. Workers claim rows with expiring
leases and `SKIP LOCKED`, use stable Resend idempotency keys, and retry with
bounded backoff. Payloads are database-constrained to no-secret fields; never
add passwords, reset tokens, WebAuthn responses, or plaintext recovery codes.
Alert on the structured `security_notification.delivery_failure` warning and
on cleanup responses containing a non-zero `deadLettered` count (the route
returns 503 while any dead-letter row exists). The response also reports the
pending count and oldest pending timestamp; alert when the oldest row exceeds
your delivery objective.

Registered photograph deletion follows the same transactional-outbox pattern.
A database trigger inserts the immutable original/thumbnail pair into
`atlas_media_deletion_outbox` in the same PostgreSQL transaction that removes
the `atlas_media` association. Blob removal happens only after that transaction
commits. Newly queued work has a 15-minute first-attempt fence: the maximum
presigned PUT lifetime is 10 minutes, followed by five minutes of in-flight
grace. Retry attempts use their normal capped backoff rather than restarting
that upload fence. An `after()` callback accelerates eligible cleanup, while
the daily job reclaims expired leases and retries transient Blob failures
indefinitely. Invalid stored paths fail closed and remain dead-lettered for
operator review. Alert on `atlas_media.deletion_failure`, a non-zero media
deletion `deadLettered` count, or an oldest pending deletion beyond the storage
cleanup objective. Pending and dead-lettered objects continue to count against
the account storage quota until deletion succeeds.

The outbox deliberately accepts the raw path and byte metadata copied from a
registered legacy row, even when that payload violates today's upload policy.
This keeps malformed or oversized historical associations deletable. The
worker treats every queued payload as untrusted: it validates entry scoping,
the original/thumbnail pairing, and the recorded byte total before any Blob
request, then dead-letters an invalid payload without touching storage.

On Vercel Hobby, the checked-in daily cadence is the shortest supported cron
interval. For a tighter retry objective, use Vercel Pro or an authenticated
external scheduler to call this same route every 10 minutes; keep the daily job
as a backstop and alert if no invocation arrives for 36 hours.

The job removes expired authentication challenges, tokens, sessions,
attempt/rate-limit rows, privileged passkey-recovery grants, revoked
recovery-code sets, and security audit events older than 180 days. Expired or
used WebAuthn challenges and passkey reauthentication attempts are retained for
only a 24-hour diagnostic grace period. It also
claims expired photo-upload intents, removes their exact original/thumbnail
Blob pair, and only then releases the reserved file slot and storage quota. A
five-minute in-flight grace follows intent expiry before cleanup may claim the
pair. A failed Blob deletion or any live media row with a conflicting UUID or
path retains the reservation for a later retry rather than silently orphaning
billable data. Cleanup marks an intent consumed only when the registered media
identity, owner, entry, original path, and thumbnail path all match exactly.
Opportunistic cleanup inside authentication actions remains as a fallback.
Alert when the route returns non-2xx or when a scheduled invocation is missing
for more than 36 hours.

Cleanup stages settle independently. The media-deletion drain waits for the
upload-intent and import producers to settle, then runs even if either producer,
unrelated authentication retention, or notification delivery failed. A stage
failure still returns HTTP 500 and includes only stable task names in
`failedTasks`; it never exposes database or provider error details. HTTP 503 is
reserved for an otherwise successful run whose outbox health still reports
dead-lettered work.

## Security-event operations

Authentication and privileged-management events have a random event ID and are
written in two forms:

- structured JSON to the application log stream, suitable for a Vercel log
  drain;
- `auth_security_events` in PostgreSQL for a 180-day durable audit trail.

Alert on `*.rate_limited`, repeated `failure` outcomes,
`password.compromised_check_unavailable`, and
`security_event.persistence_failed`. The last event means the structured log
was emitted but the database audit copy failed. Do not add email addresses,
tokens, passwords, session cookies, IP addresses, or provider credentials to
event details.

## Owner recovery preparation

The owner has no password-only bypass for protected management. Before relying
on owner controls in production:

1. Enroll at least two passkeys on separate authenticators.
2. Download the one-time recovery-code set and keep it in an offline password
   manager or other encrypted backup separate from the primary authenticator.
3. Exercise one recovery code on a preview owner account and confirm it grants
   only replacement-passkey enrollment, not management access.
4. Record an operator-only break-glass procedure that requires verified human
   approval, a current database backup, and a durable incident record. Do not
   implement an unaudited password or email bypass in application code.

If the last passkey and every saved recovery code are lost, the account fails
closed. Restore access only through the documented operator procedure, then
rotate every server session, passkey, and recovery-code set.

## Release and recovery checklist

Before production release:

1. Run all required GitHub checks against the exact commit.
2. Back up the database and apply migrations with `MIGRATION_DATABASE_URL`.
3. Verify the runtime role can perform application CRUD and cannot perform DDL.
4. Verify production contains `APP_URL`, independent `AUTH_SECRET`,
   `AUTH_HMAC_SECRET`, and `MEDIA_GRANT_SECRET` values, `DATABASE_URL`,
   `CRON_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, exact WebAuthn
   RP/origin configuration, Resend configuration,
   `ATLAS_BLOB_STORE_ID`, `ATLAS_BLOB_WEBHOOK_PUBLIC_KEY`, and the connected
   Blob OIDC credential in the correct Vercel environment scope.
5. Exercise signup, verification, login, logout, password reset, session
   revocation, passkey enrollment/step-up, recovery-code replacement, one
   privileged action, and the cleanup endpoint in production.
6. Confirm the security event appears in both Vercel logs and
   `auth_security_events`.
7. Confirm the owner has two independent passkeys and an offline copy of the
   current recovery-code set.

If a release fails, roll application code back first. Prefer a forward database
migration over destructive rollback. Rotate any credential exposed in logs or a
deployment artifact, revoke active sessions when `AUTH_SECRET` or database
credentials may have been compromised, and retain the event IDs used during the
incident review. Rotating `AUTH_HMAC_SECRET` invalidates pending verification
material, rate-limit pseudonyms, and privileged recovery codes; rotating
`MEDIA_GRANT_SECRET` invalidates outstanding private-media grants.
