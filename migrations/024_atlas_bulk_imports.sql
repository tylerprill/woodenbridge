BEGIN;

CREATE TABLE IF NOT EXISTS atlas_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id UUID NOT NULL,
  payload_fingerprint CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'uploading',
  version INTEGER NOT NULL DEFAULT 1,
  item_count SMALLINT NOT NULL,
  chapter_title VARCHAR(100) NOT NULL DEFAULT '',
  chapter_introduction VARCHAR(1200) NOT NULL DEFAULT '',
  cover_client_item_id UUID,
  cleanup_started_at TIMESTAMPTZ,
  cleanup_not_before TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_import_batches_owner_request_unique
    UNIQUE (user_id, client_request_id),
  CONSTRAINT atlas_import_batches_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT atlas_import_batches_payload_fingerprint_valid
    CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT atlas_import_batches_status_valid CHECK (
    status IN (
      'uploading',
      'ready',
      'completed',
      'cancel_pending',
      'cancelled'
    )
  ),
  CONSTRAINT atlas_import_batches_version_positive CHECK (version > 0),
  CONSTRAINT atlas_import_batches_item_count_valid
    CHECK (item_count BETWEEN 1 AND 50),
  CONSTRAINT atlas_import_batches_chapter_intent_consistent CHECK (
    (
      cover_client_item_id IS NULL
      AND chapter_title = ''
      AND chapter_introduction = ''
    )
    OR (
      cover_client_item_id IS NOT NULL
      AND item_count >= 2
      AND LENGTH(BTRIM(chapter_title)) > 0
    )
  ),
  CONSTRAINT atlas_import_batches_cleanup_attempts_valid
    CHECK (cleanup_attempts >= 0),
  CONSTRAINT atlas_import_batches_cleanup_fence_valid CHECK (
    (status = 'cancel_pending' AND cleanup_not_before IS NOT NULL)
    OR (status <> 'cancel_pending' AND cleanup_not_before IS NULL)
  ),
  CONSTRAINT atlas_import_batches_completion_consistent CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS atlas_import_batches_user_active_idx
  ON atlas_import_batches (user_id, updated_at DESC)
  WHERE status IN ('uploading', 'ready');

CREATE INDEX IF NOT EXISTS atlas_import_batches_cleanup_idx
  ON atlas_import_batches (
    cleanup_not_before,
    cleanup_started_at,
    updated_at
  )
  WHERE status = 'cancel_pending';

