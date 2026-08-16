BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_verification_challenges (
  challenge_id CHAR(43) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_digest CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_verification_challenge_id_length
    CHECK (LENGTH(challenge_id) = 43),
  CONSTRAINT email_verification_code_digest_length
    CHECK (LENGTH(code_digest) = 64)
);

CREATE INDEX IF NOT EXISTS email_verification_challenges_user_idx
  ON email_verification_challenges (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_challenges_active_user_idx
  ON email_verification_challenges (user_id)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_requests (
  id BIGSERIAL PRIMARY KEY,
  email_hash CHAR(64) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_verification_request_email_hash_length
    CHECK (LENGTH(email_hash) = 64),
  CONSTRAINT email_verification_request_ip_hash_length
    CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS email_verification_requests_email_time_idx
  ON email_verification_requests (email_hash, requested_at DESC);

CREATE INDEX IF NOT EXISTS email_verification_requests_ip_time_idx
  ON email_verification_requests (ip_hash, requested_at DESC);

CREATE TABLE IF NOT EXISTS email_verification_attempts (
  id BIGSERIAL PRIMARY KEY,
  challenge_id CHAR(43) NOT NULL
    REFERENCES email_verification_challenges(challenge_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_hash CHAR(64) NOT NULL,
  successful BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_verification_attempt_ip_hash_length
    CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS email_verification_attempts_user_time_idx
  ON email_verification_attempts (user_id, attempted_at DESC)
  WHERE successful = FALSE;

CREATE INDEX IF NOT EXISTS email_verification_attempts_ip_time_idx
  ON email_verification_attempts (ip_hash, attempted_at DESC)
  WHERE successful = FALSE;

COMMIT;
