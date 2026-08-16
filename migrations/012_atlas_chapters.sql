CREATE TABLE IF NOT EXISTS atlas_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(100) NOT NULL,
  introduction VARCHAR(1200) NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS atlas_chapters_user_updated_idx
  ON atlas_chapters (user_id, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'atlas_chapters_id_user_unique'
  ) THEN
    ALTER TABLE atlas_chapters
      ADD CONSTRAINT atlas_chapters_id_user_unique UNIQUE (id, user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'atlas_entries_id_user_unique'
  ) THEN
    ALTER TABLE atlas_entries
      ADD CONSTRAINT atlas_entries_id_user_unique UNIQUE (id, user_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS atlas_chapter_entries (
  chapter_id UUID NOT NULL REFERENCES atlas_chapters(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES atlas_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chapter_id, entry_id),
  UNIQUE (chapter_id, position)
);

CREATE INDEX IF NOT EXISTS atlas_chapter_entries_entry_idx
  ON atlas_chapter_entries (entry_id);

ALTER TABLE atlas_chapter_entries
  ADD COLUMN IF NOT EXISTS user_id UUID;

UPDATE atlas_chapter_entries AS chapter_entry
SET user_id = chapter.user_id
FROM atlas_chapters AS chapter
WHERE chapter.id = chapter_entry.chapter_id
  AND chapter_entry.user_id IS NULL;

ALTER TABLE atlas_chapter_entries
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'atlas_chapter_entries_chapter_owner_fk'
  ) THEN
    ALTER TABLE atlas_chapter_entries
      ADD CONSTRAINT atlas_chapter_entries_chapter_owner_fk
      FOREIGN KEY (chapter_id, user_id)
      REFERENCES atlas_chapters(id, user_id)
      ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'atlas_chapter_entries_entry_owner_fk'
  ) THEN
    ALTER TABLE atlas_chapter_entries
      ADD CONSTRAINT atlas_chapter_entries_entry_owner_fk
      FOREIGN KEY (entry_id, user_id)
      REFERENCES atlas_entries(id, user_id)
      ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS atlas_chapter_entries_user_idx
  ON atlas_chapter_entries (user_id);
