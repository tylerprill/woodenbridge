BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT password_reset_token_hash_length CHECK (LENGTH(token_hash) = 64)
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_active_user_idx
  ON password_reset_tokens (user_id, expires_at DESC)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id BIGSERIAL PRIMARY KEY,
  email_hash CHAR(64) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT password_reset_request_email_hash_length CHECK (LENGTH(email_hash) = 64),
  CONSTRAINT password_reset_request_ip_hash_length CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS password_reset_requests_email_time_idx
  ON password_reset_requests (email_hash, requested_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_requests_ip_time_idx
  ON password_reset_requests (ip_hash, requested_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_attempts (
  id BIGSERIAL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT password_reset_attempt_token_hash_length CHECK (LENGTH(token_hash) = 64),
  CONSTRAINT password_reset_attempt_ip_hash_length CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS password_reset_attempts_token_time_idx
  ON password_reset_attempts (token_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_attempts_ip_time_idx
  ON password_reset_attempts (ip_hash, attempted_at DESC);

COMMIT;
