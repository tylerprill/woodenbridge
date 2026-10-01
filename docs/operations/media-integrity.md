# Atlas media integrity operations

The Atlas media integrity command compares registered `atlas_media` rows with
their exact private Blob objects. It does not list the store, inspect unrelated
objects, expose signed URLs, or print credentials. Its default mode is strictly
read-only: database work runs in a short read-only transaction and storage work
uses metadata `HEAD` requests only. The database snapshot uses `REPEATABLE READ`
so every keyset page belongs to one consistent audit view.

Run it from a trusted operator machine with the intended runtime database and
Atlas Blob store configuration:

```bash
npm run media:integrity
```

Production and preview must use different databases and Blob stores. The
command follows the application's credential scope while avoiding stale
locally pulled OIDC values:

- `ATLAS_BLOB_READ_WRITE_TOKEN` is preferred for a trusted operator run;
- `ATLAS_BLOB_STORE_ID` plus Vercel's short-lived `VERCEL_OIDC_TOKEN` is used
  when an explicit operator token is absent;
- when both a store ID and fallback token are present, their store identities
  must match.

Never place a Blob token in a command argument or commit it to the repository.
The report prints the connected database name and user, a SHA-256 fingerprint
of the configured database hostname and port, and the normalized Blob store
ID. These are identifiers, not credentials. The database URL, hostname, user
password, Blob token, and signed URLs are never printed.

## Bounded audits

The command reads records in UUID keyset pages and probes a maximum of four
records concurrently by default. Narrow a diagnostic run without using an
email address:

```bash
npm run media:integrity -- --media-id=<media-uuid>
npm run media:integrity -- --user-id=<user-uuid> --limit=100
npm run media:integrity -- --limit=250 --batch-size=50 --concurrency=2
```

Use `--json` for a machine-readable report. Storage paths are omitted unless
`--verbose` is explicitly supplied. An exact `--media-id` that does not exist
fails instead of returning a misleading empty success.

The classifications are:

- `healthy` — both registered objects exist and their known metadata agrees;
- `missing_thumbnail` — the original exists but the thumbnail reference or
  object is missing, so repair may be possible;
- `missing_original` — the original is missing; the command never attempts to
  recreate it from a lossy derivative;
- `both_missing` — neither usable object exists;
- `invalid_metadata` — registered paths, media IDs, pairing, or MIME metadata
  violate the Atlas storage policy;
- `metadata_mismatch` — Blob size or content type disagrees with a verified
  database value;
- `database_mismatch` — media is attached to a missing, differently owned, or
  deleted entry;
- `probe_error` — storage could not be authoritatively checked. Authentication,
  rate-limit, and network errors are never treated as missing objects.

Migration 018 used `2097152` bytes as an unknown legacy thumbnail-size
sentinel. When the object exists with a different size, the audit reports an
informational `legacy_thumbnail_size_unverified` note instead of a false
corruption finding.

Exit status is `0` for a healthy audit, `2` for confirmed integrity findings,
and `1` for a configuration, probe, repair, or concurrency failure.

## Regenerating missing thumbnails

Repair is intentionally difficult to invoke accidentally. First run and save a
read-only report, confirm the database and store shown by the report, and back
up the database. Then choose a small explicit limit:

```bash
npm run media:integrity -- \
  --repair-missing-thumbnails \
  --limit=25 \
  --confirm-database=<exact-database-name> \
  --confirm-database-user=<exact-database-user> \
  --confirm-database-endpoint=<exact-reported-sha256-fingerprint> \
  --confirm-store=<exact-normalized-store-id>
```

All four target confirmations and `--limit` are mandatory, and a repair batch
is capped at 100 records. Copy the values from the immediately preceding
read-only report; do not derive or type them from memory. Repair processes rows
one at a time. It first takes a path-scoped advisory lock and row lock,
revalidates the current paths and storage state, regenerates and verifies the
derivative, and commits the deterministic thumbnail path and exact byte size
before it attempts a new Blob upload. It then reacquires both locks and checks
the committed association before using a no-overwrite upload. A crash or
storage failure therefore leaves a registered missing thumbnail that the next
audit can retry; it cannot leave a new object whose path is absent from both the
media row and a later deletion job. A media deletion that wins the brief gap
between transactions sees the committed path, queues it for deletion, and
prevents the repair from uploading after the row disappears.

The command never overwrites an existing object. Before it adopts a
deterministic object left by an interrupted or concurrent repair, it
regenerates the expected derivative from the locked original and requires
byte-for-byte equality. If a no-overwrite upload reports a conflict, the
command probes and downloads the winner while the locks are held and applies
the same comparison. A different object at that path is neither overwritten
nor deleted. When this repair added a previously absent database reference, it
restores the earlier database state before reporting `object-mismatch`.

For a genuinely missing thumbnail, the command downloads only the registered
private original, applies its orientation, constrains it to 1024 pixels, and
encodes the registered JPEG or WebP derivative. Before the database association
or upload, Sharp verifies the output format, dimensions, byte limit, and
absence of EXIF, XMP, and IPTC metadata. The compare-and-set database update
uses the locked original/path state and records the exact generated byte size.
An `upload-failed` result means that association is already durable but its
object was still missing when the upload attempt ended; rerun a read-only audit
and then the same bounded repair.

The repair command never:

- deletes a registered or unregistered object;
- overwrites an existing thumbnail;
- recreates a missing original from a thumbnail;
- changes a Memory, Journey, owner, or public-sharing setting; or
- makes an original available to a public shared Journey.

Rerun the read-only audit after each repair batch. Investigate
`missing_original`, `both_missing`, invalid metadata, database mismatches, and
probe errors manually rather than broadening the repair command.

## Privacy and incident handling

Original photographs can retain EXIF location and camera metadata. Public
Journey delivery must continue to use only verified derivatives. Do not copy an
original into a thumbnail path, use an original as a public fallback, or place
private Blob URLs in tickets or logs.

When an authorized database association outlives both of its objects, the media
route returns a quiet bodyless response so each image surface can render its
polished local fallback with an accurate “photo unavailable” accessible name,
without generating a stale-image 404. Owner requests may try the private
original when only a thumbnail is missing. Public Journey requests never do;
they use only the derivative or a code-owned fallback with no user metadata.

If a probe fails, verify the database/store pairing and credential scope before
retrying. Repair commits the deterministic database association before a new
upload, so an interruption can leave either a registered missing object or a
registered object. A later locked repair retries the missing upload or adopts
the exact object safely. Do not manually delete it while another repair or
application write may be active.
