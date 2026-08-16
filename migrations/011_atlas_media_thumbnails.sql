CREATE UNIQUE INDEX IF NOT EXISTS atlas_media_thumbnail_path_unique_idx
  ON atlas_media (thumbnail_path)
  WHERE thumbnail_path IS NOT NULL;
