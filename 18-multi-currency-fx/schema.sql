DROP TABLE IF EXISTS entries, transactions;
CREATE TABLE transactions (id bigserial PRIMARY KEY, memo text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE entries (
  id       bigserial PRIMARY KEY,
  txn_id   bigint NOT NULL REFERENCES transactions(id),
  account  text NOT NULL,
  currency char(3) NOT NULL,
  amount   bigint NOT NULL            -- minor units; debit positive, credit negative
);
-- Every transaction must balance in each currency separately. Checked at commit.
CREATE OR REPLACE FUNCTION check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM entries WHERE txn_id = NEW.txn_id GROUP BY currency HAVING sum(amount) <> 0) THEN
    RAISE EXCEPTION 'transaction % does not balance in every currency', NEW.txn_id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entries_balanced AFTER INSERT ON entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_balanced();
