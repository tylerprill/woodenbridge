-- The existing Codex E2E account is a company-managed administrator, not an
-- owner. Role changes revoke all of its existing sessions.
UPDATE users
SET role = 'admin',
    session_version = session_version + 1
WHERE LOWER(email) = 'prill2ts+woodenbridge-e2e-codex@gmail.com'
  AND role = 'owner';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM users WHERE role = 'owner') > 1 THEN
    RAISE EXCEPTION 'Wooden Bridge cannot have more than one owner';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_immutable_single_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  existing_owner_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wooden_bridge_immutable_owner'));

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      RAISE EXCEPTION 'The Wooden Bridge owner account cannot be deleted';
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    RAISE EXCEPTION 'The Wooden Bridge owner role is immutable';
  END IF;

  IF NEW.role = 'owner'
     AND (TG_OP = 'INSERT' OR OLD.role <> 'owner') THEN
    SELECT COUNT(*) INTO existing_owner_count
    FROM users
    WHERE role = 'owner';

    IF existing_owner_count > 0 THEN
      RAISE EXCEPTION 'Wooden Bridge already has an owner';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_immutable_single_owner ON users;

CREATE TRIGGER users_immutable_single_owner
BEFORE INSERT OR UPDATE OF role OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_immutable_single_owner();
