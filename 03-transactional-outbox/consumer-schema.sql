DROP TABLE IF EXISTS inbox, receipts;

-- Every delivery attempt that reached the consumer, duplicates included.
CREATE TABLE receipts (
  id        bigserial PRIMARY KEY,
  event_id  uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- The inbox: one row per event the consumer has processed.
CREATE TABLE inbox (
  event_id     uuid PRIMARY KEY,
  event_type   text NOT NULL,
  payload      jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
