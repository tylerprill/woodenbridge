BEGIN;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS mfa_method VARCHAR(24);

UPDATE auth_sessions
SET mfa_method = 'passkey'
WHERE mfa_verified_at IS NOT NULL
  AND mfa_method IS NULL;

DO $$
BEGIN
  ALTER TABLE auth_sessions
    ADD CONSTRAINT auth_session_mfa_state
      CHECK (
        (mfa_verified_at IS NULL AND mfa_method IS NULL)
        OR (
          mfa_verified_at IS NOT NULL
          AND mfa_method = 'passkey'
        )
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS privileged_recovery_code_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT privileged_recovery_set_revocation_order
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS privileged_recovery_code_sets_active_user_idx
  ON privileged_recovery_code_sets (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS privileged_recovery_code_sets_user_created_idx
  ON privileged_recovery_code_sets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS privileged_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES privileged_recovery_code_sets(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL UNIQUE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  CONSTRAINT privileged_recovery_code_set_position_unique
    UNIQUE (set_id, position),
  CONSTRAINT privileged_recovery_code_hash_length
    CHECK (LENGTH(code_hash) = 64),
  CONSTRAINT privileged_recovery_code_use_order
    CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX IF NOT EXISTS privileged_recovery_codes_set_unused_idx
  ON privileged_recovery_codes (set_id, position)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS privileged_passkey_recovery_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash CHAR(64) NOT NULL REFERENCES auth_sessions(session_hash) ON DELETE CASCADE,
  recovery_code_id UUID NOT NULL REFERENCES privileged_recovery_codes(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privileged_passkey_recovery_grant_session_hash_length
    CHECK (LENGTH(session_hash) = 64),
  CONSTRAINT privileged_passkey_recovery_grant_expiry_order
    CHECK (expires_at > created_at),
  CONSTRAINT privileged_passkey_recovery_grant_consumption_order
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS privileged_passkey_recovery_grants_active_session_idx
  ON privileged_passkey_recovery_grants (session_hash)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS privileged_passkey_recovery_grants_user_expiry_idx
  ON privileged_passkey_recovery_grants (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS privileged_recovery_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash CHAR(64) NOT NULL REFERENCES auth_sessions(session_hash) ON DELETE CASCADE,
  ip_hash CHAR(64) NOT NULL,
  successful BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privileged_recovery_attempt_session_hash_length
    CHECK (LENGTH(session_hash) = 64),
  CONSTRAINT privileged_recovery_attempt_ip_hash_length
    CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS privileged_recovery_attempts_session_time_idx
  ON privileged_recovery_attempts (session_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS privileged_recovery_attempts_ip_time_idx
  ON privileged_recovery_attempts (ip_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS privileged_recovery_attempts_user_time_idx
  ON privileged_recovery_attempts (user_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS privileged_recovery_attempts_attempted_at_idx
  ON privileged_recovery_attempts (attempted_at);

COMMIT;
