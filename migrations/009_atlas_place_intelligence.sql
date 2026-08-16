ALTER TABLE atlas_entries
  ADD COLUMN IF NOT EXISTS place_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS place_locality VARCHAR(120),
  ADD COLUMN IF NOT EXISTS place_region VARCHAR(120),
  ADD COLUMN IF NOT EXISTS place_country VARCHAR(120),
  ADD COLUMN IF NOT EXISTS place_country_code CHAR(2),
  ADD COLUMN IF NOT EXISTS place_geocoder VARCHAR(32),
  ADD COLUMN IF NOT EXISTS place_geocoded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS atlas_entries_place_country_idx
  ON atlas_entries (user_id, place_country_code)
  WHERE deleted_at IS NULL;
