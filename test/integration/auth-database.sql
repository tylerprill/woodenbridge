\set ON_ERROR_STOP on

DO $$
DECLARE
  required_table TEXT;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'account_creation_requests',
    'atlas_import_batches',
    'atlas_import_geocode_cache',
    'atlas_import_geocode_global_usage',
    'atlas_import_geocode_usage',
    'atlas_import_items',
    'atlas_media_deletion_outbox',
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

INSERT INTO atlas_entries (
  id,
  user_id,
  client_request_id,
  title,
  record_state,
  location
)
SELECT
  'ca997a18-b01e-4437-a9be-ecb3768627e8',
  id,
  'e22f31d3-d13c-4cb2-989b-c0c53f45f232',
  'Deletion outbox integration memory',
  'saved',
  ST_SetSRID(ST_MakePoint(-83.05, 43.42), 4326)::geography
FROM users
WHERE email = 'case-test@example.com';

INSERT INTO atlas_media (
  id,
  entry_id,
  user_id,
  storage_path,
  thumbnail_path,
  mime_type,
  width,
  height,
  byte_size,
  thumbnail_byte_size
)
SELECT
  '799e38e0-f147-43a8-ae12-c18195fe4750',
  'ca997a18-b01e-4437-a9be-ecb3768627e8',
  id,
  'atlas/memories/ca997a18-b01e-4437-a9be-ecb3768627e8/799e38e0-f147-43a8-ae12-c18195fe4750.jpg',
  'atlas/memories/ca997a18-b01e-4437-a9be-ecb3768627e8/799e38e0-f147-43a8-ae12-c18195fe4750.thumbnail.webp',
  'image/jpeg',
  1200,
  800,
  1024,
  256
FROM users
WHERE email = 'case-test@example.com';

DELETE FROM atlas_media
WHERE id = '799e38e0-f147-43a8-ae12-c18195fe4750';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM atlas_media_deletion_outbox
    WHERE media_id = '799e38e0-f147-43a8-ae12-c18195fe4750'
      AND entry_id = 'ca997a18-b01e-4437-a9be-ecb3768627e8'
      AND original_path =
        'atlas/memories/ca997a18-b01e-4437-a9be-ecb3768627e8/799e38e0-f147-43a8-ae12-c18195fe4750.jpg'
      AND thumbnail_path =
        'atlas/memories/ca997a18-b01e-4437-a9be-ecb3768627e8/799e38e0-f147-43a8-ae12-c18195fe4750.thumbnail.webp'
      AND reserved_bytes = 1280
      AND available_at >= created_at + INTERVAL '15 minutes'
      AND completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Atlas media delete did not enqueue its exact Blob pair';
  END IF;
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
  '28ec2bad-ad24-4e1f-b033-093dc88ca71a',
  id,
  '9ed3a620-e3e3-485f-8197-e2777ab83572',
  'Legacy object identity integration memory',
  'saved',
  ST_SetSRID(ST_MakePoint(-83.02, 43.39), 4326)::geography
FROM users
WHERE email = 'case-test@example.com';

-- A legacy association UUID can differ from the UUID embedded in its paired,
-- entry-scoped object paths. The durable queue must preserve and delete that
-- exact object pair without making the association undeletable.
INSERT INTO atlas_media (
  id,
  entry_id,
  user_id,
  storage_path,
  thumbnail_path,
  mime_type,
  width,
  height,
  byte_size,
  thumbnail_byte_size
)
SELECT
  'dc344f71-1237-452a-bf5c-0f2f0886861a',
  '28ec2bad-ad24-4e1f-b033-093dc88ca71a',
  id,
  'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/5a5f5722-c061-44b9-b6de-c99410bf9c4d.jpg',
  'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/5a5f5722-c061-44b9-b6de-c99410bf9c4d.thumbnail.webp',
  'image/jpeg',
  900,
  600,
  1536,
  384
FROM users
WHERE email = 'case-test@example.com';

