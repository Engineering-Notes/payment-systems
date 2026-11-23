// Four scenarios against the same API. Prints how many payments each one created.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { start, pool } from './server.mjs';

await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const server = await start(8080);
const BASE = 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A client that gives up after `timeoutMs` and retries with backoff.
async function post(path, body, { key, timeoutMs = 5000 } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Api-Client': 'shop_1' };
  if (key) headers['Idempotency-Key'] = key;
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body),
                                         signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, replayed: r.headers.get('idempotent-replayed') === 'true', body: await r.json() };
  } catch {
    return { status: 'timeout' };
  }
}

async function withRetries(path, body, key, attempts = 4) {
  const log = [];
  for (let i = 0; i < attempts; i++) {
    // First attempt times out before the server answers (the response is "lost").
    const r = await post(path, body, { key, timeoutMs: i === 0 ? 100 : 5000 });
    log.push(r.replayed ? `${r.status} replay` : String(r.status));
    if (r.status === 201 || r.status === 400 || r.status === 422) break;
    await sleep(Math.min(1000, 100 * 2 ** i) + Math.random() * 50);   // backoff with jitter
  }
  return log;
}

const count = async () => Number((await pool.query('SELECT count(*) FROM payments')).rows[0].count);
const payment = { customer_id: 'cus_881', amount: 250000, currency: 'KES' };

// 1. Lost response, client retries, no idempotency
await pool.query('TRUNCATE payments, idempotency_keys');
const log1 = await withRetries('/naive/payments', payment, null);
await sleep(500);
console.log('1 NAIVE retry           attempts:', log1.join(' -> '), '| payments created:', await count());

// 2. Lost response, client retries, with an idempotency key
await pool.query('TRUNCATE payments, idempotency_keys');
const log2 = await withRetries('/v1/payments', payment, crypto.randomUUID());
await sleep(500);
console.log('2 KEYED retry           attempts:', log2.join(' -> '), '| payments created:', await count());

// 3. 20 identical requests fired at once with the same key (double-click, retry storm)
await pool.query('TRUNCATE payments, idempotency_keys');
const key3 = crypto.randomUUID();
const burst = await Promise.all(Array.from({ length: 20 }, () => post('/v1/payments', payment, { key: key3 })));
const tally = burst.reduce((m, r) => { const k = r.replayed ? `${r.status} replay` : r.status; m[k] = (m[k] ?? 0) + 1; return m; }, {});
console.log('3 KEYED burst x20       responses:', JSON.stringify(tally), '| payments created:', await count());
const after = await post('/v1/payments', payment, { key: key3 });
console.log('  follow-up retry       status:', after.status, after.replayed ? '(replayed)' : '', '| same payment id:', after.body.id === burst.find(r => r.status === 201).body.id);

// 3b. Same burst without keys
await pool.query('TRUNCATE payments, idempotency_keys');
await Promise.all(Array.from({ length: 20 }, () => post('/naive/payments', payment)));
console.log('3b NAIVE burst x20      payments created:', await count());

// 4. Same key, different amount
await pool.query('TRUNCATE payments, idempotency_keys');
const key4 = crypto.randomUUID();
await post('/v1/payments', payment, { key: key4 });
const r4 = await post('/v1/payments', { ...payment, amount: 25000 }, { key: key4 });
console.log('4 KEY REUSE new amount  status:', r4.status, '|', r4.body.error, '| payments created:', await count());

// 5. Missing key
const r5 = await post('/v1/payments', payment);
console.log('5 MISSING KEY           status:', r5.status, '|', r5.body.error);

server.close();
await pool.end();
