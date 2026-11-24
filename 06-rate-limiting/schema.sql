DROP TABLE IF EXISTS rate_limits;

-- One row per client and policy. Token bucket state lives in the database,
-- so every application instance shares the same bucket.
CREATE TABLE rate_limits (
  key         text PRIMARY KEY,
  tokens      double precision NOT NULL,
  capacity    double precision NOT NULL,
  refill_rate double precision NOT NULL,     -- tokens per second
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Take one token if available. Returns the tokens left, or NULL when limited.
-- The UPDATE locks the row, so concurrent calls for the same key run one at a time.
CREATE OR REPLACE FUNCTION take_token(p_key text, p_capacity double precision, p_rate double precision)
RETURNS double precision LANGUAGE plpgsql AS $$
DECLARE v_left double precision;
BEGIN
  INSERT INTO rate_limits (key, tokens, capacity, refill_rate)
  VALUES (p_key, p_capacity, p_capacity, p_rate)
  ON CONFLICT (key) DO NOTHING;

  UPDATE rate_limits
     SET tokens = LEAST(capacity, tokens + EXTRACT(EPOCH FROM clock_timestamp() - updated_at) * refill_rate) - 1,
         updated_at = clock_timestamp()
   WHERE key = p_key
     AND LEAST(capacity, tokens + EXTRACT(EPOCH FROM clock_timestamp() - updated_at) * refill_rate) >= 1
  RETURNING tokens INTO v_left;

  RETURN v_left;
END $$;
