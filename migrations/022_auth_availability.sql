BEGIN;

-- A reservation begins before password verification and is completed after the
-- verifier returns. Keeping that distinction prevents one successful request
-- from deleting another request that is still doing expensive password work.
ALTER TABLE login_attempts
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_cleared_at TIMESTAMPTZ;

-- Rows created by earlier releases represented completed attempts.
UPDATE login_attempts
SET completed_at = attempted_at
WHERE completed_at IS NULL;

DO $$
BEGIN
  ALTER TABLE login_attempts
    ADD CONSTRAINT login_attempt_completion_order
      CHECK (completed_at IS NULL OR completed_at >= attempted_at);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE login_attempts
    ADD CONSTRAINT login_attempt_failure_clear_order
      CHECK (
        failure_cleared_at IS NULL
        OR (
          completed_at IS NOT NULL
          AND successful = FALSE
          AND failure_cleared_at >= completed_at
        )
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS login_attempts_email_failure_time_idx
  ON login_attempts (email_hash, attempted_at DESC)
  WHERE successful = FALSE AND failure_cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS login_attempts_ip_failure_time_idx
  ON login_attempts (ip_hash, attempted_at DESC)
  WHERE successful = FALSE AND failure_cleared_at IS NULL;

-- Unfiltered indexes support the additional account/IP ceilings that include
-- successful, failed, cleared, and in-flight attempts.
CREATE INDEX IF NOT EXISTS login_attempts_email_all_time_idx
  ON login_attempts (email_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS login_attempts_ip_all_time_idx
  ON login_attempts (ip_hash, attempted_at DESC);

DROP INDEX IF EXISTS login_attempts_email_time_idx;
DROP INDEX IF EXISTS login_attempts_ip_time_idx;

CREATE INDEX IF NOT EXISTS webauthn_challenges_used_at_idx
  ON webauthn_challenges (used_at)
  WHERE used_at IS NOT NULL;

COMMIT;
