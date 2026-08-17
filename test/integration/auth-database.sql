\set ON_ERROR_STOP on

DO $$
DECLARE
  required_table TEXT;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'account_creation_requests',
    'atlas_media_upload_intents',
    'auth_security_events',
    'auth_sessions',
    'email_verification_challenges',
    'login_attempts',
    'passkey_reauth_attempts',
    'password_reset_tokens',
    'pending_registrations',
    'privileged_passkey_recovery_grants',
    'privileged_recovery_attempts',
    'privileged_recovery_code_sets',
    'privileged_recovery_codes',
    'user_passkeys',
    'users',
    'webauthn_challenges'
  ]
  LOOP
    IF to_regclass(format('public.%I', required_table)) IS NULL THEN
      RAISE EXCEPTION 'Required table % is missing', required_table;
    END IF;
  END LOOP;
END
$$;

BEGIN;

INSERT INTO users (first_name, last_name, email, password)
VALUES ('Case', 'Test', 'case-test@example.com', '$argon2id$integration-test');

DO $$
BEGIN
  BEGIN
    INSERT INTO users (first_name, last_name, email, password)
    VALUES ('Duplicate', 'Case', 'CASE-TEST@example.com', '$argon2id$integration-test');
    RAISE EXCEPTION 'Case-insensitive user identity constraint did not fire'
      USING ERRCODE = 'check_violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END
$$;

UPDATE users
SET
  email_verified_at = NOW(),
  role = 'owner'
WHERE email = 'case-test@example.com';

DO $$
BEGIN
  BEGIN
    INSERT INTO users (
      first_name,
      last_name,
      email,
      password,
      role,
      email_verified_at
    )
    VALUES (
      'Second',
      'Owner',
      'second-owner@example.com',
      '$argon2id$integration-test',
      'owner',
      NOW()
    );
    RAISE EXCEPTION 'Single-owner constraint did not fire'
      USING ERRCODE = 'check_violation';
  EXCEPTION
    WHEN raise_exception THEN NULL;
  END;
END
$$;

INSERT INTO auth_security_events (
  event_id,
  event,
  outcome,
  actor_user_id,
  details
)
SELECT
  'c5aee1bd-b872-4a95-9afd-23d3d040289d',
  'integration.authorization',
  'success',
  id,
  '{"source":"database-integration"}'::jsonb
FROM users
WHERE email = 'case-test@example.com';

DO $$
BEGIN
  BEGIN
    INSERT INTO auth_security_events (event_id, event, outcome)
    VALUES (
      '7db2361e-3f64-4cf3-97eb-b4a2ef364bea',
      'integration.invalid-outcome',
      'not-an-outcome'
    );
    RAISE EXCEPTION 'Security-event outcome constraint did not fire'
      USING ERRCODE = 'unique_violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$$;

INSERT INTO atlas_entries (
  id,
  user_id,
  client_request_id,
  title,
  record_state,
  location
)
SELECT
  '9209cbdf-c40f-46d4-b8ed-71165fb3ade5',
  id,
  'c96f0ef2-b815-4bc8-b125-631a6abb8d89',
  'Upload intent integration memory',
  'saved',
  ST_SetSRID(ST_MakePoint(-83.05, 43.42), 4326)::geography
FROM users
WHERE email = 'case-test@example.com';

INSERT INTO atlas_media_upload_intents (
  media_id,
  user_id,
  entry_id,
  original_path,
  thumbnail_path,
  reserved_bytes,
  expires_at
)
SELECT
  'a578c4e5-2207-45d5-9ca3-2b4932b76270',
  id,
  '9209cbdf-c40f-46d4-b8ed-71165fb3ade5',
  'atlas/memories/9209cbdf-c40f-46d4-b8ed-71165fb3ade5/a578c4e5-2207-45d5-9ca3-2b4932b76270.jpg',
  'atlas/memories/9209cbdf-c40f-46d4-b8ed-71165fb3ade5/a578c4e5-2207-45d5-9ca3-2b4932b76270.thumbnail.webp',
  12582912,
  NOW() + INTERVAL '30 minutes'
FROM users
WHERE email = 'case-test@example.com';

DO $$
BEGIN
  BEGIN
    DELETE FROM atlas_entries
    WHERE id = '9209cbdf-c40f-46d4-b8ed-71165fb3ade5';
    RAISE EXCEPTION 'Upload intent did not prevent an orphaning hard delete'
      USING ERRCODE = 'check_violation';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END
$$;

INSERT INTO atlas_chapters (
  id,
  user_id,
  title,
  share_map,
  share_location_precision
)
SELECT
  '620fe04d-2383-4530-8b8b-d8e55be0344e',
  id,
  'Private map integration chapter',
  FALSE,
  'approximate'
FROM users
WHERE email = 'case-test@example.com';

DO $$
BEGIN
  BEGIN
    UPDATE atlas_chapters
    SET share_location_precision = 'exact'
    WHERE id = '620fe04d-2383-4530-8b8b-d8e55be0344e';
    RAISE EXCEPTION 'Disabled chapter map retained exact precision'
      USING ERRCODE = 'unique_violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$$;

ROLLBACK;
