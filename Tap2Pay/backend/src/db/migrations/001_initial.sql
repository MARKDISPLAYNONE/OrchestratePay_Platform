-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- MERCHANTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchants (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  phone             TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  mpesa_shortcode   TEXT,
  mpesa_account_ref TEXT,
  kra_pin           TEXT,
  active            BOOLEAN NOT NULL DEFAULT true,
  device_id         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kra_pin TEXT;

CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSUMERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone           TEXT NOT NULL UNIQUE,
  phone_hash      TEXT NOT NULL,
  display_name    TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consumers_phone_hash ON consumers(phone_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- NFC TAGS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfc_tags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag_id      TEXT NOT NULL UNIQUE,
  uid         TEXT,
  consumer_id UUID NOT NULL REFERENCES consumers(id) ON DELETE RESTRICT,
  active      BOOLEAN NOT NULL DEFAULT true,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nfc_tags_tag_id ON nfc_tags(tag_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRANSACTIONS (financial ledger)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id          UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  consumer_id          UUID NOT NULL REFERENCES consumers(id) ON DELETE RESTRICT,
  amount_cents         BIGINT NOT NULL CHECK (amount_cents > 0),
  currency             TEXT NOT NULL DEFAULT 'KES',
  status               TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','STK_SENT','CONFIRMED','DECLINED','FAILED','EXPIRED')),
  source               TEXT NOT NULL DEFAULT 'NFC_TAG'
                         CHECK (source IN ('NFC_TAG','QR_CODE','ISO_CARD')),
  nfc_uid              TEXT,
  idempotency_key      TEXT NOT NULL,
  checkout_request_id  TEXT,
  merchant_request_id  TEXT,
  mpesa_receipt        TEXT,
  mpesa_result_code    INTEGER,
  mpesa_result_desc    TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency
  ON transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transactions_checkout_request
  ON transactions(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_pending
  ON transactions(created_at) WHERE status = 'PENDING';

-- Expand status and source enums beyond the inline CHECK defaults
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('PENDING','STK_SENT','CONFIRMED','DECLINED','FAILED','EXPIRED'));
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN (
    'NFC_TAG',
    'QR_CODE',
    'ISO_CARD',
    'HCE_PHONE',
    'SOFTPOS_MOBILE',
    'CONSUMER_TAG',
    'CONSUMER_QR',
    'MERCHANT_HCE',
    'P2P_NFC',
    'P2P_QR'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- SERVER AUDIT LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS server_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event       TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  detail      JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON server_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON server_audit_log(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- DARAJA CALLBACK LOG (raw 7-year audit archive)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daraja_callback_log (
  id                   BIGSERIAL PRIMARY KEY,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  remote_ip            TEXT,
  checkout_request_id  TEXT,
  result_code          INTEGER,
  raw_body             JSONB NOT NULL,
  verified             BOOLEAN,
  retained_until       DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '7 years')
);
CREATE INDEX IF NOT EXISTS idx_callback_log_checkout  ON daraja_callback_log(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_callback_log_received  ON daraja_callback_log(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_callback_log_retention ON daraja_callback_log(retained_until);

-- ─────────────────────────────────────────────────────────────────────────────
-- MULTI-CURRENCY: exchange rates cache + FX fields on transactions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id         BIGSERIAL PRIMARY KEY,
  base       TEXT NOT NULL DEFAULT 'KES',
  quote      TEXT NOT NULL,
  rate       NUMERIC(18,8) NOT NULL,
  source     TEXT NOT NULL DEFAULT 'openexchangerates',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON exchange_rates(quote, fetched_at DESC);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_currency     TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_amount_cents BIGINT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fx_rate               NUMERIC(18,8);

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENT RAIL EXPANSION
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MPESA';
DO $$ BEGIN
  ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
  ALTER TABLE transactions ADD CONSTRAINT transactions_payment_method_check
    CHECK (payment_method IN ('MPESA','VISA','MASTERCARD','EQUITY_MOBILE','COOP_MOBILE','RTGS','EFT','PESALINK'));
EXCEPTION WHEN others THEN NULL;
END $$;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_scheme    TEXT
  CHECK (card_scheme IN ('VISA','MASTERCARD','AMEX','UNIONPAY') OR card_scheme IS NULL);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_last_four CHAR(4);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_type      TEXT
  CHECK (card_type IN ('DEBIT','CREDIT','PREPAID') OR card_type IS NULL);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS acquirer       TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSUMER AUTH: fields for web-app login + SMS opt-in
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE consumers ADD COLUMN IF NOT EXISTS email           TEXT UNIQUE;
ALTER TABLE consumers ADD COLUMN IF NOT EXISTS password_hash   TEXT;
ALTER TABLE consumers ADD COLUMN IF NOT EXISTS display_name    TEXT;
ALTER TABLE consumers ADD COLUMN IF NOT EXISTS email_verified  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE consumers ADD COLUMN IF NOT EXISTS sms_opt_in      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE consumers ADD COLUMN IF NOT EXISTS fcm_token       TEXT;
CREATE INDEX IF NOT EXISTS idx_consumers_email ON consumers(email) WHERE email IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- MERCHANT APPROVAL GATE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'APPROVED';
DO $$ BEGIN
  ALTER TABLE merchants DROP CONSTRAINT IF EXISTS merchants_approval_status_check;
  ALTER TABLE merchants ADD CONSTRAINT merchants_approval_status_check
    CHECK (approval_status IN ('PENDING_REVIEW','APPROVED','REJECTED','SUSPENDED'));
EXCEPTION WHEN others THEN NULL;
END $$;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS business_reg_number TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS id_number            TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS review_notes         TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reviewed_by          UUID;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reviewed_at          TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- WEB SESSIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('MERCHANT','CONSUMER','ADMIN')),
  device_hint TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id, expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- FISCAL LOG (KRA eTIMS — 7-year CBK/KRA retention)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_log (
  id                  BIGSERIAL PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  invoice_number      TEXT NOT NULL UNIQUE,
  amount_cents        BIGINT NOT NULL,
  vat_cents           BIGINT NOT NULL,
  vat_rate            NUMERIC(5,4) NOT NULL DEFAULT 0.16,
  etims_status        TEXT NOT NULL DEFAULT 'QUEUED'
                        CHECK (etims_status IN ('QUEUED','SUBMITTED','ACCEPTED','REJECTED','FAILED')),
  etims_response      JSONB,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retained_until      DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '7 years')
);
CREATE INDEX IF NOT EXISTS idx_fiscal_log_txn        ON fiscal_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_log_merchant   ON fiscal_log(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_log_status     ON fiscal_log(etims_status) WHERE etims_status IN ('QUEUED','FAILED');
CREATE INDEX IF NOT EXISTS idx_fiscal_log_retention  ON fiscal_log(retained_until);

-- ─────────────────────────────────────────────────────────────────────────────
-- LOYALTY — per-merchant programmes, balances, ledger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_programmes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id      UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE UNIQUE,
  programme_type   TEXT NOT NULL CHECK (programme_type IN ('POINTS','STAMPS')),
  points_per_ksh   NUMERIC(10,2),
  stamps_for_reward INT,
  reward_description TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_balances (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consumer_id          UUID NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
  merchant_id          UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  points_balance       BIGINT NOT NULL DEFAULT 0,
  stamps_balance       INT    NOT NULL DEFAULT 0,
  lifetime_spent_cents BIGINT NOT NULL DEFAULT 0,
  UNIQUE (consumer_id, merchant_id)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_balances_consumer ON loyalty_balances(consumer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_balances_merchant ON loyalty_balances(merchant_id);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id             BIGSERIAL PRIMARY KEY,
  consumer_id    UUID NOT NULL REFERENCES consumers(id) ON DELETE RESTRICT,
  merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN ('EARN','REDEEM','EXPIRE','ADJUST')),
  points_delta   BIGINT NOT NULL DEFAULT 0,
  stamps_delta   INT    NOT NULL DEFAULT 0,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_consumer ON loyalty_ledger(consumer_id, merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_txn      ON loyalty_ledger(transaction_id) WHERE transaction_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- FLEET / DEVICE MANAGEMENT
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id                             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id                    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  device_serial                  TEXT NOT NULL UNIQUE,
  model                          TEXT,
  app_version_code               INT,
  device_type                    TEXT NOT NULL DEFAULT 'SUNMI_TERMINAL',
  device_integrity_verified_at   TIMESTAMPTZ,
  last_seen_at                   TIMESTAMPTZ,
  active                         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_merchant    ON devices(merchant_id);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen   ON devices(last_seen_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS device_telemetry (
  id                  BIGSERIAL PRIMARY KEY,
  device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  app_version_code    INT,
  battery_pct         SMALLINT,
  battery_health      TEXT,
  is_charging         BOOLEAN,
  printer_status      SMALLINT,
  storage_free_bytes  BIGINT,
  nfc_available       BOOLEAN,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device      ON device_telemetry(device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_merchant    ON device_telemetry(merchant_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS device_alerts (
  id          BIGSERIAL PRIMARY KEY,
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_device_alerts_unresolved ON device_alerts(device_id, created_at DESC) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_device_alerts_merchant   ON device_alerts(merchant_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- ANALYTICS — materialized view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_revenue AS
SELECT
  merchant_id,
  date_trunc('hour', created_at AT TIME ZONE 'Africa/Nairobi') AS hour_nairobi,
  COUNT(*) FILTER (WHERE status = 'CONFIRMED')                  AS confirmed_count,
  SUM(amount_cents) FILTER (WHERE status = 'CONFIRMED')         AS revenue_cents,
  COUNT(*) FILTER (WHERE status = 'DECLINED')                   AS declined_count
FROM transactions
GROUP BY merchant_id, hour_nairobi
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hourly_revenue
  ON mv_hourly_revenue (merchant_id, hour_nairobi);

-- ─────────────────────────────────────────────────────────────────────────────
-- ACCOUNTING INTEGRATIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_integrations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  access_token  TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  realm_id      TEXT,
  settings      JSONB NOT NULL DEFAULT '{}',
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, platform)
);

DO $$ BEGIN
  ALTER TABLE accounting_integrations ADD CONSTRAINT accounting_platform_check
    CHECK (platform IN ('quickbooks','xero','sage','wave'));
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE accounting_integrations ADD CONSTRAINT accounting_status_check
    CHECK (status IN ('ACTIVE','PAUSED','DISCONNECTED'));
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS gl_postings (
  id                   BIGSERIAL PRIMARY KEY,
  accounting_integration_id UUID NOT NULL REFERENCES accounting_integrations(id),
  merchant_id          UUID NOT NULL REFERENCES merchants(id),
  transaction_id       UUID NOT NULL REFERENCES transactions(id),
  platform             TEXT NOT NULL,
  external_id          TEXT,
  status               TEXT NOT NULL DEFAULT 'PENDING',
  debit_account        TEXT NOT NULL,
  credit_account       TEXT NOT NULL,
  amount_cents         BIGINT NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'KES',
  description          TEXT,
  journal_date         DATE NOT NULL,
  attempt_count        INT NOT NULL DEFAULT 0,
  last_error           TEXT,
  posted_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gl_postings_transaction ON gl_postings (transaction_id);
CREATE INDEX IF NOT EXISTS idx_gl_postings_status      ON gl_postings (status) WHERE status = 'PENDING';

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTOMATIC updated_at TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER merchants_updated_at BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER accounting_integrations_updated_at BEFORE UPDATE ON accounting_integrations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- P2P TRANSACTIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_transactions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id     UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  payer_consumer_id  UUID NOT NULL REFERENCES consumers(id) ON DELETE RESTRICT,
  payee_consumer_id  UUID NOT NULL REFERENCES consumers(id) ON DELETE RESTRICT,
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  status             TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','CONFIRMED','DECLINED','FAILED')),
  idempotency_key    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_p2p_idempotency ON p2p_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_p2p_payer   ON p2p_transactions(payer_consumer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_payee   ON p2p_transactions(payee_consumer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_txn     ON p2p_transactions(transaction_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- KYC TIER — CBK compliance daily spend limits
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE consumers
  ADD COLUMN IF NOT EXISTS kyc_tier TEXT NOT NULL DEFAULT 'BASIC'
    CHECK (kyc_tier IN ('BASIC', 'ENHANCED', 'FULL'));

ALTER TABLE consumers
  ADD COLUMN IF NOT EXISTS email          TEXT,
  ADD COLUMN IF NOT EXISTS password_hash  TEXT;

CREATE INDEX IF NOT EXISTS idx_consumers_kyc_tier ON consumers(kyc_tier);

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENT LATENCY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_latency (
  txn_id              UUID PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  api_round_trip_ms   INTEGER,
  daraja_dispatch_ms  INTEGER,
  stk_confirm_ms      INTEGER,
  total_ms            INTEGER,
  source              TEXT,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_latency_recorded ON payment_latency(recorded_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SPLIT SESSIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS split_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  creator_phone   TEXT NOT NULL,
  total_cents     BIGINT NOT NULL CHECK (total_cents > 0),
  description     TEXT,
  participants    JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','INITIATING','COMPLETE','PARTIAL','EXPIRED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_split_sessions_merchant ON split_sessions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_split_sessions_status   ON split_sessions(status) WHERE status IN ('OPEN', 'INITIATING');

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSUMER REFRESH TOKENS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumer_refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consumer_id     UUID NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  revoked_at      TIMESTAMPTZ,
  device_hint     TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_consumer
  ON consumer_refresh_tokens(consumer_id) WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- MERCHANT REFRESH TOKENS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  revoked_at   TIMESTAMPTZ,
  device_hint  TEXT
);
CREATE INDEX IF NOT EXISTS idx_merchant_refresh_tokens_merchant
  ON merchant_refresh_tokens(merchant_id) WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ETIMS SEQUENTIAL INVOICE NUMBER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS etims_invoice_seq START 1;
