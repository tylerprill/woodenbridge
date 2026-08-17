BEGIN;

CREATE TABLE IF NOT EXISTS auth_security_events (
  event_id UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category VARCHAR(32) NOT NULL DEFAULT 'authentication',
  event VARCHAR(96) NOT NULL,
  outcome VARCHAR(24) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT auth_security_events_category_length
    CHECK (LENGTH(category) BETWEEN 1 AND 32),
  CONSTRAINT auth_security_events_event_length
    CHECK (LENGTH(event) BETWEEN 1 AND 96),
  CONSTRAINT auth_security_events_outcome
    CHECK (outcome IN ('failure', 'limited', 'success', 'unavailable')),
  CONSTRAINT auth_security_events_details_object
    CHECK (JSONB_TYPEOF(details) = 'object'),
  CONSTRAINT auth_security_events_details_size
    CHECK (OCTET_LENGTH(details::TEXT) <= 4096)
);

CREATE INDEX IF NOT EXISTS auth_security_events_occurred_at_idx
  ON auth_security_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS auth_security_events_event_outcome_time_idx
  ON auth_security_events (event, outcome, occurred_at DESC);

CREATE INDEX IF NOT EXISTS auth_security_events_actor_time_idx
  ON auth_security_events (actor_user_id, occurred_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS auth_security_events_target_time_idx
  ON auth_security_events (target_user_id, occurred_at DESC)
  WHERE target_user_id IS NOT NULL;

COMMIT;
