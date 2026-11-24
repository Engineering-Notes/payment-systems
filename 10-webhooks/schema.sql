DROP TABLE IF EXISTS ledger_entries, payments, webhook_inbox;

-- Every verified delivery lands here first. The webhook-id is the primary key, so duplicates are dropped.
CREATE TABLE webhook_inbox (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX webhook_inbox_unprocessed ON webhook_inbox (received_at) WHERE processed_at IS NULL;

CREATE TABLE payments (
  id       text PRIMARY KEY,
  status   text NOT NULL,
  amount   integer NOT NULL,
  version  integer NOT NULL
);

-- What the merchant is owed. The robust receiver allows one credit and one debit per payment.
CREATE TABLE ledger_entries (
  id         bigserial PRIMARY KEY,
  payment_id text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('credit', 'debit')),
  amount     integer NOT NULL,
  source     text
);
