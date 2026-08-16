BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email_hash CHAR(64) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  successful BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT login_attempt_email_hash_length CHECK (LENGTH(email_hash) = 64),
  CONSTRAINT login_attempt_ip_hash_length CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS login_attempts_email_time_idx
  ON login_attempts (email_hash, attempted_at DESC)
  WHERE successful = FALSE;

CREATE INDEX IF NOT EXISTS login_attempts_ip_time_idx
  ON login_attempts (ip_hash, attempted_at DESC)
  WHERE successful = FALSE;

CREATE TABLE IF NOT EXISTS account_creation_requests (
  id BIGSERIAL PRIMARY KEY,
  email_hash CHAR(64) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_creation_request_email_hash_length
    CHECK (LENGTH(email_hash) = 64),
  CONSTRAINT account_creation_request_ip_hash_length
    CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS account_creation_requests_email_time_idx
  ON account_creation_requests (email_hash, requested_at DESC);

CREATE INDEX IF NOT EXISTS account_creation_requests_ip_time_idx
  ON account_creation_requests (ip_hash, requested_at DESC);

COMMIT;
