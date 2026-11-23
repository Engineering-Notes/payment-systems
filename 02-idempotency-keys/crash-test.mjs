// A worker claimed a key, then crashed before finishing. Its lock is 2 minutes old.
import fs from 'node:fs';
import { start, pool } from './server.mjs';
import crypto from 'node:crypto';
await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const server = await start(8081);
const body = { customer_id: 'cus_881', amount: 250000, currency: 'KES' };
const canonical = (v) => v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const hash = crypto.createHash('sha256').update(canonical(body)).digest('hex');
await pool.query(`INSERT INTO idempotency_keys (owner_id, key, request_method, request_path, request_hash, locked_at)
                  VALUES ('shop_1', 'crashed-key', 'POST', '/v1/payments', $1, now() - interval '2 minutes')`, [hash]);
const r = await fetch('http://localhost:8081/v1/payments', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Client': 'shop_1', 'Idempotency-Key': 'crashed-key' },
  body: JSON.stringify(body) });
const { rows: [k] } = await pool.query(`SELECT status FROM idempotency_keys WHERE key = 'crashed-key'`);
console.log('6 STALE LOCK takeover   status:', r.status, '| key status now:', k.status,
            '| payments created:', (await pool.query('SELECT count(*) FROM payments')).rows[0].count);
server.close(); await pool.end();
