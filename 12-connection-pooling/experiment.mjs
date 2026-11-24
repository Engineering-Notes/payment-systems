// Connection pooling under load, on PostgreSQL 16 (max_connections = 100) running on a 2-core machine.
import pg from 'pg';

const URL = process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/pooling';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const results = {};

// Run `total` requests with `concurrency` in flight. Each request is `fn()`; returns latencies in ms.
async function load(total, concurrency, fn) {
  const lat = []; let next = 0, errors = 0; const errs = {};
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      next++; const s = performance.now();
      try { await fn(); lat.push(performance.now() - s); }
      catch (e) { errors++; errs[e.message.slice(0, 40)] = (errs[e.message.slice(0, 40)] ?? 0) + 1; }
    }
  }));
  const secs = (performance.now() - t0) / 1000;
  return { rps: Math.round(lat.length / secs), p50: pct(lat, 50)?.toFixed(1), p99: pct(lat, 99)?.toFixed(1), errors, errs, secs };
}

const admin = new pg.Pool({ connectionString: URL, max: 2 });
await admin.query('DROP TABLE IF EXISTS accounts; CREATE TABLE accounts (id int PRIMARY KEY, balance bigint NOT NULL)');
await admin.query('INSERT INTO accounts SELECT g, 1000000 FROM generate_series(1, 10000) g');

// 1. A new connection for every request against a pool.
console.log('1 CONNECTION PER REQUEST vs POOL: 2,000 single-row reads, 20 in flight');
{
  const perReq = await load(2000, 20, async () => {
    const c = new pg.Client({ connectionString: URL }); await c.connect();
    try { await c.query('SELECT balance FROM accounts WHERE id = $1', [1 + Math.floor(Math.random() * 10000)]); } finally { await c.end(); }
  });
  const pool = new pg.Pool({ connectionString: URL, max: 10 });
  const pooled = await load(2000, 20, () => pool.query('SELECT balance FROM accounts WHERE id = $1', [1 + Math.floor(Math.random() * 10000)]));
  await pool.end();
  console.log(`  new connection each time  ${String(perReq.rps).padStart(6)} req/s | p50 ${perReq.p50} ms | p99 ${perReq.p99} ms`);
  console.log(`  pool of 10                ${String(pooled.rps).padStart(6)} req/s | p50 ${pooled.p50} ms | p99 ${pooled.p99} ms`);
  results.perRequest = { perReq, pooled };
}

// 2. Pool size sweep. 200 requests in flight; each runs a short transaction that does real CPU work.
console.log('\n2 POOL SIZE SWEEP: 3,000 transfers, 200 in flight, 2 CPU cores on the database');
const transfer = (pool) => async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const a = 1 + Math.floor(Math.random() * 10000), b = 1 + Math.floor(Math.random() * 10000);
    await c.query('SELECT sum(i) FROM generate_series(1, 20000) i');           // stands in for real query work
    await c.query('UPDATE accounts SET balance = balance - 1 WHERE id = $1', [a]);
    await c.query('UPDATE accounts SET balance = balance + 1 WHERE id = $1', [b]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
};
results.sweep = [];
for (const size of [1, 2, 4, 8, 16, 32, 64]) {
  const pool = new pg.Pool({ connectionString: URL, max: size });
  await Promise.all(Array.from({ length: size }, () => pool.query('SELECT 1')));   // warm up
  const r = await load(3000, 200, transfer(pool));
  await pool.end();
  results.sweep.push({ size, ...r });
  console.log(`  pool ${String(size).padStart(2)}  ${String(r.rps).padStart(5)} transfers/s | p50 ${String(r.p50).padStart(6)} ms | p99 ${String(r.p99).padStart(6)} ms`);
}

// 3. Holding a connection across a slow external call.
console.log('\n3 HOLDING A CONNECTION DURING AN EXTERNAL CALL: 500 payments, 100 in flight, pool of 10, provider call 200 ms');
const provider = () => sleep(200);
{
  const pool = new pg.Pool({ connectionString: URL, max: 10 });
  const inside = await load(500, 100, async () => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); await c.query('UPDATE accounts SET balance = balance - 1 WHERE id = 1 + (random() * 9999)::int');
      await provider(); await c.query('COMMIT'); } finally { c.release(); }
  });
  const outside = await load(500, 100, async () => {
    await provider();
    await pool.query('UPDATE accounts SET balance = balance - 1 WHERE id = 1 + (random() * 9999)::int');
  });
  await pool.end();
  console.log(`  call inside the transaction   ${String(inside.rps).padStart(4)} payments/s | p50 ${inside.p50} ms | p99 ${inside.p99} ms`);
  console.log(`  call before the transaction   ${String(outside.rps).padStart(4)} payments/s | p50 ${outside.p50} ms | p99 ${outside.p99} ms`);
  results.external = { inside, outside };
}

// 4. Many app instances, each with its own pool, against max_connections = 100.
console.log('\n4 SCALING OUT: 8 app instances, pool of 20 each (160 connections) against max_connections 100');
{
  const pools = Array.from({ length: 8 }, () => new pg.Pool({ connectionString: URL, max: 20, connectionTimeoutMillis: 5000 }));
  let i = 0;
  const r = await load(1600, 160, () => pools[i++ % 8].query('SELECT pg_sleep(0.05)'));
  await Promise.all(pools.map((p) => p.end()));
  console.log(`  succeeded ${1600 - r.errors} | failed ${r.errors} | errors: ${JSON.stringify(r.errs)}`);
  results.scaleOut = r;
  const pools2 = Array.from({ length: 8 }, () => new pg.Pool({ connectionString: URL, max: 10, connectionTimeoutMillis: 5000 }));
  i = 0;
  const r2 = await load(1600, 160, () => pools2[i++ % 8].query('SELECT pg_sleep(0.05)'));
  await Promise.all(pools2.map((p) => p.end()));
  console.log(`  same load, pool of 10 each (80 connections): succeeded ${1600 - r2.errors} | failed ${r2.errors} | ${Math.round(1600 / r2.secs)} req/s`);
  results.scaleOut2 = r2;
}
await admin.end();

if (results.scaleOut2.errors) { console.error('right-sized pools still failed'); process.exit(1); }
