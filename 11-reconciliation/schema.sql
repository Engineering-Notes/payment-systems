DROP TABLE IF EXISTS recon_results, bank_lines, provider_rows, internal_txns;

-- What our system recorded.
CREATE TABLE internal_txns (
  id           bigserial PRIMARY KEY,
  provider_ref text NOT NULL,             -- the provider's charge or refund id
  kind         text NOT NULL CHECK (kind IN ('charge', 'refund')),
  amount       bigint NOT NULL,           -- minor units, positive
  currency     char(3) NOT NULL,
  created_at   timestamptz NOT NULL
);

-- The provider's settlement report: one row per balance transaction.
CREATE TABLE provider_rows (
  id           bigserial PRIMARY KEY,
  provider_ref text NOT NULL,
  kind         text NOT NULL,
  gross        bigint NOT NULL,           -- negative for refunds
  fee          bigint NOT NULL,
  net          bigint NOT NULL,
  currency     char(3) NOT NULL,
  created_at   timestamptz NOT NULL,
  payout_id    text NOT NULL
);

-- The bank statement: one line per payout received.
CREATE TABLE bank_lines (
  id         bigserial PRIMARY KEY,
  reference  text NOT NULL,               -- the payout id as it appears on the statement
  amount     bigint NOT NULL,
  value_date date NOT NULL
);

CREATE TABLE recon_results (
  provider_ref text,
  status       text NOT NULL,
  internal_amt bigint,
  provider_amt bigint,
  detail       text
);
