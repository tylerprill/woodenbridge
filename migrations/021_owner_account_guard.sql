BEGIN;

-- The sole owner is an immutable recovery authority. Application policy
-- already prevents owner management; keep that invariant at the database
-- boundary so a future action cannot accidentally suspend or unverify it.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_owner_must_remain_active_verified;

ALTER TABLE users
  ADD CONSTRAINT users_owner_must_remain_active_verified
  CHECK (
    role <> 'owner'
    OR (
      account_status = 'active'
      AND email_verified_at IS NOT NULL
    )
  );

COMMIT;
