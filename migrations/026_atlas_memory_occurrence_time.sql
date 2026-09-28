BEGIN;

ALTER TABLE atlas_entries
  ADD COLUMN IF NOT EXISTS occurred_time TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS occurred_utc_offset_minutes SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'atlas_entries_occurrence_consistent'
      AND conrelid = 'atlas_entries'::regclass
  ) THEN
    ALTER TABLE atlas_entries
      ADD CONSTRAINT atlas_entries_occurrence_consistent CHECK (
        (occurred_time IS NULL OR visited_on IS NOT NULL)
        AND (
          occurred_utc_offset_minutes IS NULL
          OR occurred_time IS NOT NULL
        )
        AND (
          occurred_utc_offset_minutes IS NULL
          OR occurred_utc_offset_minutes BETWEEN -840 AND 840
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS atlas_entries_user_saved_occurrence_idx
  ON atlas_entries (
    user_id,
    visited_on DESC,
    occurred_time DESC,
    created_at DESC,
    id
  )
  WHERE record_state = 'saved' AND deleted_at IS NULL;

COMMIT;
