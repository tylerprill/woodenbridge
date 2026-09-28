BEGIN;

CREATE TABLE IF NOT EXISTS atlas_chapter_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title VARCHAR(100) NOT NULL,
  position SMALLINT NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_chapter_segments_title_present
    CHECK (BTRIM(title) <> ''),
  CONSTRAINT atlas_chapter_segments_chapter_owner_fk
    FOREIGN KEY (chapter_id, user_id)
    REFERENCES atlas_chapters(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT atlas_chapter_segments_id_chapter_owner_unique
    UNIQUE (id, chapter_id, user_id),
  CONSTRAINT atlas_chapter_segments_chapter_position_unique
    UNIQUE (chapter_id, position)
);

CREATE INDEX IF NOT EXISTS atlas_chapter_segments_user_chapter_idx
  ON atlas_chapter_segments (user_id, chapter_id, position);

ALTER TABLE atlas_chapter_entries
  ADD COLUMN IF NOT EXISTS segment_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'atlas_chapter_entries_segment_owner_fk'
      AND conrelid = 'atlas_chapter_entries'::regclass
  ) THEN
    ALTER TABLE atlas_chapter_entries
      ADD CONSTRAINT atlas_chapter_entries_segment_owner_fk
      FOREIGN KEY (segment_id, chapter_id, user_id)
      REFERENCES atlas_chapter_segments(id, chapter_id, user_id)
      ON DELETE SET NULL (segment_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS atlas_chapter_entries_segment_position_idx
  ON atlas_chapter_entries (chapter_id, segment_id, position);

COMMIT;
