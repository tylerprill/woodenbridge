# Photo journeys

Photo journeys turn a camera-roll selection into private Atlas memories and,
when two or more memories are selected, a private Chapter. The source of a
photo's location is embedded EXIF **GPS coordinates**. Upload IP addresses are
never used as location evidence.

## Product flow

1. **Choose photos** — select up to 50 JPEG, PNG, WebP, HEIC, or HEIF files.
2. **Review the journey** — inspect the detected local capture date, exact GPS
   confidence, and reverse-geocoded place for every photograph. Missing or
   uncertain locations must be corrected explicitly.
3. **Tell the stories** — give every memory a title and optional field note.
4. **Shape the Chapter** — choose private Chapter copy and a cover, or create
   memories without a Chapter.

The final action names its effect (for example, “Create 6 memories and 1
chapter”). Nothing becomes a visible Atlas memory before that confirmation.

## Metadata truth and privacy

- Metadata is read locally with a strict allowlist. Camera serials, maker
  notes, comments, and other unrelated EXIF are neither uploaded nor stored.
- The photo's local calendar date is preserved. It is not converted through
  the server timezone, which could move a late-night photograph to another
  day.
- Signed latitude and longitude are range-checked; `(0, 0)` is treated as
  unresolved rather than a valid trip location.
- Exact coordinates remain private account data. After the user selects the
  photographs, only coordinates—not photo bytes or raw EXIF—are sent to the
  configured reverse-geocoder to recognize each place.
- HEIC/HEIF files are decoded lazily and converted in the browser. The stored
  master JPEG and WebP thumbnail are canvas-transcoded derivatives without
  EXIF, XMP, or camera metadata. The raw HEIC is not stored.
- Shared Chapters continue to expose only metadata-stripped image derivatives;
  disabling a shared map removes coordinates from the public payload.

## Accuracy states

- `photo_gps`: exact coordinates were read from the selected photo.
- `manual`: the user supplied or corrected the coordinates.
- `missing`: no trustworthy coordinates are available; finalization is
  blocked until the item is corrected or removed.

Capture dates similarly retain `photo_metadata`, `file_date`, `manual`, or
`missing` provenance. A file modification date is a reviewable fallback, never
presented as embedded camera metadata. The explicit confirmation is carried in
the signed Server Action payload and enforced again by a database constraint;
a direct request cannot silently promote an unconfirmed file date.

Reverse geocoding does not invent cities. A remote coordinate may resolve to a
trail, park, lake, county, region, or country. For example, the validation
fixture near Mount Elbert is correctly described as `Black Cloud Trail,
Colorado`, not as a fabricated nearby municipality.

## Atomicity and recovery

An import is a durable, private batch. Batch creation is idempotent, assigns
immutable entry/media IDs, and creates hidden drafts. Each normalized master
and thumbnail then uses the existing private Vercel Blob upload-intent path,
ownership checks, per-memory limits, and account storage quota.

Each client request ID is bound to a SHA-256 fingerprint of its complete,
normalized payload. A lost-response retry with identical details reopens the
original batch; reusing that ID after changing a title, place, date,
confirmation, order, or Chapter cover is rejected rather than silently
returning stale drafts. Chapter intent and the selected cover's client item ID
are stored on the batch, so recovery never substitutes the first photograph.

Finalization locks the batch and verifies that every requested item:

- belongs to the authenticated user;
- has a valid title, location, place label, and truthful date provenance;
- has its expected registered media pair; and
- has not already been finalized elsewhere.

Only then does one database transaction publish all memories, optionally
create one private Chapter in chronological order, and mark the batch complete.
A retry returns the same result rather than creating duplicates. An upload or
finalization failure leaves the private batch recoverable and creates no
half-Chapter.

Cancellation first makes the batch ineligible for new upload tokens. Cleanup
then removes the exact private Blob pairs, media/upload-intent rows, and hidden
drafts. Failed Blob deletion retains the cleanup record for a later retry.

## Limits and operations

- 50 photographs per batch (matching the Chapter memory limit)
- 25 megapixels per decoded image. This includes current 24 MP camera-roll
  photographs while keeping client-side decode memory bounded on mobile.
- GPS timestamps are UTC and are never presented as the photographer's local
  calendar date. When local EXIF time is absent, the UI labels the file date
  as low-confidence and asks the traveler to confirm it.
- 3 open (`uploading` or `ready`) batches per account; cancellation immediately
  frees an open slot
- new imports pause when 20 cancelled batches are awaiting private-Blob cleanup;
  cancellation itself always remains available and may briefly exceed that
  retained-cleanup threshold
- 5,000 live Atlas entries per account
- one photo is prepared and registered at a time; its metadata-free master and
  thumbnail upload concurrently
- existing 512 MiB private-photo account quota remains authoritative

Client-side metadata parsing uses `exifr` (MIT). HEIC decoding uses the
CSP-compatible `heic-to` build (LGPL-3.0); retain its license notices and have
distribution obligations reviewed before a commercial release. The decoder is
loaded only when a selected file actually requires HEIC conversion.

The public OpenStreetMap Nominatim service permits at most one request per
second and discourages recurring bulk use. The importer coalesces nearby
coordinates and resolves them sequentially. A commercial or self-hosted
Nominatim-compatible endpoint should be configured before broad production
scale through `ATLAS_GEOCODER_ENDPOINT`, `ATLAS_GEOCODER_USER_AGENT`, and
`ATLAS_GEOCODER_MIN_INTERVAL_MS`. The interval defaults to the public
Nominatim-safe 1,000 ms and is enforced atomically across the application. A
token-fenced database lease also keeps the default provider single-flight for
the full upstream request, including slow responses and failures.

## Release checklist

1. Apply the additive import migration before exposing the route.
2. Confirm the least-privilege runtime role can use the new tables and
   sequences but cannot perform DDL.
3. Run metadata, action, concurrency, cleanup, UI, and responsive tests.
4. Smoke-test a real iPhone HEIC in the deployed browser under the production
   Content Security Policy.
5. Verify the resulting master/thumbnail contain no EXIF and that an anonymous
   or different account cannot read any import or media URL.
