# Field Atlas

Field Atlas is a personal travel journal for mapping the places that matter,
preserving photographs and field notes, and keeping a thoughtful record of
every journey.

## Features

- Secure account creation, email verification, login, and password recovery.
- A private personal-atlas dashboard with saved-place and field-note previews.
- An interactive map for pinning visited places and future journeys.
- Structured place recognition with editable city, region, and country labels.
- Multi-photo memories, optimized thumbnails, and designed keepsake cards.
- My Chapters with ordered routes and revocable unlisted sharing links.
- Hierarchical user, administrator, and protected-owner access.
- Database-backed revocable sessions and phishing-resistant passkey step-up for
  owner and administrator actions.
- Single-use offline recovery codes that can only enroll a replacement passkey.
- Responsive, accessible interfaces across public and authenticated pages.
- Transactional account emails branded for Field Atlas.

## Installation

1. Clone the repository: `git clone https://github.com/tylerprill/woodenbridge.git`
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env.local` and configure the required services.
4. Apply the database migrations: `npm run migrate:auth`
5. Start the development server: `npm run dev`

## Authentication

The full signup, email verification, login, session, password recovery, and
logout design is documented in the
[authentication README](docs/auth/README.md), including Mermaid flow and state
diagrams, route behavior, security controls, and a manual test checklist.

Authentication migrations create pending-registration, verification,
password-reset, rate-limit, revocable-session, passkey, privileged-recovery,
account-status, and durable-audit storage. Apply them before starting the app:

```bash
npm run migrate:auth
```

Copy `.env.example` to an ignored local environment file and configure the
independent authentication/media secrets, the least-privilege runtime
`DATABASE_URL`, direct migration-only `MIGRATION_DATABASE_URL`, and exact
WebAuthn RP/origin. Production email delivery uses Resend and additionally
requires `RESEND_API_KEY` plus a verified `RESEND_FROM_EMAIL`. Local development
may use console delivery for verification codes and password-reset links.
Deployment, database-role, scheduled-cleanup, and CI controls are documented in the
[operations runbook](docs/operations/deployment-security.md).
The enforced per-request browser policy and its rendering tradeoffs are
documented in the
[Content Security Policy runbook](docs/operations/content-security-policy.md).

## Usage

1. Open the app in your web browser.
2. Create an account and verify your email address.
3. Sign in to open your personal atlas.
4. Drop a pin and explicitly save a title, place, date, field note, and photos.
5. Revisit keepsakes in My Places or arrange them into a shareable chapter.

## Browser UI audits

The default Playwright gate exercises portable public routes and does not
require a test login or seeded private records:

```bash
npm run test:e2e
```

Set `E2E_SHARED_CHAPTER_ID` to include the public shared-chapter viewport and
map interaction audits. Without it, those fixture-dependent checks are omitted
or explicitly skipped.

CI provisions a disposable `field_atlas_e2e` PostgreSQL database, seeds a
verified test user plus deterministic atlas records, and runs the authenticated
desktop and mobile audit automatically. The seed is fail-closed: it accepts only
that database name on a loopback host, requires an explicit opt-in, and never
falls back to the application's database URL.

To run the authenticated or full suite locally, seed an equivalently isolated
local database first. `E2E_TEST_PASSWORD` must contain 15–128 characters:

```bash
export E2E_MEDIA_STORAGE_ADAPTER=filesystem
export NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER=filesystem
export E2E_MEDIA_STORAGE_ROOT="$(node -p "require('node:path').join(require('node:os').tmpdir(), 'field-atlas-e2e-media-local')")"
export VERCEL=0
export VERCEL_ENV=

E2E_DATABASE_SEED=1 \
E2E_DATABASE_URL=postgresql://...@127.0.0.1:5432/field_atlas_e2e \
E2E_TEST_EMAIL=field-atlas-e2e@example.test \
E2E_TEST_PASSWORD=... \
npm run seed:e2e

DATABASE_URL=postgresql://...@127.0.0.1:5432/field_atlas_e2e \
E2E_DATABASE_ADAPTER=pg \
E2E_REQUIRE_FULL_IMPORT=1 \
POSTGRES_URL=postgresql://...@127.0.0.1:5432/field_atlas_e2e \
ATLAS_GEOCODER_ENDPOINT=http://127.0.0.1:3100/e2e-geocoder.json \
CRON_SECRET=local-e2e-cleanup-secret \
E2E_TEST_EMAIL=field-atlas-e2e@example.test \
E2E_TEST_PASSWORD=... \
NEXT_PUBLIC_ATLAS_STYLE_URL=http://127.0.0.1:3100/e2e-map-style.json \
npm run test:e2e:authenticated
```

Use the same environment with `npm run test:e2e:full` to include the public
suite. Set `E2E_SHARED_CHAPTER_ID` when that run should also audit a shared
chapter. The local style keeps the required authenticated gate independent of
third-party tile availability; production continues to use the configured map
provider. The authenticated suite also uses a filesystem media store confined
to the operating system's temporary directory. Its full-import canary sends
real image bytes through the upload API, verifies persistence and private media
delivery, recovers a committed upload whose browser response was lost, and
proves cancelled-import cleanup without touching Vercel Blob.

Set `E2E_BASE_URL` when auditing an already-running production build. If it is
unset, Playwright starts the built application on its configured local port.
The destructive full-import canary only runs against that Playwright-owned
loopback server with both guarded filesystem-adapter flags enabled; it always
skips external-server audits. CI sets `E2E_REQUIRE_FULL_IMPORT=1`, which turns a
missing isolation condition into a test failure instead of a silent skip.

## Contributing

Contributions are welcome! If you have any ideas for new features, bug fixes, or improvements, please submit a pull request. Make sure to follow the existing code style and include relevant tests.
