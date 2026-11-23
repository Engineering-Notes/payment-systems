-- Double-entry ledger schema for PostgreSQL 16
-- Amounts are integers in minor units (cents). Never floats.

DROP SCHEMA IF EXISTS ledger CASCADE;
CREATE SCHEMA ledger;
SET search_path = ledger;

CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE direction AS ENUM ('debit', 'credit');

CREATE TABLE accounts (
  id             bigserial PRIMARY KEY,
  code           text NOT NULL UNIQUE,          -- e.g. 'wallet:user_42:KES'
  type           account_type NOT NULL,
  currency       char(3) NOT NULL,              -- ISO 4217
  allow_negative boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Assets and expenses grow with debits. Everything else grows with credits.
CREATE FUNCTION normal_side(t account_type) RETURNS direction
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t IN ('asset', 'expense') THEN 'debit'::direction
              ELSE 'credit'::direction END
$$;

CREATE TABLE journal_entries (
  id                bigserial PRIMARY KEY,
  idempotency_key   text NOT NULL UNIQUE,
  description       text NOT NULL,
  effective_at      timestamptz NOT NULL DEFAULT now(),
  reverses_entry_id bigint REFERENCES journal_entries(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE postings (
  id         bigserial PRIMARY KEY,
  entry_id   bigint NOT NULL REFERENCES journal_entries(id),
  account_id bigint NOT NULL REFERENCES accounts(id),
  direction  direction NOT NULL,
  amount     bigint NOT NULL CHECK (amount > 0),
  currency   char(3) NOT NULL
);
CREATE INDEX postings_account_idx ON postings (account_id, entry_id);

-- Cached running totals. Derived data: can always be rebuilt from postings.
CREATE TABLE account_balances (
  account_id     bigint PRIMARY KEY REFERENCES accounts(id),
  debits_posted  bigint NOT NULL DEFAULT 0,
  credits_posted bigint NOT NULL DEFAULT 0,
  version        bigint NOT NULL DEFAULT 0
);

-- Rule 1: the ledger is append-only.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER postings_immutable BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Rule 2: every entry balances, per currency, checked at commit time.
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad record;
BEGIN
  SELECT currency,
         sum(CASE WHEN direction = 'debit' THEN amount ELSE 0 END) AS dr,
         sum(CASE WHEN direction = 'credit' THEN amount ELSE 0 END) AS cr
    INTO bad
    FROM postings
   WHERE entry_id = NEW.entry_id
   GROUP BY currency
  HAVING sum(CASE WHEN direction = 'debit' THEN amount ELSE -amount END) <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'entry % unbalanced in %: debits % credits %',
      NEW.entry_id, bad.currency, bad.dr, bad.cr;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- Rule 3: a posting's currency must match its account.
CREATE FUNCTION check_posting_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency <> (SELECT currency FROM accounts WHERE id = NEW.account_id) THEN
    RAISE EXCEPTION 'posting currency % does not match account %', NEW.currency, NEW.account_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER postings_currency BEFORE INSERT ON postings
  FOR EACH ROW EXECUTE FUNCTION check_posting_currency();

-- Balance in the account's natural direction.
CREATE FUNCTION signed_balance(t account_type, dr bigint, cr bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN normal_side(t) = 'debit' THEN dr - cr ELSE cr - dr END
$$;

-- The only write path into the ledger.
-- p_postings: [{"account":"code","direction":"debit","amount":1000}, ...]
CREATE FUNCTION post_entry(
  p_idempotency_key text,
  p_description     text,
  p_postings        jsonb,
  p_reverses        bigint DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id bigint;
  p          record;
  acc        record;
BEGIN
  -- Idempotency: a retried request returns the original entry.
  -- If two retries race, the second waits on the unique index, then sees the conflict.
  INSERT INTO journal_entries (idempotency_key, description, reverses_entry_id)
  VALUES (p_idempotency_key, p_description, p_reverses)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_entry_id;

  IF v_entry_id IS NULL THEN
    SELECT id INTO v_entry_id FROM journal_entries WHERE idempotency_key = p_idempotency_key;
    RETURN v_entry_id;
  END IF;

  -- Lock every touched balance row in a fixed order (by account id)
  -- so two entries touching the same accounts can never deadlock.
  PERFORM 1
     FROM account_balances b
     JOIN accounts a ON a.id = b.account_id
    WHERE a.code IN (SELECT x->>'account' FROM jsonb_array_elements(p_postings) x)
    ORDER BY b.account_id
      FOR UPDATE OF b;

  FOR p IN
    SELECT x->>'account' AS code,
           (x->>'direction')::direction AS dir,
           (x->>'amount')::bigint AS amount
      FROM jsonb_array_elements(p_postings) x
  LOOP
    SELECT * INTO acc FROM accounts WHERE code = p.code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown account %', p.code;
    END IF;

    INSERT INTO postings (entry_id, account_id, direction, amount, currency)
    VALUES (v_entry_id, acc.id, p.dir, p.amount, acc.currency);

    UPDATE account_balances
       SET debits_posted  = debits_posted  + CASE WHEN p.dir = 'debit'  THEN p.amount ELSE 0 END,
           credits_posted = credits_posted + CASE WHEN p.dir = 'credit' THEN p.amount ELSE 0 END,
           version        = version + 1
     WHERE account_id = acc.id;
  END LOOP;

  -- Overdraft check after all postings, while the rows are still locked.
  FOR acc IN
    SELECT a.code, a.type, b.debits_posted, b.credits_posted
      FROM accounts a JOIN account_balances b ON b.account_id = a.id
     WHERE a.code IN (SELECT x->>'account' FROM jsonb_array_elements(p_postings) x)
       AND NOT a.allow_negative
  LOOP
    IF signed_balance(acc.type, acc.debits_posted, acc.credits_posted) < 0 THEN
      RAISE EXCEPTION 'insufficient funds in %', acc.code USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN v_entry_id;
END $$;

-- A reversal is a new entry with every posting flipped. Nothing is deleted.
CREATE FUNCTION reverse_entry(p_entry_id bigint, p_idempotency_key text, p_reason text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_postings jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'account', a.code,
           'direction', CASE WHEN p.direction = 'debit' THEN 'credit' ELSE 'debit' END,
           'amount', p.amount))
    INTO v_postings
    FROM postings p JOIN accounts a ON a.id = p.account_id
   WHERE p.entry_id = p_entry_id;

  RETURN post_entry(p_idempotency_key, p_reason, v_postings, p_entry_id);
END $$;

-- Balance of any account at any moment, rebuilt from the journal alone.
CREATE FUNCTION balance_at(p_code text, p_at timestamptz) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT signed_balance(a.type,
           coalesce(sum(p.amount) FILTER (WHERE p.direction = 'debit'), 0)::bigint,
           coalesce(sum(p.amount) FILTER (WHERE p.direction = 'credit'), 0)::bigint)
    FROM accounts a
    LEFT JOIN postings p ON p.account_id = a.id
    LEFT JOIN journal_entries e ON e.id = p.entry_id
   WHERE a.code = p_code
     AND (e.effective_at IS NULL OR e.effective_at <= p_at)
   GROUP BY a.type
$$;

-- Helper to open an account with its balance row.
CREATE FUNCTION open_account(p_code text, p_type account_type, p_currency char(3),
                             p_allow_negative boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO accounts (code, type, currency, allow_negative)
  VALUES (p_code, p_type, p_currency, p_allow_negative) RETURNING id INTO v_id;
  INSERT INTO account_balances (account_id) VALUES (v_id);
  RETURN v_id;
END $$;
