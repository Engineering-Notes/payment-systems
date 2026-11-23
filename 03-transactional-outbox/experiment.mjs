// Dual writes vs the transactional outbox, under injected failures.
// 1,000 payments per scenario. Same seeded failure rates for every run.
import fs from 'node:fs';
import pg from 'pg';

const N = 1000;
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL ?? 'postgres://ledger:ledger@localhost/outbox', max: 20 });
const consumerDb = new pg.Pool({ connectionString: process.env.CONSUMER_DATABASE_URL ?? 'postgres://ledger:ledger@localhost/consumer', max: 20 });

// Seeded PRNG (mulberry32) so every run injects the same failures.
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let rand = rng(42);

const P_BROKER_DOWN = 0.05;   // broker rejects the publish, nothing delivered
const P_ACK_LOST    = 0.05;   // broker delivered, but the publisher never hears back
const P_CRASH       = 0.03;   // process dies between two steps
const P_DB_FAIL     = 0.03;   // database commit fails (timeout, failover, constraint)

class Crash extends Error {}

// ---- the consumer: records every delivery, processes each event once ----
async function consume(event) {
  await consumerDb.query('INSERT INTO receipts (event_id) VALUES ($1)', [event.event_id]);
  await consumerDb.query(
    `INSERT INTO inbox (event_id, event_type, payload) VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING`, [event.event_id, event.event_type, event.payload]);
}

// ---- the broker: sometimes down, sometimes loses the acknowledgement ----
async function publish(event) {
  const r = rand();
  if (r < P_BROKER_DOWN) throw new Error('broker unavailable');
  await consume(event);
  if (r < P_BROKER_DOWN + P_ACK_LOST) throw new Error('ack timeout');
}

const uuid = () => crypto.randomUUID();
const paymentEvent = (id, p) => ({ event_id: uuid(), event_type: 'payment.captured',
                                   payload: { payment_id: String(id), ...p } });
const req = (i) => ({ customer_id: `cus_${i}`, amount: 1000 + i, currency: 'KES' });

async function reset() {
  await app.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await consumerDb.query(fs.readFileSync(new URL('./consumer-schema.sql', import.meta.url), 'utf8'));
  rand = rng(42);
}

// A) Write to the database, then publish.
async function commitThenPublish(i) {
  const p = req(i);
  const { rows: [{ id }] } = await app.query(
    'INSERT INTO payments (customer_id, amount, currency) VALUES ($1,$2,$3) RETURNING id',
    [p.customer_id, p.amount, p.currency]);
  if (rand() < P_CRASH) throw new Crash();          // died after commit, before publish
  try { await publish(paymentEvent(id, p)); } catch { /* logged and dropped */ }
}

// B) Publish, then write to the database.
async function publishThenCommit(i) {
  const p = req(i);
  const { rows: [{ nextval }] } = await app.query(`SELECT nextval('payments_id_seq')`);
  try { await publish(paymentEvent(nextval, p)); } catch { return; }   // request fails, no payment
  if (rand() < P_DB_FAIL) throw new Error('commit failed');           // event is already out
  await app.query('INSERT INTO payments (id, customer_id, amount, currency) VALUES ($1,$2,$3,$4)',
    [nextval, p.customer_id, p.amount, p.currency]);
}

// C) Transactional outbox: payment and event row commit together.
async function withOutbox(i) {
  const p = req(i);
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    const { rows: [{ id }] } = await c.query(
      'INSERT INTO payments (customer_id, amount, currency) VALUES ($1,$2,$3) RETURNING id',
      [p.customer_id, p.amount, p.currency]);
    await c.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('payment', $1, 'payment.captured', $2)`,
      [String(id), { payment_id: String(id), ...p }]);
    if (rand() < P_CRASH) throw new Crash();          // dies before COMMIT: both roll back
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// The relay: claim a batch with SKIP LOCKED, publish, mark published.
const inflight = new Set();
let doubleClaims = 0;
async function relayOnce(batch = Number(process.env.BATCH ?? 50)) {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `SELECT id, event_id, event_type, payload FROM outbox
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`, [batch]);
    for (const r of rows) { if (inflight.has(r.id)) doubleClaims++; inflight.add(r.id); }
    try {
      for (const r of rows) {
        try {
          await publish(r);
          if (rand() < P_CRASH / 3) throw new Crash();   // relay dies after publish, before marking
          await c.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [r.id]);
        } catch (e) {
          if (e instanceof Crash) throw e;
          await c.query('UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
                        [r.id, e.message]);
        }
      }
      for (const r of rows) inflight.delete(r.id);     // release before the row locks are released
      await c.query('COMMIT');
    } catch (e) {
      for (const r of rows) inflight.delete(r.id);
      await c.query('ROLLBACK');                        // crash: nothing in this batch is marked
    }
    return rows.length;
  } finally {
    c.release();
  }
}

async function runRelays(workers = 4) {
  const loop = async () => { while (true) { const n = await relayOnce(); if (n === 0) {
    const { rows: [{ c }] } = await app.query('SELECT count(*)::int c FROM outbox WHERE published_at IS NULL');
    if (c === 0) return; } } };
  await Promise.all(Array.from({ length: workers }, loop));
}

async function report(label) {
  const { rows: [a] } = await app.query('SELECT count(*)::int n FROM payments');
  const { rows: [b] } = await consumerDb.query('SELECT count(*)::int n FROM inbox');
  const { rows: [r] } = await consumerDb.query('SELECT count(*)::int n FROM receipts');
  const { rows: [lost] } = await consumerDb.query(
    `SELECT count(*)::int n FROM (SELECT payload->>'payment_id' pid FROM inbox) x`);
  const ids = new Set((await app.query('SELECT id::text FROM payments')).rows.map((x) => x.id));
  const evs = (await consumerDb.query(`SELECT payload->>'payment_id' pid FROM inbox`)).rows.map((x) => x.pid);
  const evSet = new Set(evs);
  const missing = [...ids].filter((id) => !evSet.has(id)).length;
  const phantom = evs.filter((pid) => !ids.has(pid)).length;
  console.log(`${label.padEnd(22)} payments: ${String(a.n).padStart(4)} | events processed: ${String(b.n).padStart(4)}`
    + ` | payments with no event: ${String(missing).padStart(3)} | events with no payment: ${String(phantom).padStart(3)}`
    + ` | duplicate deliveries absorbed: ${r.n - b.n}`);
  return { payments: a.n, processed: b.n, missing, phantom, dupes: r.n - b.n };
}

async function scenario(label, fn) {
  await reset();
  for (let i = 0; i < N; i++) { try { await fn(i); } catch { /* request failed or crashed */ } }
  if (fn === withOutbox) await runRelays(4);
  return report(label);
}

await scenario('A commit, then publish', commitThenPublish);
await scenario('B publish, then commit', publishThenCommit);
await scenario('C transactional outbox', withOutbox);
const { rows: [o] } = await app.query(
  `SELECT count(*) FILTER (WHERE attempts > 1)::int retried, max(attempts)::int max_attempts FROM outbox`);
console.log(`  outbox relay: 4 workers, events needing retries: ${o.retried}, max attempts for one event: ${o.max_attempts}, double claims: ${doubleClaims}`);

await app.end(); await consumerDb.end();
