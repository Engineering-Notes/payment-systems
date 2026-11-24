// Four application instances share one client's limit: 10 requests per second.
// Each instance receives 100 requests from that client within about one second.
import fs from 'node:fs';
import pg from 'pg';
import { tokenBucket } from './algorithms.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/ratelimit', max: 40 });
await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const INSTANCES = 4, PER_INSTANCE = 100, CAPACITY = 10, RATE = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spread each instance's requests evenly across ~1 second.
async function drive(check) {
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: INSTANCES }, (_, inst) =>
    Promise.all(Array.from({ length: PER_INSTANCE }, async (_, i) => {
      await sleep(i * 10);
      return check(inst);
    }))));
  return { accepted: results.flat().filter(Boolean).length, seconds: (Date.now() - t0) / 1000 };
}

// A. Each instance keeps its own in-memory bucket.
const local = Array.from({ length: INSTANCES }, () => tokenBucket({ capacity: CAPACITY, ratePerSec: RATE }));
const start = Date.now();
const a = await drive((inst) => local[inst].allow(Date.now() - start));

// B. All instances share one bucket row in PostgreSQL.
const b = await drive(async () => {
  const { rows: [r] } = await pool.query('SELECT take_token($1, $2, $3) AS left', ['client_42:payments', CAPACITY, RATE]);
  return r.left !== null;
});

const allowed = (s) => Math.floor(CAPACITY + RATE * s);
console.log(`Policy: ${CAPACITY}-token bucket, ${RATE} tokens/s, ${INSTANCES} instances x ${PER_INSTANCE} requests`);
console.log(`A in-memory per instance   accepted ${a.accepted} of ${INSTANCES * PER_INSTANCE} in ${a.seconds.toFixed(2)} s | policy allows about ${allowed(a.seconds)}`);
console.log(`B shared bucket in Postgres accepted ${b.accepted} of ${INSTANCES * PER_INSTANCE} in ${b.seconds.toFixed(2)} s | policy allows about ${allowed(b.seconds)}`);
await pool.end();

// Fail CI if the shared bucket lets through more than the policy allows (2 requests of timing slack).
if (b.accepted > allowed(b.seconds) + 2) { console.error('shared limiter exceeded the policy'); process.exit(1); }
