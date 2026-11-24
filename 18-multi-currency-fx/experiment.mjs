import fs from 'node:fs';
import pg from 'pg';
import { EXPONENT, toMinor, format, convert, divRound, allocate } from './money.mjs';

let seed = 4; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// 1. Floating point against integer minor units.
console.log('1 FLOATS: one million payments of KES 33.33, summed');
{
  let f = 0; for (let i = 0; i < 1_000_000; i++) f += 33.33;
  let m = 0n; for (let i = 0; i < 1_000_000; i++) m += 3333n;
  console.log(`  float sum      ${f.toFixed(10)}`);
  console.log(`  integer sum    ${format(m, 'KES')}`);
  console.log(`  0.1 + 0.2 === 0.3 in floating point: ${0.1 + 0.2 === 0.3}`);
}

// 2. Assuming every currency has two decimal places.
console.log('\n2 MINOR UNITS: the same customer intent, "charge 1,500", with a hard-coded "multiply by 100"');
for (const c of ['KES', 'JPY', 'BHD']) {
  const right = toMinor('1500', c), wrong = 1500n * 100n;
  console.log(`  ${c} exponent ${EXPONENT[c]}: correct amount ${String(right).padStart(8)} minor units | hard-coded x100 sends ${String(wrong).padStart(7)} = ${format(wrong, c)}`);
}

// 3. Rounding when converting many small amounts, and when splitting.
console.log('\n3 ROUNDING: 100,000 conversions from USD to KES at 129.2537');
{
  const rate = '129.2537';
  let exact = 0n, halfUp = 0n, halfEven = 0n, truncated = 0n; const den = 10000n;
  let totalUsd = 0n;
  for (let i = 0; i < 100_000; i++) {
    const usd = BigInt(1 + Math.floor(rand() * 5000));                // 0.01 to 50.00 USD
    totalUsd += usd;
    const num = usd * 1292537n;                                        // KES cents x 10^4
    exact += num; halfUp += divRound(num, den, 'half-up'); halfEven += divRound(num, den, 'half-even'); truncated += num / den;
  }
  const exactKes = divRound(exact, den, 'half-even');
  console.log(`  converting the total once   ${format(exactKes, 'KES')}`);
  console.log(`  each one, half-even         ${format(halfEven, 'KES')}  difference ${format(halfEven - exactKes, 'KES')}`);
  console.log(`  each one, half-up           ${format(halfUp, 'KES')}  difference ${format(halfUp - exactKes, 'KES')}`);
  console.log(`  each one, truncated         ${format(truncated, 'KES')}  difference ${format(truncated - exactKes, 'KES')}`);
  const split = allocate(10000n, [1n, 1n, 1n]);
  console.log(`  KES 100.00 split three ways: naive ${[1, 2, 3].map(() => format(10000n / 3n, 'KES')).join(' + ')} = ${format((10000n / 3n) * 3n, 'KES')} | allocate ${split.map((p) => format(p, 'KES')).join(' + ')} = ${format(split.reduce((a, b) => a + b), 'KES')}`);
}

// 4. A multi-currency double-entry ledger with an FX position account and month-end revaluation.
console.log('\n4 MULTI-CURRENCY LEDGER');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/fx' });
await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const post = async (memo, lines) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [t] } = await c.query('INSERT INTO transactions (memo) VALUES ($1) RETURNING id', [memo]);
    for (const [account, currency, amount] of lines) await c.query('INSERT INTO entries (txn_id, account, currency, amount) VALUES ($1, $2, $3, $4)', [t.id, account, currency, String(amount)]);
    await c.query('COMMIT');
    return 'posted';
  } catch (e) { await c.query('ROLLBACK'); return 'rejected: ' + e.message; } finally { c.release(); }
};
// A customer deposits 100.00 USD, converts it to KES at 129.25, and the platform keeps a 1% FX margin.
console.log('  deposit 100.00 USD         ', await post('deposit', [['bank:usd', 'USD', 10000n], ['customer:amina', 'USD', -10000n]]));
const kes = convert(10000n, 'USD', 'KES', '129.25'), margin = divRound(kes, 100n, 'half-even');
console.log('  convert at 129.25, 1% fee  ', await post('fx conversion', [
  ['customer:amina', 'USD', 10000n], ['fx:position', 'USD', -10000n],                 // USD leaves the customer, enters the FX book
  ['fx:position', 'KES', kes], ['customer:amina', 'KES', -(kes - margin)], ['revenue:fx', 'KES', -margin]]));
console.log('  a conversion that mixes currencies in one sum',
  await post('bad', [['customer:amina', 'USD', 10000n], ['customer:amina', 'KES', -1292500n]]));
const bal = async () => (await pool.query(`SELECT account, currency, sum(amount) AS balance FROM entries GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
console.log('  balances (debit positive, credit negative):');
for (const r of await bal()) console.log(`    ${r.account.padEnd(16)} ${format(BigInt(r.balance), r.currency).padStart(16)}`);
// Month end: the FX book holds +100.00 USD (owed to it in USD terms) against -12,925.00 KES. Revalue USD at the closing rate.
const { rows: [pos] } = await pool.query(`SELECT sum(amount) FILTER (WHERE currency='USD') AS usd, sum(amount) FILTER (WHERE currency='KES') AS kes FROM entries WHERE account='fx:position'`);
for (const close of ['129.25', '131.00', '127.50']) {
  const usdInKes = convert(-BigInt(pos.usd), 'USD', 'KES', close);      // the 100.00 USD the FX book holds, valued at the closing rate
  console.log(`  revalue at ${close}: FX book holds ${format(-BigInt(pos.usd), 'USD')} worth ${format(usdInKes, 'KES')} against ${format(BigInt(pos.kes), 'KES')} paid out | unrealised ${format(usdInKes - BigInt(pos.kes), 'KES')}`);
}
const gain = convert(-BigInt(pos.usd), 'USD', 'KES', '131.00') - BigInt(pos.kes);
console.log('  post month-end revaluation at 131.00', await post('revaluation 131.00', [['fx:revaluation', 'KES', gain], ['revenue:fx-revaluation', 'KES', -gain]]));
const { rows: chk } = await pool.query(`SELECT currency, sum(amount)::bigint AS s FROM entries GROUP BY 1`);
console.log(`  every currency sums to zero across the ledger: ${chk.every((r) => r.s === '0')}`);
await pool.end();
if (!chk.every((r) => r.s === '0')) process.exit(1);
