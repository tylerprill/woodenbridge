ALTER TABLE atlas_chapters
  ADD COLUMN IF NOT EXISTS cover_media_id UUID,
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS share_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS share_map BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS share_location_precision VARCHAR(16) NOT NULL DEFAULT 'approximate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_chapters_cover_media_fk'
  ) THEN
    ALTER TABLE atlas_chapters
      ADD CONSTRAINT atlas_chapters_cover_media_fk
      FOREIGN KEY (cover_media_id)
      REFERENCES atlas_media(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_chapters_visibility_check'
  ) THEN
    ALTER TABLE atlas_chapters
      ADD CONSTRAINT atlas_chapters_visibility_check
      CHECK (visibility IN ('private', 'shared'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atlas_chapters_share_location_precision_check'
  ) THEN
    ALTER TABLE atlas_chapters
      ADD CONSTRAINT atlas_chapters_share_location_precision_check
      CHECK (share_location_precision IN ('approximate', 'exact'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS atlas_chapters_share_id_unique_idx
  ON atlas_chapters (share_id);

ALTER TABLE atlas_chapter_entries
  ADD COLUMN IF NOT EXISTS transition_note VARCHAR(500) NOT NULL DEFAULT '';
