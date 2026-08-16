-- Wooden Bridge application roles. Public account creation always relies on
-- the database default and cannot select an elevated role.
DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'owner');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS users_role_idx
  ON users (role);
