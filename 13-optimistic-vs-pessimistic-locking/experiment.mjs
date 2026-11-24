// Optimistic against pessimistic locking, swept from heavy contention (1 hot row) to almost none (10,000 rows).
import http from 'node:http';
import pg from 'pg';
import { pessimistic, optimistic, atomic } from './strategies.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/locking', max: 40 });
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const OPS = 2000, WORKERS = 40, THINK = 2;

async function run(strategy, rowsN) {
  await pool.query('DROP TABLE IF EXISTS wallets; CREATE TABLE wallets (id int PRIMARY KEY, balance integer NOT NULL, version int NOT NULL DEFAULT 0)');
  await pool.query('INSERT INTO wallets (id, balance) SELECT g, 1000000 FROM generate_series(1, $1) g', [rowsN]);
  let next = 0, retries = 0; const lat = [];
  const t0 = performance.now();
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < OPS) {
      next++;
      const id = 1 + Math.floor(Math.random() * rowsN), delta = Math.random() < 0.5 ? -7 : 7;
      const s = performance.now();
      const r = await strategy(pool, id, delta, THINK);
      lat.push(performance.now() - s); retries += r.retries;
    }
  }));
  const secs = (performance.now() - t0) / 1000;
  const { rows: [t] } = await pool.query('SELECT sum(balance)::bigint AS total, sum(version)::int AS writes FROM wallets');
  return { ops: Math.round(OPS / secs), p99: pct(lat, 99).toFixed(0), retries, writes: t.writes };
}

console.log(`1 CONTENTION SWEEP: ${OPS} read-decide-write operations, ${WORKERS} workers, ${THINK} ms of application logic between read and write`);
console.log('  rows    strategy       ops/s   p99 ms   retries   writes applied');
const sweep = [];
for (const rowsN of [1, 10, 100, 10000]) {
  for (const [name, fn] of [['pessimistic', pessimistic], ['optimistic', optimistic], ['atomic', atomic]]) {
    const r = await run(fn, rowsN);
    sweep.push({ rowsN, name, ...r });
    console.log(`  ${String(rowsN).padStart(5)}   ${name.padEnd(12)} ${String(r.ops).padStart(6)} ${String(r.p99).padStart(8)} ${String(r.retries).padStart(9)} ${String(r.writes).padStart(10)}`);
  }
}

// 2. The same idea over HTTP: two people edit the same record. ETag / If-Match turns a silent overwrite into a 412.
console.log('\n2 OPTIMISTIC LOCKING OVER HTTP: two clients edit the same merchant settings');
await pool.query('DROP TABLE IF EXISTS merchants; CREATE TABLE merchants (id int PRIMARY KEY, payout_account text, version int NOT NULL DEFAULT 1)');
await pool.query(`INSERT INTO merchants VALUES (1, 'KCB 001', 1)`);
const server = http.createServer(async (req, res) => {
  const { rows: [m] } = await pool.query('SELECT * FROM merchants WHERE id = 1');
  if (req.method === 'GET') { res.writeHead(200, { ETag: `"${m.version}"`, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(m)); }
  let body = ''; for await (const ch of req) body += ch;
  const ifMatch = req.headers['if-match'];
  if (req.url === '/checked' && !ifMatch) { res.writeHead(428); return res.end('If-Match required'); }
  const where = req.url === '/checked' ? 'id = 1 AND version = $2' : 'id = 1 AND $2::int IS NOT NULL';
  const v = req.url === '/checked' ? Number(ifMatch.replace(/"/g, '')) : 0;
  const { rowCount, rows } = await pool.query(`UPDATE merchants SET payout_account = $1, version = version + 1 WHERE ${where} RETURNING version`,
    [JSON.parse(body).payout_account, v]);
  if (!rowCount) { res.writeHead(412); return res.end('Precondition Failed'); }
  res.writeHead(200, { ETag: `"${rows[0].version}"` }); res.end('ok');
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
for (const path of ['/unchecked', '/checked']) {
  await pool.query(`UPDATE merchants SET payout_account = 'KCB 001', version = 1`);
  const a = await fetch(base), b = await fetch(base);                       // both load the form
  const ea = a.headers.get('etag'), eb = b.headers.get('etag');
  const ra = await fetch(base + path, { method: 'PUT', headers: { 'If-Match': ea }, body: JSON.stringify({ payout_account: 'Equity 777' }) });
  const rb = await fetch(base + path, { method: 'PUT', headers: { 'If-Match': eb }, body: JSON.stringify({ payout_account: 'KCB 002' }) });
  const { rows: [m] } = await pool.query('SELECT payout_account FROM merchants WHERE id = 1');
  console.log(`  ${path.padEnd(10)} first save ${ra.status}, second save ${rb.status}, stored: ${m.payout_account}${path === '/unchecked' ? ' (first edit silently lost)' : ' (second user told to reload)'}`);
}
server.close();
await pool.end();
// CI gate: every strategy must apply every write exactly once.
if (sweep.some((r) => r.writes !== OPS)) { console.error('a strategy lost or duplicated writes'); process.exit(1); }
