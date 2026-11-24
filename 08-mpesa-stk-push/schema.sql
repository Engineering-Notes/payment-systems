DROP TABLE IF EXISTS fulfilments, mpesa_callbacks, payments;

CREATE TABLE payments (
  id                  bigserial PRIMARY KEY,
  order_ref           text NOT NULL,
  phone               text NOT NULL,
  amount              integer NOT NULL CHECK (amount > 0),          -- whole shillings
  checkout_request_id text UNIQUE,
  status              text NOT NULL DEFAULT 'initiated'
                      CHECK (status IN ('initiated','pending','paid','failed')),
  result_code         integer,
  result_desc         text,
  mpesa_receipt       text UNIQUE,                                    -- one receipt, one payment
  resolved_by         text,                                           -- 'callback' or 'query'
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_pending ON payments (created_at) WHERE status = 'pending';

-- Every callback body is kept, accepted or not, for audit and reconciliation.
CREATE TABLE mpesa_callbacks (
  id                  bigserial PRIMARY KEY,
  checkout_request_id text,
  body                jsonb NOT NULL,
  outcome             text NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now()
);

-- Stands in for "ship the order". Must happen at most once per payment.
CREATE TABLE fulfilments (
  payment_id bigint NOT NULL REFERENCES payments(id),
  fulfilled_at timestamptz NOT NULL DEFAULT now()
);
