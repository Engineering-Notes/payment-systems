DROP TABLE IF EXISTS payments, outbox;

CREATE TABLE payments (
  id          bigserial PRIMARY KEY,
  customer_id text   NOT NULL,
  amount      bigint NOT NULL,
  currency    char(3) NOT NULL,
  status      text   NOT NULL DEFAULT 'captured',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id             bigserial PRIMARY KEY,
  event_id       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,          -- e.g. 'payment'
  aggregate_id   text NOT NULL,          -- e.g. the payment id
  event_type     text NOT NULL,          -- e.g. 'payment.captured'
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,            -- NULL until the relay has delivered it
  attempts       int NOT NULL DEFAULT 0,
  last_error     text
);
-- The relay only ever scans unpublished rows, so index exactly those.
CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL;
