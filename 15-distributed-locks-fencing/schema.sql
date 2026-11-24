DROP TABLE IF EXISTS payout_writes, payout_files, leases;
DROP SEQUENCE IF EXISTS fencing_tokens;

-- A lease-based lock. Every grant gets a strictly increasing fencing token.
CREATE SEQUENCE fencing_tokens;
CREATE TABLE leases (
  name       text PRIMARY KEY,
  holder     text NOT NULL,
  token      bigint NOT NULL,
  expires_at timestamptz NOT NULL
);

-- The protected resource: one payout file per merchant per day, sent to the bank.
-- `max_token` is what lets the resource refuse writes from a holder whose lease has been superseded.
CREATE TABLE payout_files (
  job        text PRIMARY KEY,
  max_token  bigint NOT NULL DEFAULT 0,
  writer     text,
  sent_count integer NOT NULL DEFAULT 0
);
-- Every write that was accepted, for counting.
CREATE TABLE payout_writes (
  job    text NOT NULL,
  writer text NOT NULL,
  token  bigint NOT NULL,
  stale  boolean NOT NULL         -- true if the writer's lease had already expired when it wrote
);
