-- 004_kyc_aml.sql — KYC/AML enhancements

BEGIN;

-- Extend merchants table with business profile + AML fields
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS business_type          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS business_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS business_address_city  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_address_country VARCHAR(3) DEFAULT 'KE',
  ADD COLUMN IF NOT EXISTS nature_of_business     TEXT,
  ADD COLUMN IF NOT EXISTS expected_monthly_volume_cents BIGINT,
  ADD COLUMN IF NOT EXISTS beneficial_owner_name  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS beneficial_owner_id_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS beneficial_owner_ownership_pct SMALLINT,
  ADD COLUMN IF NOT EXISTS kyc_tier               VARCHAR(20) DEFAULT 'BASIC',
  ADD COLUMN IF NOT EXISTS sanctions_status       VARCHAR(20) DEFAULT 'NOT_CHECKED',
  ADD COLUMN IF NOT EXISTS sanctions_checked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aml_risk_level         VARCHAR(20) DEFAULT 'LOW',
  ADD COLUMN IF NOT EXISTS daily_tx_limit_cents   BIGINT,
  ADD COLUMN IF NOT EXISTS monthly_tx_limit_cents BIGINT;

-- Screening log
CREATE TABLE IF NOT EXISTS kyc_screening_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  screening_type  VARCHAR(50)  NOT NULL,  -- SANCTIONS, PEP, AML_RISK, FULL
  result          VARCHAR(20)  NOT NULL,  -- CLEAR, FLAGGED, ERROR
  details         JSONB,
  screened_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_screening_merchant ON kyc_screening_log(merchant_id);

-- AML suspicious activity flags
CREATE TABLE IF NOT EXISTS aml_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    UUID REFERENCES merchants(id) ON DELETE CASCADE,
  consumer_id    UUID REFERENCES consumers(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  flag_type      VARCHAR(50)  NOT NULL,   -- STRUCTURING, HIGH_VELOCITY, SANCTIONS_MATCH, PEP_MATCH, ADVERSE_MEDIA
  details        JSONB,
  status         VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN, REVIEWED, CLEARED, REPORTED_TO_FIU
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_aml_flags_merchant ON aml_flags(merchant_id);
CREATE INDEX IF NOT EXISTS idx_aml_flags_status   ON aml_flags(status);

COMMIT;
