// PostgreSQL isolation levels by experiment: lost updates, write skew, inconsistent reads, and the cost of each fix.
import pg from 'pg';
import { inTx, sleep } from './tx.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/isolation', max: 60 });
const q = (sql, p) => pool.query(sql, p);
const RC = 'READ COMMITTED', RR = 'REPEATABLE READ', SER = 'SERIALIZABLE';
const pad = (s, n) => String(s).padEnd(n);
const results = {};

// 1. LOST UPDATE: 50 concurrent withdrawals of 10 from a balance of 1,000. Correct final balance: 500.
async function lostUpdate(name, level, body, maxRetries = 0) {
  await q('DROP TABLE IF EXISTS accounts; CREATE TABLE accounts (id int PRIMARY KEY, balance int NOT NULL)');
  await q('INSERT INTO accounts VALUES (1, 1000)');
  const stats = { serializationFailures: 0, retries: 0 }; let failed = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 50 }, () => inTx(pool, level, body, { maxRetries, stats }).catch(() => failed++)));
  const { rows: [a] } = await q('SELECT balance FROM accounts WHERE id = 1');
  return { name, balance: a.balance, failed, ...stats, ms: Date.now() - t0 };
}
const readThenWrite = async (c) => {
  const { rows: [a] } = await c.query('SELECT balance FROM accounts WHERE id = 1');
  await sleep(5);                                                  // application logic between read and write
  await c.query('UPDATE accounts SET balance = $1 WHERE id = 1', [a.balance - 10]);
};
const forUpdate = async (c) => {
  const { rows: [a] } = await c.query('SELECT balance FROM accounts WHERE id = 1 FOR UPDATE');
  await sleep(5);
  await c.query('UPDATE accounts SET balance = $1 WHERE id = 1', [a.balance - 10]);
};
const atomic = async (c) => { await sleep(5); await c.query('UPDATE accounts SET balance = balance - 10 WHERE id = 1'); };

console.log('1 LOST UPDATE: 50 concurrent withdrawals of 10 from 1,000 (correct final balance 500)');
console.log('  approach                                    final  failed  40001 errors  retries   time');
const lu = [
  await lostUpdate('Read Committed, read then write', RC, readThenWrite),
  await lostUpdate('Repeatable Read, no retry', RR, readThenWrite),
  await lostUpdate('Repeatable Read, retry on 40001', RR, readThenWrite, 100),
  await lostUpdate('Read Committed, SELECT ... FOR UPDATE', RC, forUpdate),
  await lostUpdate('Read Committed, balance = balance - 10', RC, atomic),
];
for (const r of lu) console.log(`  ${pad(r.name, 42)} ${String(r.balance).padStart(6)} ${String(r.failed).padStart(7)} ${String(r.serializationFailures).padStart(13)} ${String(r.retries).padStart(8)} ${String(r.ms + ' ms').padStart(7)}`);
results.lostUpdate = lu;

// 2. WRITE SKEW: two linked accounts must keep a combined balance >= 0. Each holds 100.
// Two transactions each check the combined balance (200), then withdraw 150 from a different account.
async function writeSkew(level, rounds = 50) {
  let violations = 0, aborted = 0;
  for (let i = 0; i < rounds; i++) {
    await q('DROP TABLE IF EXISTS linked; CREATE TABLE linked (id int PRIMARY KEY, owner int NOT NULL, balance int NOT NULL)');
    await q('INSERT INTO linked VALUES (1, 7, 100), (2, 7, 100)');
    const withdraw = (acct) => inTx(pool, level, async (c) => {
      const { rows: [s] } = await c.query('SELECT sum(balance)::int AS total FROM linked WHERE owner = 7');
      await sleep(5);
      if (s.total - 150 < 0) throw new Error('insufficient');
      await c.query('UPDATE linked SET balance = balance - 150 WHERE id = $1', [acct]);
    }).catch((e) => { if (e.code === '40001') aborted++; });
    await Promise.all([withdraw(1), withdraw(2)]);
    const { rows: [s] } = await q('SELECT sum(balance)::int AS total FROM linked');
    if (s.total < 0) violations++;
  }
  return { violations, aborted, rounds };
}
console.log('\n2 WRITE SKEW: two linked accounts of 100, rule "combined balance >= 0", two concurrent withdrawals of 150, 50 rounds');
for (const [n, l] of [['Read Committed', RC], ['Repeatable Read', RR], ['Serializable', SER]]) {
  const r = await writeSkew(l);
  console.log(`  ${pad(n, 16)} rule broken in ${String(r.violations).padStart(2)} of ${r.rounds} rounds | transactions aborted with 40001: ${r.aborted}`);
  results['writeSkew_' + n] = r;
}

