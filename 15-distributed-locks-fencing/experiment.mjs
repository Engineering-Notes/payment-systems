// 4 workers race to produce 200 daily payout files. A lease guards each file. Some workers pause
// (think garbage collection, a VM migration, a slow disk) for longer than the lease after acquiring it.
import fs from 'node:fs';
import pg from 'pg';
import { acquire, release, stillValid } from './lease.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/fencing', max: 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JOBS = 200, WORKERS = 4, TTL = 100, PAUSE = 250, PAUSE_RATE = 0.15;
let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// Three ways to write the protected resource.
const writers = {
  // Trust the lease: if I acquired it, I may write.
  'lease only': async (c, job, worker, token) => {
    await c.query(`INSERT INTO payout_files (job, writer, sent_count) VALUES ($1, $2, 1)
      ON CONFLICT (job) DO UPDATE SET writer = $2, sent_count = payout_files.sent_count + 1`, [job, worker]);
    return true;
  },
  // Fencing: the resource accepts a write only if its token is higher than any it has seen.
  'lease + fencing token': async (c, job, worker, token) => {
    await c.query('INSERT INTO payout_files (job) VALUES ($1) ON CONFLICT DO NOTHING', [job]);
    const { rowCount } = await c.query(`UPDATE payout_files SET max_token = $3, writer = $2, sent_count = sent_count + 1
      WHERE job = $1 AND max_token < $3`, [job, worker, token]);
    return rowCount === 1;
  },
  // Fencing plus "send at most once": a newer holder must not resend a file that was already sent.
  'fencing + send once': async (c, job, worker, token) => {
    await c.query('INSERT INTO payout_files (job) VALUES ($1) ON CONFLICT DO NOTHING', [job]);
    const { rowCount } = await c.query(`UPDATE payout_files SET max_token = $3, writer = $2, sent_count = sent_count + 1
      WHERE job = $1 AND max_token < $3 AND sent_count = 0`, [job, worker, token]);
    return rowCount === 1;
  },
};

async function run(mode) {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  seed = 7;
  const done = new Set();
  let acquired = 0, paused = 0, rejected = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const worker = `worker-${w}`;
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < JOBS; j++) {
        const job = `payout:merchant-${j}:2026-12-31`;
        if (done.has(job)) continue;
        const token = await acquire(pool, job, worker, TTL);
        if (token === null) continue;
        acquired++;
        // Work: read balances, build the file. Sometimes the process stalls for longer than the lease.
        if (rand() < PAUSE_RATE) { paused++; await sleep(PAUSE); } else await sleep(5);
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const valid = await stillValid(c, job, token);
          const ok = await writers[mode](c, job, worker, token);
          if (ok) await c.query('INSERT INTO payout_writes (job, writer, token, stale) VALUES ($1, $2, $3, $4)', [job, worker, token, !valid]);
          else rejected++;
          await c.query('COMMIT');
        } finally { c.release(); }
        done.add(job);
        await release(pool, job, worker, token);
      }
    }
  }));
  const { rows: [r] } = await pool.query(`SELECT
      count(*) FILTER (WHERE sent_count > 1)::int AS sent_twice,
      count(*) FILTER (WHERE sent_count = 1)::int AS sent_once,
      count(*) FILTER (WHERE sent_count = 0)::int AS never_sent,
      (SELECT count(*)::int FROM payout_writes WHERE stale) AS stale_accepted
    FROM payout_files`);
  return { mode, acquired, paused, rejected, ...r };
}

console.log(`${JOBS} payout files, ${WORKERS} workers, lease ${TTL} ms, ${PAUSE_RATE * 100}% of holders stall for ${PAUSE} ms after acquiring\n`);
console.log('  strategy                  leases granted  stalls  writes refused  writes after expiry  files sent twice  sent once  never sent');
const out = [];
for (const mode of Object.keys(writers)) {
  const r = await run(mode); out.push(r);
  console.log(`  ${mode.padEnd(24)} ${String(r.acquired).padStart(15)} ${String(r.paused).padStart(7)} ${String(r.rejected).padStart(15)} ${String(r.stale_accepted).padStart(20)} ${String(r.sent_twice).padStart(17)} ${String(r.sent_once).padStart(10)} ${String(r.never_sent).padStart(11)}`);
}
await pool.end();
const last = out.at(-1);
if (last.sent_twice || last.sent_once !== JOBS) { console.error('fencing + send once must send every file exactly once'); process.exit(1); }
