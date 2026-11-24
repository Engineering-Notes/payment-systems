DROP TABLE IF EXISTS inbox, outbox, entries, payments, idempotency_keys, rate_limits;

CREATE TABLE rate_limits (key text PRIMARY KEY, tokens double precision NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE TABLE idempotency_keys (key text PRIMARY KEY, request_hash text NOT NULL, payment_id bigint, response jsonb);

CREATE TABLE payments (
  id          bigserial PRIMARY KEY,
  customer    text NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'captured', 'failed')),
  provider_id text UNIQUE,
  captured_by text
);

-- Double-entry ledger, minor units, debit positive. Balanced per transaction at commit.
CREATE TABLE entries (
  id         bigserial PRIMARY KEY,
  payment_id bigint NOT NULL REFERENCES payments(id),
  account    text NOT NULL,
  amount     bigint NOT NULL,
  kind       text NOT NULL,
  UNIQUE (payment_id, account, kind)          -- each effect recorded once per payment
);

CREATE TABLE outbox (id bigserial PRIMARY KEY, payment_id bigint NOT NULL, attempts int NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(), done boolean NOT NULL DEFAULT false);
CREATE INDEX outbox_due ON outbox (next_at) WHERE NOT done;

CREATE TABLE inbox (event_id text PRIMARY KEY, body jsonb NOT NULL, processed boolean NOT NULL DEFAULT false);
