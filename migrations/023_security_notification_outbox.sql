BEGIN;

CREATE TABLE IF NOT EXISTS security_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_email VARCHAR(320) NOT NULL,
  recipient_first_name VARCHAR(120) NOT NULL,
  kind VARCHAR(48) NOT NULL,
  change_id VARCHAR(160) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error_code VARCHAR(48),
  delivered_at TIMESTAMPTZ,
  dead_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT security_notification_outbox_kind
    CHECK (
      kind IN (
        'password_changed',
        'passkey_added',
        'passkey_removed',
        'account_status_changed',
        'recovery_codes_created',
        'recovery_code_used',
        'recovery_completed'
      )
    ),
  CONSTRAINT security_notification_outbox_recipient
    CHECK (
      LENGTH(recipient_email) BETWEEN 3 AND 320
      AND POSITION('@' IN recipient_email) > 1
      AND POSITION(CHR(10) IN recipient_email) = 0
      AND POSITION(CHR(13) IN recipient_email) = 0
      AND LENGTH(recipient_first_name) BETWEEN 1 AND 120
      AND POSITION(CHR(10) IN recipient_first_name) = 0
      AND POSITION(CHR(13) IN recipient_first_name) = 0
    ),
  CONSTRAINT security_notification_outbox_change_id
    CHECK (LENGTH(change_id) BETWEEN 1 AND 160),
  CONSTRAINT security_notification_outbox_payload_object
    CHECK (
      JSONB_TYPEOF(payload) = 'object'
      AND OCTET_LENGTH(payload::TEXT) <= 1024
    ),
  -- Payloads are an allowlist, not a generic event dump. This database-level
  -- shape guard prevents passwords, reset tokens, WebAuthn material, or
  -- plaintext recovery codes from being persisted by a future caller.
  CONSTRAINT security_notification_outbox_safe_payload
    CHECK (
      (kind = 'password_changed' AND payload = '{}'::JSONB)
      OR (
        kind IN ('passkey_added', 'passkey_removed')
        AND payload ? 'passkeyLabel'
        AND JSONB_TYPEOF(payload -> 'passkeyLabel') = 'string'
        AND LENGTH(payload ->> 'passkeyLabel') BETWEEN 1 AND 80
        AND (payload - 'passkeyLabel') = '{}'::JSONB
      )
      OR (
        kind = 'account_status_changed'
        AND payload ? 'status'
        AND payload ->> 'status' IN ('active', 'suspended')
        AND (payload - 'status') = '{}'::JSONB
      )
      OR (
        kind IN ('recovery_codes_created', 'recovery_completed')
        AND payload = '{}'::JSONB
      )
      OR (
        kind = 'recovery_code_used'
        AND payload ? 'remainingCodes'
        AND JSONB_TYPEOF(payload -> 'remainingCodes') = 'number'
        AND (payload ->> 'remainingCodes')::INTEGER BETWEEN 0 AND 12
        AND (payload - 'remainingCodes') = '{}'::JSONB
      )
    ),
  CONSTRAINT security_notification_outbox_attempt_count
    CHECK (attempt_count BETWEEN 0 AND 12),
  CONSTRAINT security_notification_outbox_lease_pair
    CHECK (
      (lease_token IS NULL AND leased_until IS NULL)
      OR (lease_token IS NOT NULL AND leased_until IS NOT NULL)
    ),
  CONSTRAINT security_notification_outbox_terminal_state
    CHECK (NOT (delivered_at IS NOT NULL AND dead_at IS NOT NULL)),
  CONSTRAINT security_notification_outbox_delivery_order
    CHECK (delivered_at IS NULL OR delivered_at >= created_at),
  CONSTRAINT security_notification_outbox_dead_order
    CHECK (dead_at IS NULL OR dead_at >= created_at),
  CONSTRAINT security_notification_outbox_error_code
    CHECK (
      last_error_code IS NULL
      OR LENGTH(last_error_code) BETWEEN 1 AND 48
    ),
  CONSTRAINT security_notification_outbox_change_unique
    UNIQUE (kind, change_id)
);

CREATE INDEX IF NOT EXISTS security_notification_outbox_claim_idx
  ON security_notification_outbox (available_at, created_at, id)
  WHERE delivered_at IS NULL AND dead_at IS NULL;

CREATE INDEX IF NOT EXISTS security_notification_outbox_expired_lease_idx
  ON security_notification_outbox (leased_until, id)
  WHERE
    delivered_at IS NULL
    AND dead_at IS NULL
    AND leased_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS security_notification_outbox_user_created_idx
  ON security_notification_outbox (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS security_notification_outbox_retention_idx
  ON security_notification_outbox (
    COALESCE(delivered_at, dead_at),
    id
  )
  WHERE delivered_at IS NOT NULL OR dead_at IS NOT NULL;

COMMIT;
