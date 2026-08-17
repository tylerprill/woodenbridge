BEGIN;

-- A disabled shared map cannot retain an effective exact-location setting.
UPDATE atlas_chapters
SET share_location_precision = 'approximate'
WHERE share_map = FALSE
  AND share_location_precision <> 'approximate';

ALTER TABLE atlas_chapters
  DROP CONSTRAINT IF EXISTS atlas_chapters_map_precision_consistent;

ALTER TABLE atlas_chapters
  ADD CONSTRAINT atlas_chapters_map_precision_consistent
  CHECK (share_map OR share_location_precision = 'approximate');

-- Existing thumbnail sizes were not recorded. Count them conservatively at the
-- current maximum until a future backfill can replace the estimate.
ALTER TABLE atlas_media
  ADD COLUMN IF NOT EXISTS thumbnail_byte_size INTEGER;

UPDATE atlas_media
SET thumbnail_byte_size = 2097152
WHERE thumbnail_byte_size IS NULL;

ALTER TABLE atlas_media
  ALTER COLUMN thumbnail_byte_size SET DEFAULT 2097152,
  ALTER COLUMN thumbnail_byte_size SET NOT NULL;

ALTER TABLE atlas_media
  DROP CONSTRAINT IF EXISTS atlas_media_thumbnail_byte_size_valid;

ALTER TABLE atlas_media
  ADD CONSTRAINT atlas_media_thumbnail_byte_size_valid
  CHECK (thumbnail_byte_size BETWEEN 1 AND 2097152);

-- Each media UUID reserves exactly one immutable original/thumbnail pathname
-- pair. Unconsumed rows continue to count against entry and account quotas even
-- after expiry; only successful Blob deletion releases the reservation.
CREATE TABLE IF NOT EXISTS atlas_media_upload_intents (
  media_id UUID PRIMARY KEY,
  -- Intent rows must survive until their Blob pair is deleted. Restrict hard
  -- deletes so a cascade cannot erase the only cleanup record and orphan data.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL REFERENCES atlas_entries(id) ON DELETE RESTRICT,
  original_path TEXT NOT NULL UNIQUE,
  thumbnail_path TEXT NOT NULL UNIQUE,
  reserved_bytes BIGINT NOT NULL,
  original_authorized_at TIMESTAMPTZ,
  thumbnail_authorized_at TIMESTAMPTZ,
  original_uploaded_at TIMESTAMPTZ,
  thumbnail_uploaded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  cleanup_started_at TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_media_upload_intent_owner_key
    UNIQUE (user_id, entry_id, media_id),
  CONSTRAINT atlas_media_upload_intent_distinct_paths
    CHECK (original_path <> thumbnail_path),
  CONSTRAINT atlas_media_upload_intent_reserved_bytes
    CHECK (reserved_bytes BETWEEN 1 AND 12582912),
  CONSTRAINT atlas_media_upload_intent_expiry_order
    CHECK (expires_at > created_at),
  CONSTRAINT atlas_media_upload_intent_cleanup_attempts
    CHECK (cleanup_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS atlas_media_upload_intents_entry_active_idx
  ON atlas_media_upload_intents (entry_id, created_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS atlas_media_upload_intents_user_active_idx
  ON atlas_media_upload_intents (user_id, created_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS atlas_media_upload_intents_cleanup_idx
  ON atlas_media_upload_intents (expires_at, cleanup_started_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS atlas_media_upload_intents_consumed_idx
  ON atlas_media_upload_intents (consumed_at)
  WHERE consumed_at IS NOT NULL;

COMMIT;
