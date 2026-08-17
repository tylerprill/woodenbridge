BEGIN;

-- Account credentials remain outside `users` until the inbox owner proves the
-- browser-bound registration challenge. This prevents an unverified row from
-- preserving the password chosen by whoever registered an address first.
CREATE TABLE IF NOT EXISTS pending_registrations (
  challenge_id CHAR(43) PRIMARY KEY,
  email TEXT NOT NULL,
  email_hash CHAR(64) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  password_hash TEXT NOT NULL,
  code_digest CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_registration_challenge_id_length
    CHECK (LENGTH(challenge_id) = 43),
  CONSTRAINT pending_registration_email_normalized
    CHECK (email = LOWER(BTRIM(email))),
  CONSTRAINT pending_registration_email_length
    CHECK (LENGTH(email) BETWEEN 3 AND 254),
  CONSTRAINT pending_registration_email_hash_length
    CHECK (LENGTH(email_hash) = 64),
  CONSTRAINT pending_registration_password_argon2id
    CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT pending_registration_code_digest_length
    CHECK (LENGTH(code_digest) = 64),
  CONSTRAINT pending_registration_expiry_order
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_active_email_idx
  ON pending_registrations (email)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS pending_registrations_expiry_idx
  ON pending_registrations (expires_at);

CREATE TABLE IF NOT EXISTS pending_registration_attempts (
  id BIGSERIAL PRIMARY KEY,
  challenge_id CHAR(43) NOT NULL
    REFERENCES pending_registrations(challenge_id) ON DELETE CASCADE,
  email_hash CHAR(64) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  successful BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_registration_attempt_email_hash_length
    CHECK (LENGTH(email_hash) = 64),
  CONSTRAINT pending_registration_attempt_ip_hash_length
    CHECK (LENGTH(ip_hash) = 64)
);

CREATE INDEX IF NOT EXISTS pending_registration_attempts_email_time_idx
  ON pending_registration_attempts (email_hash, attempted_at DESC)
  WHERE successful = FALSE;

CREATE INDEX IF NOT EXISTS pending_registration_attempts_ip_time_idx
  ON pending_registration_attempts (ip_hash, attempted_at DESC)
  WHERE successful = FALSE;

-- Legacy unverified rows may contain a password selected before ownership of
-- the inbox was established. Make those credentials unusable, revoke any JWTs
-- minted from them, and require the address owner to repeat signup. A verified
-- pending registration later replaces the password/profile atomically while
-- preserving the row id, role, and any legitimate foreign-key relationships.
UPDATE email_verification_challenges AS challenge
SET used_at = COALESCE(challenge.used_at, NOW())
FROM users
WHERE challenge.user_id = users.id
  AND users.email_verified_at IS NULL
  AND challenge.used_at IS NULL;

UPDATE password_reset_tokens AS token
SET used_at = COALESCE(token.used_at, NOW())
FROM users
WHERE token.user_id = users.id
  AND users.email_verified_at IS NULL
  AND token.used_at IS NULL;

UPDATE users
SET password = '!pending-registration-required!',
    session_version = session_version + 1
WHERE email_verified_at IS NULL
  AND password <> '!pending-registration-required!';

COMMIT;
