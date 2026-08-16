BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
  CREATE TYPE atlas_record_state AS ENUM ('draft', 'saved', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE atlas_journey_state AS ENUM ('visited', 'want_to_visit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS atlas_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id UUID NOT NULL,
  title VARCHAR(80) NOT NULL DEFAULT '',
  description VARCHAR(1200) NOT NULL DEFAULT '',
  place_label VARCHAR(120),
  visited_on DATE,
  record_state atlas_record_state NOT NULL DEFAULT 'draft',
  journey_state atlas_journey_state NOT NULL DEFAULT 'visited',
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT atlas_entries_version_positive CHECK (version > 0),
  CONSTRAINT atlas_entries_latitude_valid
    CHECK (ST_Y(location::geometry) BETWEEN -90 AND 90),
  CONSTRAINT atlas_entries_longitude_valid
    CHECK (ST_X(location::geometry) BETWEEN -180 AND 180),
  CONSTRAINT atlas_entries_saved_title_required
    CHECK (record_state <> 'saved' OR LENGTH(BTRIM(title)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS atlas_entries_user_request_unique
  ON atlas_entries (user_id, client_request_id);

CREATE INDEX IF NOT EXISTS atlas_entries_user_updated_idx
  ON atlas_entries (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS atlas_entries_location_gist_idx
  ON atlas_entries USING GIST (location)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS atlas_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL DEFAULT 22,
  longitude DOUBLE PRECISION NOT NULL DEFAULT -18,
  zoom DOUBLE PRECISION NOT NULL DEFAULT 1.65,
  bearing DOUBLE PRECISION NOT NULL DEFAULT 0,
  pitch DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_preferences_latitude_valid CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT atlas_preferences_longitude_valid CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT atlas_preferences_zoom_valid CHECK (zoom BETWEEN 0 AND 20),
  CONSTRAINT atlas_preferences_bearing_valid CHECK (bearing BETWEEN -360 AND 360),
  CONSTRAINT atlas_preferences_pitch_valid CHECK (pitch BETWEEN 0 AND 70)
);

CREATE TABLE IF NOT EXISTS atlas_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES atlas_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  mime_type VARCHAR(64) NOT NULL,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER NOT NULL,
  alt_text VARCHAR(180),
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_media_dimensions_positive
    CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)),
  CONSTRAINT atlas_media_byte_size_positive CHECK (byte_size > 0)
);

CREATE INDEX IF NOT EXISTS atlas_media_entry_order_idx
  ON atlas_media (entry_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS atlas_media_user_idx
  ON atlas_media (user_id, created_at DESC);

COMMIT;
