DROP TABLE IF EXISTS payments, idempotency_keys;

CREATE TABLE payments (
  id          bigserial PRIMARY KEY,
  customer_id text   NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id               bigserial PRIMARY KEY,
  owner_id         text NOT NULL,                 -- keys are scoped per API client
  key              text NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
  request_method   text NOT NULL,
  request_path     text NOT NULL,
  request_hash     text NOT NULL,                 -- fingerprint of the request body
  status           text NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'completed')),
  locked_at        timestamptz,                   -- set while a worker owns the key
  response_code    int,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
