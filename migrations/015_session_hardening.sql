BEGIN;

DO $$
BEGIN
  CREATE TYPE account_status AS ENUM ('active', 'suspended', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status account_status NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authenticated_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  mfa_verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_session_hash_length CHECK (LENGTH(session_hash) = 64),
  CONSTRAINT auth_session_absolute_lifetime
    CHECK (absolute_expires_at > authenticated_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_active_user_idx
  ON auth_sessions (user_id, absolute_expires_at DESC)
  WHERE revoked_at IS NULL;

WITH ranked_tokens AS (
  SELECT
    token_hash,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, token_hash DESC
    ) AS active_rank
  FROM password_reset_tokens
  WHERE used_at IS NULL
)
UPDATE password_reset_tokens AS token
SET used_at = NOW()
FROM ranked_tokens
WHERE token.token_hash = ranked_tokens.token_hash
  AND ranked_tokens.active_rank > 1;

DROP INDEX IF EXISTS password_reset_tokens_active_user_idx;

CREATE UNIQUE INDEX password_reset_tokens_active_user_idx
  ON password_reset_tokens (user_id)
  WHERE used_at IS NULL;

COMMIT;
