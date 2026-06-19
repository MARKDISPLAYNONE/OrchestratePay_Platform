-- Migration 002: Refunds, Merchant Webhooks, Subscriptions, Disputes, API Keys
-- Each section is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- ─────────────────────────────────────────────────────────────────────────────
-- REFUNDS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refunds (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  merchant_id      UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','APPROVED','PROCESSING','COMPLETED','REJECTED','FAILED')),
  initiated_by     TEXT NOT NULL CHECK (initiated_by IN ('MERCHANT','ADMIN')),
  b2c_request_id   TEXT,
  b2c_receipt      TEXT,
  approved_by      UUID,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refunds_transaction ON refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_refunds_merchant    ON refunds(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_status      ON refunds(status) WHERE status IN ('PENDING','PROCESSING');

-- ─────────────────────────────────────────────────────────────────────────────
-- MERCHANT WEBHOOKS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_webhooks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  events      TEXT[] NOT NULL DEFAULT ARRAY['payment.confirmed','payment.failed','refund.completed'],
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_merchant ON merchant_webhooks(merchant_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           BIGSERIAL PRIMARY KEY,
  webhook_id   UUID NOT NULL REFERENCES merchant_webhooks(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','DELIVERED','FAILED')),
  attempt      INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  delivered_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON webhook_deliveries(created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_plans (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency     TEXT NOT NULL DEFAULT 'KES',
  interval     TEXT NOT NULL CHECK (interval IN ('DAILY','WEEKLY','MONTHLY','QUARTERLY','ANNUALLY')),
  trial_days   INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_merchant ON subscription_plans(merchant_id);

CREATE TABLE IF NOT EXISTS subscriber_enrollments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id         UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  consumer_phone  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','CANCELLED','PAUSED','TRIAL')),
  next_billing_at TIMESTAMPTZ NOT NULL,
  trial_ends_at   TIMESTAMPTZ,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_enrollments_plan      ON subscriber_enrollments(plan_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_next_bill ON subscriber_enrollments(next_billing_at) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_phone_plan ON subscriber_enrollments(plan_id, consumer_phone);

-- ─────────────────────────────────────────────────────────────────────────────
-- DISPUTES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  raised_by        TEXT NOT NULL CHECK (raised_by IN ('MERCHANT','CONSUMER')),
  reason_code      TEXT NOT NULL CHECK (reason_code IN (
    'DUPLICATE_CHARGE','GOODS_NOT_DELIVERED','AMOUNT_INCORRECT',
    'UNAUTHORIZED_TRANSACTION','FRAUD','OTHER'
  )),
  description      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED_MERCHANT_FAVOR','RESOLVED_CONSUMER_FAVOR','CLOSED')),
  evidence_url     TEXT,
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disputes_transaction ON disputes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status      ON disputes(status) WHERE status IN ('OPEN','UNDER_REVIEW');
CREATE INDEX IF NOT EXISTS idx_disputes_created     ON disputes(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- MERCHANT API KEYS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  name         TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_merchant ON merchant_api_keys(merchant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash     ON merchant_api_keys(key_hash) WHERE active = TRUE;