CREATE TABLE IF NOT EXISTS atlas_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  user_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  expected_media_id UUID NOT NULL,
  client_item_id UUID NOT NULL,
  position SMALLINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  source_name VARCHAR(255) NOT NULL,
  source_mime_type VARCHAR(64) NOT NULL,
  source_byte_size BIGINT NOT NULL,
  source_hash CHAR(64) NOT NULL,
  source_width INTEGER,
  source_height INTEGER,
  media_width INTEGER,
  media_height INTEGER,
  prepared_byte_size INTEGER,
  thumbnail_byte_size INTEGER,
  location_source VARCHAR(16) NOT NULL,
  date_source VARCHAR(16) NOT NULL,
  date_confirmed BOOLEAN NOT NULL,
  place_source VARCHAR(16) NOT NULL,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_import_items_batch_owner_fk
    FOREIGN KEY (batch_id, user_id)
    REFERENCES atlas_import_batches(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT atlas_import_items_entry_owner_fk
    FOREIGN KEY (entry_id, user_id)
    REFERENCES atlas_entries(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT atlas_import_items_batch_client_unique
    UNIQUE (batch_id, client_item_id),
  CONSTRAINT atlas_import_items_batch_position_unique
    UNIQUE (batch_id, position),
  CONSTRAINT atlas_import_items_entry_unique UNIQUE (entry_id),
  CONSTRAINT atlas_import_items_expected_media_unique
    UNIQUE (expected_media_id),
  CONSTRAINT atlas_import_items_position_valid
    CHECK (position BETWEEN 0 AND 49),
  CONSTRAINT atlas_import_items_status_valid
    CHECK (status IN ('pending', 'uploaded')),
  CONSTRAINT atlas_import_items_status_consistent CHECK (
    (status = 'uploaded' AND uploaded_at IS NOT NULL)
    OR (status = 'pending' AND uploaded_at IS NULL)
  ),
  CONSTRAINT atlas_import_items_source_mime_valid CHECK (
    source_mime_type IN (
      'image/heic',
      'image/heif',
      'image/jpeg',
      'image/png',
      'image/webp'
    )
  ),
  CONSTRAINT atlas_import_items_source_bytes_valid
    CHECK (source_byte_size BETWEEN 1 AND 26214400),
  CONSTRAINT atlas_import_items_hash_valid
    CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT atlas_import_items_preparation_consistent CHECK (
    (
      source_width IS NULL
      AND source_height IS NULL
      AND media_width IS NULL
      AND media_height IS NULL
      AND prepared_byte_size IS NULL
      AND thumbnail_byte_size IS NULL
    )
    OR (
      source_width IS NOT NULL
      AND source_height IS NOT NULL
      AND media_width IS NOT NULL
      AND media_height IS NOT NULL
      AND prepared_byte_size IS NOT NULL
      AND thumbnail_byte_size IS NOT NULL
    )
  ),
  CONSTRAINT atlas_import_items_source_dimensions_valid CHECK (
    source_width IS NULL
    OR (
      source_width > 0
      AND source_height > 0
      AND source_width <= 20000
      AND source_height <= 20000
      AND source_width::bigint * source_height::bigint <= 25000000
    )
  ),
  CONSTRAINT atlas_import_items_media_dimensions_valid CHECK (
    media_width IS NULL
    OR (
      media_width > 0
      AND media_height > 0
      AND media_width <= 2560
      AND media_height <= 2560
      AND media_width::bigint * media_height::bigint <= 25000000
    )
  ),
  CONSTRAINT atlas_import_items_prepared_bytes_valid
    CHECK (
      prepared_byte_size IS NULL
      OR prepared_byte_size BETWEEN 1 AND 10485760
    ),
  CONSTRAINT atlas_import_items_thumbnail_bytes_valid
    CHECK (
      thumbnail_byte_size IS NULL
      OR thumbnail_byte_size BETWEEN 1 AND 2097152
    ),
  CONSTRAINT atlas_import_items_location_source_valid
    CHECK (location_source IN ('photo_gps', 'manual')),
  CONSTRAINT atlas_import_items_date_source_valid
    CHECK (date_source IN ('photo_metadata', 'file_date', 'manual', 'missing')),
  CONSTRAINT atlas_import_items_file_date_confirmed CHECK (
    date_source <> 'file_date' OR date_confirmed
  ),
  CONSTRAINT atlas_import_items_place_source_valid
    CHECK (place_source IN ('geocoder', 'manual'))
);

CREATE INDEX IF NOT EXISTS atlas_import_items_batch_status_idx
  ON atlas_import_items (batch_id, status, position);

CREATE INDEX IF NOT EXISTS atlas_import_items_user_entry_idx
  ON atlas_import_items (user_id, entry_id);

CREATE TABLE IF NOT EXISTS atlas_import_geocode_cache (
  cache_key CHAR(64) PRIMARY KEY,
  status VARCHAR(12) NOT NULL,
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  place_name VARCHAR(120),
  locality VARCHAR(120),
  region VARCHAR(120),
  country VARCHAR(120),
  country_code CHAR(2),
  geocoder VARCHAR(32),
  geocoded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_import_geocode_cache_status_valid
    CHECK (status IN ('pending', 'ready')),
  CONSTRAINT atlas_import_geocode_cache_lease_consistent CHECK (
    (
      status = 'pending'
      AND lease_token IS NOT NULL
      AND leased_until IS NOT NULL
      AND place_name IS NULL
      AND geocoder IS NULL
      AND geocoded_at IS NULL
    )
    OR (
      status = 'ready'
      AND lease_token IS NULL
      AND leased_until IS NULL
      AND place_name IS NOT NULL
      AND geocoder IS NOT NULL
      AND geocoded_at IS NOT NULL
    )
  ),
  CONSTRAINT atlas_import_geocode_cache_country_code_valid CHECK (
    country_code IS NULL OR country_code ~ '^[A-Z]{2}$'
  )
);

CREATE INDEX IF NOT EXISTS atlas_import_geocode_cache_expiry_idx
  ON atlas_import_geocode_cache (expires_at);

CREATE TABLE IF NOT EXISTS atlas_import_geocode_usage (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count SMALLINT NOT NULL,
  last_request_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_import_geocode_usage_count_valid
    CHECK (request_count BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS atlas_import_geocode_global_usage (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT TO_TIMESTAMP(0),
  in_flight_token UUID,
  in_flight_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_import_geocode_global_usage_singleton
    CHECK (singleton_id = 1),
  CONSTRAINT atlas_import_geocode_global_usage_lease_consistent CHECK (
    (in_flight_token IS NULL AND in_flight_until IS NULL)
    OR (in_flight_token IS NOT NULL AND in_flight_until IS NOT NULL)
  )
);

INSERT INTO atlas_import_geocode_global_usage (singleton_id)
VALUES (1)
ON CONFLICT (singleton_id) DO NOTHING;

ALTER TABLE atlas_media
  ADD COLUMN IF NOT EXISTS source_hash CHAR(64);

ALTER TABLE atlas_media
  DROP CONSTRAINT IF EXISTS atlas_media_source_hash_valid;

ALTER TABLE atlas_media
  ADD CONSTRAINT atlas_media_source_hash_valid
  CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS atlas_media_user_source_hash_unique_idx
  ON atlas_media (user_id, source_hash)
  WHERE source_hash IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_media_entry_owner_fk'
  ) THEN
    ALTER TABLE atlas_media
      ADD CONSTRAINT atlas_media_entry_owner_fk
      FOREIGN KEY (entry_id, user_id)
      REFERENCES atlas_entries(id, user_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE atlas_media
  VALIDATE CONSTRAINT atlas_media_entry_owner_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_media_upload_intents_entry_owner_fk'
  ) THEN
    ALTER TABLE atlas_media_upload_intents
      ADD CONSTRAINT atlas_media_upload_intents_entry_owner_fk
      FOREIGN KEY (entry_id, user_id)
      REFERENCES atlas_entries(id, user_id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE atlas_media_upload_intents
  VALIDATE CONSTRAINT atlas_media_upload_intents_entry_owner_fk;

ALTER TABLE atlas_chapters
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_chapters_import_batch_fk'
  ) THEN
    ALTER TABLE atlas_chapters
      ADD CONSTRAINT atlas_chapters_import_batch_fk
      FOREIGN KEY (import_batch_id, user_id)
      REFERENCES atlas_import_batches(id, user_id)
      ON DELETE SET NULL (import_batch_id);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS atlas_chapters_import_batch_unique_idx
  ON atlas_chapters (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

COMMIT;