DELETE FROM atlas_media
WHERE id = 'dc344f71-1237-452a-bf5c-0f2f0886861a';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM atlas_media_deletion_outbox
    WHERE media_id = 'dc344f71-1237-452a-bf5c-0f2f0886861a'
      AND original_path =
        'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/5a5f5722-c061-44b9-b6de-c99410bf9c4d.jpg'
      AND thumbnail_path =
        'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/5a5f5722-c061-44b9-b6de-c99410bf9c4d.thumbnail.webp'
  ) THEN
    RAISE EXCEPTION 'Legacy object identity was not queued exactly';
  END IF;
END
$$;

-- Legacy associations can predate the current path and byte policies. Their
-- raw payload must reach the durable queue so the worker can fail closed and
-- dead-letter it; an outbox CHECK must never make the association undeletable.
INSERT INTO atlas_media (
  id,
  entry_id,
  user_id,
  storage_path,
  thumbnail_path,
  mime_type,
  width,
  height,
  byte_size,
  thumbnail_byte_size
)
SELECT
  'af68b383-3a47-4197-936f-a1025ddc76e1',
  '28ec2bad-ad24-4e1f-b033-093dc88ca71a',
  id,
  'legacy/media/not-an-atlas-path.jpg',
  NULL,
  'image/jpeg',
  640,
  480,
  1,
  1
FROM users
WHERE email = 'case-test@example.com';

INSERT INTO atlas_media (
  id,
  entry_id,
  user_id,
  storage_path,
  thumbnail_path,
  mime_type,
  width,
  height,
  byte_size,
  thumbnail_byte_size
)
SELECT
  'e8d02045-f144-4494-9b66-8a3c54a946d5',
  '28ec2bad-ad24-4e1f-b033-093dc88ca71a',
  id,
  'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/e8d02045-f144-4494-9b66-8a3c54a946d5.jpg',
  'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/e8d02045-f144-4494-9b66-8a3c54a946d5.thumbnail.webp',
  'image/jpeg',
  640,
  480,
  25165824,
  1
FROM users
WHERE email = 'case-test@example.com';

DELETE FROM atlas_media
WHERE id IN (
  'af68b383-3a47-4197-936f-a1025ddc76e1',
  'e8d02045-f144-4494-9b66-8a3c54a946d5'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atlas_media
    WHERE id IN (
      'af68b383-3a47-4197-936f-a1025ddc76e1',
      'e8d02045-f144-4494-9b66-8a3c54a946d5'
    )
  ) THEN
    RAISE EXCEPTION 'Legacy Atlas media payload prevented association deletion';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas_media_deletion_outbox
    WHERE media_id = 'af68b383-3a47-4197-936f-a1025ddc76e1'
      AND original_path = 'legacy/media/not-an-atlas-path.jpg'
      AND thumbnail_path IS NULL
      AND reserved_bytes = 2
      AND completed_at IS NULL
      AND dead_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Malformed legacy deletion payload was not quarantined';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas_media_deletion_outbox
    WHERE media_id = 'e8d02045-f144-4494-9b66-8a3c54a946d5'
      AND original_path =
        'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/e8d02045-f144-4494-9b66-8a3c54a946d5.jpg'
      AND thumbnail_path =
        'atlas/memories/28ec2bad-ad24-4e1f-b033-093dc88ca71a/e8d02045-f144-4494-9b66-8a3c54a946d5.thumbnail.webp'
      AND reserved_bytes = 25165825
      AND completed_at IS NULL
      AND dead_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Oversized legacy deletion payload was not quarantined';
  END IF;
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
  '76bb06bf-3402-4505-be17-2fd18e8bf82c',
  id,
  'b7c8b169-a489-4ef6-bbfa-b6520b3fb62d',
  'Deletion rollback integration memory',
  'saved',
  ST_SetSRID(ST_MakePoint(-83.04, 43.41), 4326)::geography
FROM users
WHERE email = 'case-test@example.com';

