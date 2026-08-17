BEGIN;

-- Composite rate-limit indexes lead with a subject hash and are ideal for
-- enforcement lookups. Scheduled retention deletes filter only by time, so
-- they need their own narrow indexes to avoid scanning each event table.
CREATE INDEX IF NOT EXISTS login_attempts_attempted_at_idx
  ON login_attempts (attempted_at);

CREATE INDEX IF NOT EXISTS account_creation_requests_requested_at_idx
  ON account_creation_requests (requested_at);

CREATE INDEX IF NOT EXISTS email_verification_requests_requested_at_idx
  ON email_verification_requests (requested_at);

CREATE INDEX IF NOT EXISTS email_verification_attempts_attempted_at_idx
  ON email_verification_attempts (attempted_at);

CREATE INDEX IF NOT EXISTS pending_registration_attempts_attempted_at_idx
  ON pending_registration_attempts (attempted_at);

CREATE INDEX IF NOT EXISTS password_reset_requests_requested_at_idx
  ON password_reset_requests (requested_at);

CREATE INDEX IF NOT EXISTS password_reset_attempts_attempted_at_idx
  ON password_reset_attempts (attempted_at);

CREATE INDEX IF NOT EXISTS passkey_reauth_attempts_attempted_at_idx
  ON passkey_reauth_attempts (attempted_at);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON password_reset_tokens (expires_at);

CREATE INDEX IF NOT EXISTS email_verification_challenges_expires_at_idx
  ON email_verification_challenges (expires_at);

CREATE INDEX IF NOT EXISTS auth_sessions_absolute_expires_at_idx
  ON auth_sessions (absolute_expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
