CREATE INDEX IF NOT EXISTS atlas_entries_user_state_updated_idx
  ON atlas_entries (user_id, record_state, journey_state, updated_at DESC)
  WHERE deleted_at IS NULL;