INSERT INTO atlas_media (
  id,
  entry_id,
  user_id,
  storage_path,
  thumbnail_path,
  mime_type,
  width,
  height,
  byte_size,
  thumbnail_byte_size
)
SELECT
  'aa18fa52-c1eb-497a-af57-ae5d9222c1a7',
  '76bb06bf-3402-4505-be17-2fd18e8bf82c',
  id,
  'atlas/memories/76bb06bf-3402-4505-be17-2fd18e8bf82c/aa18fa52-c1eb-497a-af57-ae5d9222c1a7.jpg',
  'atlas/memories/76bb06bf-3402-4505-be17-2fd18e8bf82c/aa18fa52-c1eb-497a-af57-ae5d9222c1a7.thumbnail.webp',
  'image/jpeg',
  1200,
  800,
  2048,
  512
FROM users
WHERE email = 'case-test@example.com';

SAVEPOINT atlas_media_delete_rollback;

DELETE FROM atlas_media
WHERE id = 'aa18fa52-c1eb-497a-af57-ae5d9222c1a7';

ROLLBACK TO SAVEPOINT atlas_media_delete_rollback;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM atlas_media
    WHERE id = 'aa18fa52-c1eb-497a-af57-ae5d9222c1a7'
  ) THEN
    RAISE EXCEPTION 'Rolled-back Atlas media delete removed the association';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas_media_deletion_outbox
    WHERE media_id = 'aa18fa52-c1eb-497a-af57-ae5d9222c1a7'
  ) THEN
    RAISE EXCEPTION 'Rolled-back Atlas media delete retained cleanup work';
  END IF;
END
$$;

RELEASE SAVEPOINT atlas_media_delete_rollback;

INSERT INTO atlas_entries (
  id,
  user_id,
  client_request_id,
  title,
  record_state,
  location
)
SELECT
  '40b83915-e030-43b1-964a-cc993e63bb69',
  id,
  '457d4dc2-7205-40e0-92e9-fe18149a04e7',
  'Cascade deletion integration memory',
  'saved',
  ST_SetSRID(ST_MakePoint(-83.03, 43.40), 4326)::geography
FROM users
WHERE email = 'case-test@example.com';

INSERT INTO atlas_media (
  id,
  entry_id,
  user_id,
  storage_path,
  thumbnail_path,
  mime_type,
  width,
  height,
  byte_size,
  thumbnail_byte_size
)
SELECT
  '44901636-094d-4630-9663-626cbf14c593',
  '40b83915-e030-43b1-964a-cc993e63bb69',
  id,
  'atlas/memories/40b83915-e030-43b1-964a-cc993e63bb69/44901636-094d-4630-9663-626cbf14c593.png',
  'atlas/memories/40b83915-e030-43b1-964a-cc993e63bb69/44901636-094d-4630-9663-626cbf14c593.thumbnail.jpg',
  'image/png',
  800,
  1200,
  4096,
  768
FROM users
WHERE email = 'case-test@example.com';

DELETE FROM atlas_entries
WHERE id = '40b83915-e030-43b1-964a-cc993e63bb69';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atlas_media
    WHERE id = '44901636-094d-4630-9663-626cbf14c593'
  ) THEN
    RAISE EXCEPTION 'Atlas entry cascade retained its media association';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas_media_deletion_outbox
    WHERE media_id = '44901636-094d-4630-9663-626cbf14c593'
      AND entry_id = '40b83915-e030-43b1-964a-cc993e63bb69'
      AND original_path =
        'atlas/memories/40b83915-e030-43b1-964a-cc993e63bb69/44901636-094d-4630-9663-626cbf14c593.png'
      AND thumbnail_path =
        'atlas/memories/40b83915-e030-43b1-964a-cc993e63bb69/44901636-094d-4630-9663-626cbf14c593.thumbnail.jpg'
      AND reserved_bytes = 4864
      AND completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Atlas entry cascade did not retain deletion work';
  END IF;
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
