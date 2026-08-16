-- Add the operational administrator role between ordinary users and the
-- company owner. This must commit before the new enum value can be used.
ALTER TYPE user_role
  ADD VALUE IF NOT EXISTS 'admin' AFTER 'user';
