-- 003_settlement_kyc.sql
-- Adds: settlement infrastructure, KYC document tracking, Airtel/T-Kash support

BEGIN;

-- ─── Settlement accounts ──────────────────────────────────────────────────────
-- Where each merchant wants their daily settlement sent.

CREATE TABLE settlement_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  account_type    TEXT        NOT NULL CHECK (account_type IN ('MPESA', 'BANK')),
  -- M-Pesa settlement
  mpesa_phone     TEXT,
  -- Bank settlement
  bank_name       TEXT,
  account_number  TEXT,
  account_name    TEXT,
  -- Common
  is_primary      BOOLEAN     NOT NULL DEFAULT false,
  active          BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_settlement_accounts_primary
  ON settlement_accounts (merchant_id)
  WHERE is_primary = true AND active = true;

CREATE INDEX idx_settlement_accounts_merchant
  ON settlement_accounts (merchant_id);

-- ─── Settlements ──────────────────────────────────────────────────────────────
-- One row per nightly settlement batch per merchant.

CREATE TABLE settlements (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            UUID        NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  settlement_account_id  UUID        REFERENCES settlement_accounts(id),
  period_start           TIMESTAMPTZ NOT NULL,
  period_end             TIMESTAMPTZ NOT NULL,
  gross_amount_cents     BIGINT      NOT NULL,
  fee_cents              BIGINT      NOT NULL DEFAULT 0,
  net_amount_cents       BIGINT      NOT NULL,
  transaction_count      INTEGER     NOT NULL,
  status                 TEXT        NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','NO_ACCOUNT')),
  payout_method          TEXT        CHECK (payout_method IN ('MPESA','BANK','MANUAL')),
  b2c_request_id         TEXT,
  b2c_receipt            TEXT,
  failure_reason         TEXT,
  settled_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_settlements_merchant
  ON settlements (merchant_id, created_at DESC);

CREATE INDEX idx_settlements_status
  ON settlements (status)
  WHERE status IN ('PENDING', 'PROCESSING');

-- Junction: which transactions are included in each settlement batch.
CREATE TABLE settlement_transactions (
  settlement_id   UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  PRIMARY KEY (settlement_id, transaction_id)
);

CREATE INDEX idx_settlement_txns_txn
  ON settlement_transactions (transaction_id);

-- ─── KYC documents ────────────────────────────────────────────────────────────
-- Merchant identity documents submitted during onboarding.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS kyc_status    TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'
    CHECK (kyc_status IN ('NOT_SUBMITTED','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')),
  ADD COLUMN IF NOT EXISTS kyc_notes     TEXT,
  ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ;

CREATE TABLE kyc_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  doc_type     TEXT        NOT NULL
                 CHECK (doc_type IN ('NATIONAL_ID','PASSPORT','BUSINESS_REG','KRA_CERT','SELFIE','OTHER')),
  file_url     TEXT        NOT NULL,
  file_name    TEXT,
  verified     BOOLEAN     NOT NULL DEFAULT false,
  verified_by  TEXT,
  verified_at  TIMESTAMPTZ,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kyc_documents_merchant
  ON kyc_documents (merchant_id, doc_type);

-- ─── Airtel Money / T-Kash callbacks ─────────────────────────────────────────
-- Stores raw inbound callbacks from alternative payment rails for audit.

CREATE TABLE alt_rail_callbacks (
  id          BIGSERIAL   PRIMARY KEY,
  rail        TEXT        NOT NULL CHECK (rail IN ('AIRTEL','TKASH')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  remote_ip   TEXT,
  raw_body    JSONB       NOT NULL,
  processed   BOOLEAN     NOT NULL DEFAULT false,
  retained_until TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 years'
);

CREATE INDEX idx_alt_rail_callbacks_rail
  ON alt_rail_callbacks (rail, received_at DESC);

-- ─── Triggers ─────────────────────────────────────────────────────────────────

CREATE TRIGGER set_updated_at_settlement_accounts
  BEFORE UPDATE ON settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_settlements
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
