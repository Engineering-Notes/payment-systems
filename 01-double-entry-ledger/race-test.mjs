// Fires 50 concurrent withdrawals of KES 300 at a wallet holding KES 10,000.
// Correct outcome: exactly 33 succeed, 17 are rejected, the wallet ends at KES 100.
import fs from 'node:fs';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/ledger',
  max: 50,
});

const ATTEMPTS = 50;
const AMOUNT = 300_00;      // KES 300.00 in cents
const OPENING = 10_000_00;  // KES 10,000.00 in cents

async function naive() {
  await pool.query(`
    DROP TABLE IF EXISTS naive_wallets;
    CREATE TABLE naive_wallets (id int PRIMARY KEY, balance bigint NOT NULL);
    INSERT INTO naive_wallets VALUES (1, ${OPENING});`);

  const withdraw = async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query('SELECT balance FROM naive_wallets WHERE id = 1');
      if (rows[0].balance < AMOUNT) throw new Error('insufficient funds');
      await c.query('UPDATE naive_wallets SET balance = $1 WHERE id = 1',
                    [rows[0].balance - AMOUNT]);
      await c.query('COMMIT');
      return true;
    } catch {
      await c.query('ROLLBACK');
      return false;
    } finally {
      c.release();
    }
  };

  const results = await Promise.all(Array.from({ length: ATTEMPTS }, withdraw));
  const ok = results.filter(Boolean).length;
  const { rows } = await pool.query('SELECT balance FROM naive_wallets WHERE id = 1');
  const actual = Number(rows[0].balance);
  const expected = OPENING - ok * AMOUNT;
  console.log('NAIVE  succeeded:', ok, '| stored balance:', actual / 100,
              '| balance implied by successes:', expected / 100,
              '| payouts missing from balance:', (actual - expected) / 100);
}

async function ledger() {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await pool.query(`SET search_path = ledger;
    SELECT open_account('cash:bank:KES', 'asset', 'KES');
    SELECT open_account('wallet:user_42:KES', 'liability', 'KES');
    SELECT post_entry('deposit-1', 'Opening deposit', '[
      {"account":"cash:bank:KES","direction":"debit","amount":${OPENING}},
      {"account":"wallet:user_42:KES","direction":"credit","amount":${OPENING}}]');`);

  const withdraw = async (i) => {
    const c = await pool.connect();
    try {
      await c.query('SET search_path = ledger');
      await c.query('BEGIN');
      await c.query(`SELECT post_entry($1, 'Withdrawal', $2::jsonb)`, [
        `withdrawal-${i}`,
        JSON.stringify([
          { account: 'wallet:user_42:KES', direction: 'debit', amount: AMOUNT },
          { account: 'cash:bank:KES', direction: 'credit', amount: AMOUNT },
        ]),
      ]);
      await c.query('COMMIT');
      return true;
    } catch (e) {
      await c.query('ROLLBACK');
      if (!/insufficient funds/.test(e.message)) throw e;
      return false;
    } finally {
      c.release();
    }
  };

  const results = await Promise.all(Array.from({ length: ATTEMPTS }, (_, i) => withdraw(i)));
  const ok = results.filter(Boolean).length;

  const { rows: [b] } = await pool.query(`SET search_path = ledger;
    SELECT signed_balance(a.type, b.debits_posted, b.credits_posted) AS bal
      FROM accounts a JOIN account_balances b ON b.account_id = a.id
     WHERE a.code = 'wallet:user_42:KES'`).then(r => r[1]);

  const { rows: [inv] } = await pool.query(`
    SELECT sum(CASE WHEN direction = 'debit' THEN amount ELSE -amount END) AS net
      FROM ledger.postings`);

  const { rows: [rebuilt] } = await pool.query(
    `SELECT ledger.balance_at('wallet:user_42:KES', now()) AS bal`);

  console.log('LEDGER succeeded:', ok, '| rejected:', ATTEMPTS - ok,
              '| wallet balance:', Number(b.bal) / 100,
              '| rebuilt from journal:', Number(rebuilt.bal) / 100,
              '| sum(debits - credits) across ledger:', Number(inv.net));

  // Idempotency: replaying a request returns the same entry and moves no money.
  const r1 = await pool.query(`SELECT ledger.post_entry('withdrawal-0', 'retry', $1::jsonb) AS id`,
    [JSON.stringify([
      { account: 'wallet:user_42:KES', direction: 'debit', amount: AMOUNT },
      { account: 'cash:bank:KES', direction: 'credit', amount: AMOUNT }])]);
  const { rows: [after] } = await pool.query(
    `SELECT ledger.balance_at('wallet:user_42:KES', now()) AS bal`);
  console.log('RETRY  replay of withdrawal-0 returned entry', r1.rows[0].id,
              '| balance unchanged:', Number(after.bal) / 100);

  // Immutability: try to edit history.
  try {
    await pool.query('UPDATE ledger.postings SET amount = 1 WHERE id = 1');
  } catch (e) {
    console.log('IMMUTABLE', e.message);
  }

  // Balance enforcement: an unbalanced entry is rejected at commit.
  try {
    await pool.query(`SELECT ledger.post_entry('bad-1', 'Unbalanced', '[
      {"account":"cash:bank:KES","direction":"debit","amount":500},
      {"account":"wallet:user_42:KES","direction":"credit","amount":400}]')`);
  } catch (e) {
    console.log('BALANCED', e.message);
  }
}

await naive();
await ledger();
await pool.end();
