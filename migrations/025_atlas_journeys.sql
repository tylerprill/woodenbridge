BEGIN;

ALTER TABLE atlas_chapters
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS client_request_fingerprint CHAR(64);

ALTER TABLE atlas_chapters
  ADD CONSTRAINT atlas_chapters_client_request_consistent
  CHECK (
    (client_request_id IS NULL AND client_request_fingerprint IS NULL)
    OR (
      client_request_id IS NOT NULL
      AND client_request_fingerprint ~ '^[0-9a-f]{64}$'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS atlas_chapters_user_client_request_unique_idx
  ON atlas_chapters (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS atlas_journey_suggestion_feedback (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggestion_key CHAR(64) NOT NULL,
  algorithm_version SMALLINT NOT NULL,
  source VARCHAR(24) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  chapter_id UUID,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, suggestion_key),
  CONSTRAINT atlas_journey_suggestion_feedback_key_valid
    CHECK (suggestion_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT atlas_journey_suggestion_feedback_version_positive
    CHECK (algorithm_version > 0),
  CONSTRAINT atlas_journey_suggestion_feedback_source_valid
    CHECK (source IN ('photo_import', 'atlas_history')),
  CONSTRAINT atlas_journey_suggestion_feedback_decision_valid
    CHECK (decision IN ('dismissed', 'accepted')),
  CONSTRAINT atlas_journey_suggestion_feedback_chapter_owner_fk
    FOREIGN KEY (chapter_id, user_id)
    REFERENCES atlas_chapters(id, user_id)
    ON DELETE SET NULL (chapter_id)
);

CREATE INDEX IF NOT EXISTS atlas_entries_user_saved_visited_idx
  ON atlas_entries (user_id, visited_on DESC, updated_at DESC)
  WHERE record_state = 'saved'
    AND deleted_at IS NULL
    AND visited_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS atlas_import_batches_user_completed_idx
  ON atlas_import_batches (user_id, completed_at DESC)
  WHERE status = 'completed' AND item_count >= 2;

COMMIT;