// 3. INCONSISTENT READS: a report sums 100 accounts with two queries while transfers move money between them.
// The true total never changes (100,000).
async function report(level) {
  await q('DROP TABLE IF EXISTS wallets; CREATE TABLE wallets (id int PRIMARY KEY, balance int NOT NULL)');
  await q('INSERT INTO wallets SELECT g, 1000 FROM generate_series(1, 100) g');
  let stop = false, transfers = 0;
  const mover = (async () => {
    while (!stop) {
      const a = 1 + Math.floor(Math.random() * 50), b = 51 + Math.floor(Math.random() * 50); // first half -> second half
      await inTx(pool, RC, async (c) => {
        await c.query('UPDATE wallets SET balance = balance - 5 WHERE id = $1', [a]);
        await c.query('UPDATE wallets SET balance = balance + 5 WHERE id = $1', [b]);
      }); transfers++;
    }
  })();
  const movers = [mover, ...Array.from({ length: 7 }, () => (async () => { while (!stop) { const a = 1 + Math.floor(Math.random() * 50), b = 51 + Math.floor(Math.random() * 50);
    await inTx(pool, RC, async (c) => { await c.query('UPDATE wallets SET balance = balance - 5 WHERE id = $1', [a]); await c.query('UPDATE wallets SET balance = balance + 5 WHERE id = $1', [b]); }); transfers++; } })())];
  let wrong = 0, maxOff = 0; const N = 300;
  for (let i = 0; i < N; i++) {
    const total = await inTx(pool, level, async (c) => {
      const { rows: [x] } = await c.query('SELECT sum(balance)::int s FROM wallets WHERE id <= 50');
      await sleep(2);
      const { rows: [y] } = await c.query('SELECT sum(balance)::int s FROM wallets WHERE id > 50');
      return x.s + y.s;
    });
    if (total !== 100000) { wrong++; maxOff = Math.max(maxOff, Math.abs(total - 100000)); }
  }
  stop = true; await Promise.all(movers);
  return { wrong, N, maxOff, transfers };
}
console.log('\n3 INCONSISTENT READS: 300 reports sum 100 wallets in two queries while 8 workers transfer money (true total 100,000)');
for (const [n, l] of [['Read Committed', RC], ['Repeatable Read', RR]]) {
  const r = await report(l);
  console.log(`  ${pad(n, 16)} reports with the wrong total: ${String(r.wrong).padStart(3)} of ${r.N} | largest error ${r.maxOff} | transfers during the run ${r.transfers}`);
  results['report_' + n] = r;
}

// 4. COST: 2,000 transfers between 20 hot accounts, 40 concurrent workers, at each level with retries.
async function cost(level) {
  await q('DROP TABLE IF EXISTS hot; CREATE TABLE hot (id int PRIMARY KEY, balance int NOT NULL)');
  await q('INSERT INTO hot SELECT g, 100000 FROM generate_series(1, 20) g');
  const stats = { serializationFailures: 0, retries: 0 }; let done = 0, gaveUp = 0;
  const t0 = Date.now();
  const work = Array.from({ length: 2000 }, (_, i) => [1 + (i * 7) % 20, 1 + (i * 13 + 5) % 20]).filter(([a, b]) => a !== b);
  let next = 0;
  await Promise.all(Array.from({ length: 40 }, async () => {
    while (next < work.length) {
      const [a, b] = work[next++];
      await inTx(pool, level, async (c) => {
        const { rows: [x] } = await c.query('SELECT balance FROM hot WHERE id = $1', [a]);
        if (x.balance < 10) return;
        for (const id of (a < b ? [a, b] : [b, a])) {                   // update in id order to avoid deadlocks
          await c.query('UPDATE hot SET balance = balance + $2 WHERE id = $1', [id, id === a ? -10 : 10]);
        }
      }, { maxRetries: 50, stats }).then(() => done++, () => gaveUp++);
    }
  }));
  const ms = Date.now() - t0;
  const { rows: [s] } = await q('SELECT sum(balance)::int t FROM hot');
  return { level, done, gaveUp, ms, tps: Math.round(done / (ms / 1000)), ...stats, total: s.t };
}
console.log('\n4 COST: 1,900 transfers among 20 hot accounts, 40 workers, retry on 40001');
for (const [n, l] of [['Read Committed', RC], ['Repeatable Read', RR], ['Serializable', SER]]) {
  const r = await cost(l);
  console.log(`  ${pad(n, 16)} ${String(r.tps).padStart(5)} transfers/s | serialization failures and deadlocks ${String(r.serializationFailures).padStart(5)} | gave up ${r.gaveUp} | total preserved: ${r.total === 2000000}`);
  results['cost_' + n] = r;
}
await pool.end();
export default results;

// CI gate: the safe approaches must be correct on every run.
const ok = results.lostUpdate.slice(2).every((r) => r.balance === 500)
  && results['writeSkew_Serializable'].violations === 0
  && results['report_Repeatable Read'].wrong === 0
  && ['Read Committed', 'Repeatable Read', 'Serializable'].every((n) => results['cost_' + n].total === 2000000);
if (!ok) { console.error('a safe approach produced a wrong result'); process.exit(1); }
