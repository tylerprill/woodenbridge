BEGIN;

-- Blob deletion cannot participate in the PostgreSQL transaction that removes
-- a photograph. Persist the immutable object pair first so every committed
-- media deletion has durable, retryable cleanup work.
CREATE TABLE IF NOT EXISTS public.atlas_media_deletion_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  user_id UUID NOT NULL,
  original_path TEXT NOT NULL,
  thumbnail_path TEXT,
  reserved_bytes BIGINT NOT NULL,
  reason VARCHAR(24) NOT NULL DEFAULT 'registered_media',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  -- A signed PUT is valid for at most 10 minutes. Keep every newly queued
  -- deletion fenced for 15 minutes so an upload already in flight gets an
  -- additional five-minute completion grace before either object is removed.
  available_at TIMESTAMPTZ NOT NULL DEFAULT (
    NOW() + INTERVAL '15 minutes'
  ),
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error_code VARCHAR(48),
  completed_at TIMESTAMPTZ,
  dead_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atlas_media_deletion_outbox_media_unique UNIQUE (media_id),
  CONSTRAINT atlas_media_deletion_outbox_original_unique UNIQUE (original_path),
  -- Payload columns intentionally have no path or byte-policy CHECKs. The
  -- DELETE trigger must be able to preserve malformed or oversized legacy
  -- atlas_media rows instead of making those associations undeletable. The
  -- worker treats this payload as untrusted, validates it before Blob access,
  -- and dead-letters anything outside the current policy.
  CONSTRAINT atlas_media_deletion_outbox_reason CHECK (
    reason IN ('registered_media', 'cancelled_upload')
  ),
  CONSTRAINT atlas_media_deletion_outbox_attempt_count
    CHECK (attempt_count >= 0),
  CONSTRAINT atlas_media_deletion_outbox_lease_pair CHECK (
    (lease_token IS NULL AND leased_until IS NULL)
    OR (lease_token IS NOT NULL AND leased_until IS NOT NULL)
  ),
  CONSTRAINT atlas_media_deletion_outbox_terminal_state CHECK (
    NOT (completed_at IS NOT NULL AND dead_at IS NOT NULL)
    AND (
      (completed_at IS NULL AND dead_at IS NULL)
      OR (lease_token IS NULL AND leased_until IS NULL)
    )
  ),
  CONSTRAINT atlas_media_deletion_outbox_completion_order
    CHECK (completed_at IS NULL OR completed_at >= created_at),
  CONSTRAINT atlas_media_deletion_outbox_dead_order
    CHECK (dead_at IS NULL OR dead_at >= created_at),
  CONSTRAINT atlas_media_deletion_outbox_error_code CHECK (
    last_error_code IS NULL
    OR LENGTH(last_error_code) BETWEEN 1 AND 48
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS atlas_media_deletion_outbox_thumbnail_unique_idx
  ON public.atlas_media_deletion_outbox (thumbnail_path)
  WHERE thumbnail_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS atlas_media_deletion_outbox_claim_idx
  ON public.atlas_media_deletion_outbox (available_at, created_at, id)
  WHERE completed_at IS NULL AND dead_at IS NULL;

CREATE INDEX IF NOT EXISTS atlas_media_deletion_outbox_expired_lease_idx
  ON public.atlas_media_deletion_outbox (leased_until, id)
  WHERE
    completed_at IS NULL
    AND dead_at IS NULL
    AND leased_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS atlas_media_deletion_outbox_user_pending_idx
  ON public.atlas_media_deletion_outbox (user_id, created_at)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS atlas_media_deletion_outbox_retention_idx
  ON public.atlas_media_deletion_outbox (completed_at, id)
  WHERE completed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enqueue_atlas_media_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  queued_id UUID;
BEGIN
  INSERT INTO public.atlas_media_deletion_outbox (
    media_id,
    entry_id,
    user_id,
    original_path,
    thumbnail_path,
    reserved_bytes,
    reason,
    available_at
  )
  VALUES (
    OLD.id,
    OLD.entry_id,
    OLD.user_id,
    OLD.storage_path,
    OLD.thumbnail_path,
    OLD.byte_size::BIGINT + COALESCE(OLD.thumbnail_byte_size, 0)::BIGINT,
    'registered_media',
    NOW() + INTERVAL '15 minutes'
  )
  ON CONFLICT (media_id) DO UPDATE
  SET
    reserved_bytes = EXCLUDED.reserved_bytes,
    reason = EXCLUDED.reason,
    attempt_count = 0,
    available_at = NOW() + INTERVAL '15 minutes',
    lease_token = NULL,
    leased_until = NULL,
    last_attempt_at = NULL,
    last_error_code = NULL,
    completed_at = NULL,
    dead_at = NULL,
    updated_at = NOW()
  WHERE
    atlas_media_deletion_outbox.entry_id = EXCLUDED.entry_id
    AND atlas_media_deletion_outbox.user_id = EXCLUDED.user_id
    AND atlas_media_deletion_outbox.original_path = EXCLUDED.original_path
    AND atlas_media_deletion_outbox.thumbnail_path IS NOT DISTINCT FROM
      EXCLUDED.thumbnail_path
  RETURNING id INTO queued_id;

  IF queued_id IS NULL THEN
    RAISE EXCEPTION 'Conflicting Atlas media deletion identity for %', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS atlas_media_enqueue_deletion ON public.atlas_media;

CREATE TRIGGER atlas_media_enqueue_deletion
BEFORE DELETE ON public.atlas_media
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_atlas_media_deletion();

COMMIT;
