BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS webauthn_user_handle BYTEA;

DO $$
BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_webauthn_user_handle_length
      CHECK (
        webauthn_user_handle IS NULL
        OR OCTET_LENGTH(webauthn_user_handle) = 32
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_webauthn_user_handle_idx
  ON users (webauthn_user_handle)
  WHERE webauthn_user_handle IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0 CHECK (counter >= 0),
  device_type VARCHAR(32) NOT NULL,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  transports TEXT[] NOT NULL DEFAULT '{}',
  label VARCHAR(80) NOT NULL DEFAULT 'Passkey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT user_passkey_credential_id_length
    CHECK (LENGTH(credential_id) BETWEEN 1 AND 2048),
  CONSTRAINT user_passkey_public_key_length
    CHECK (OCTET_LENGTH(public_key) BETWEEN 1 AND 4096),
  CONSTRAINT user_passkey_device_type
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  CONSTRAINT user_passkey_transports_count
    CHECK (CARDINALITY(transports) <= 12),
  CONSTRAINT user_passkey_label_length
    CHECK (LENGTH(BTRIM(label)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS user_passkeys_user_created_idx
  ON user_passkeys (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash CHAR(64) NOT NULL REFERENCES auth_sessions(session_hash) ON DELETE CASCADE,
  challenge TEXT NOT NULL UNIQUE,
  purpose VARCHAR(24) NOT NULL CHECK (purpose IN ('registration', 'step_up')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webauthn_challenge_length
    CHECK (LENGTH(challenge) BETWEEN 32 AND 512),
  CONSTRAINT webauthn_challenge_expiry_order
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS webauthn_challenges_active_session_purpose_idx
  ON webauthn_challenges (session_hash, purpose)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS webauthn_challenges_session_purpose_idx
  ON webauthn_challenges (session_hash, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry_idx
  ON webauthn_challenges (expires_at);

CREATE TABLE IF NOT EXISTS passkey_reauth_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash CHAR(64) NOT NULL REFERENCES auth_sessions(session_hash) ON DELETE CASCADE,
  ip_hash CHAR(64) NOT NULL,
  successful BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT passkey_reauth_ip_hash_length CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS passkey_reauth_session_time_idx
  ON passkey_reauth_attempts (session_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS passkey_reauth_ip_time_idx
  ON passkey_reauth_attempts (ip_hash, attempted_at DESC);

COMMIT;
