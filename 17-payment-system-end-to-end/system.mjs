// A small payment system that combines the series' patterns, run under injected faults.
// Provider mock, payments API, outbox relay, webhook receiver and reconciler, all in one process.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/e2e', max: 30 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 17; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const SECRET = crypto.randomBytes(32);
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const faults = { clientResponseLost: 0, rateLimited: 0, providerTimeout: 0, providerErrorAfterCharge: 0, relayCrash: 0,
  webhookLost: 0, webhookDuplicated: 0, forgedWebhook: 0 };
const absorbed = { idempotentReplay: 0, providerDeduped: 0, relayRetries: 0, inboxDuplicate: 0, signatureRejected: 0, reconciled: 0 };
const json = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

// ---------- Payment provider (mock) ----------
const charges = new Map();                                  // idempotency key -> promise of the charge
const chargeLog = [];                                       // every charge actually created
let webhookUrl;
const provider = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET') { const c = charges.get(url.searchParams.get('key')); return c ? json(res, 200, await c) : json(res, 404, {}); }
  const key = req.headers['idempotency-key']; const body = JSON.parse(await read(req));
  if (charges.has(key)) { absorbed.providerDeduped++; return json(res, 200, await charges.get(key)); }
  let settle; charges.set(key, new Promise((r) => (settle = r)));              // claim the key before doing any work
  if (rand() < 0.05) { faults.providerTimeout++; await sleep(2000); }           // slow, caller times out; charge still happens below
  const charge = { id: 'ch_' + crypto.randomBytes(6).toString('hex'), key, amount: body.amount, status: 'captured' };
  chargeLog.push(charge); settle(charge);
  setTimeout(() => sendWebhook(charge), 20 + rand() * 80);
  if (rand() < 0.05) { faults.providerErrorAfterCharge++; return json(res, 500, { error: 'internal' }); }   // charged, but says it failed
  json(res, 200, charge);
});
async function sendWebhook(charge) {
  const event = { id: 'evt_' + charge.id, type: 'charge.captured', data: charge };
  const body = JSON.stringify(event);
  if (rand() < 0.10) { faults.webhookLost++; return; }
  const post = () => fetch(webhookUrl, { method: 'POST', body, headers: { 'x-signature': sign(body) } }).catch(() => {});
  await post();
  if (rand() < 0.10) { faults.webhookDuplicated++; await sleep(30); await post(); }
}

// ---------- Payments API ----------
async function takeToken(customer) {                         // shared token bucket per customer: burst 5, 10 per second (part 6)
  const { rows } = await pool.query(`
    INSERT INTO rate_limits (key, tokens) VALUES ($1, 4) ON CONFLICT (key) DO UPDATE
      SET tokens = LEAST(5, rate_limits.tokens + EXTRACT(EPOCH FROM clock_timestamp() - rate_limits.updated_at) * 10) - 1,
          updated_at = clock_timestamp()
      WHERE LEAST(5, rate_limits.tokens + EXTRACT(EPOCH FROM clock_timestamp() - rate_limits.updated_at) * 10) >= 1
    RETURNING tokens`, [customer]);
  return rows.length === 1;
}
const api = http.createServer(async (req, res) => {
  const raw = await read(req); const key = req.headers['idempotency-key']; const body = JSON.parse(raw);
  if (!(await takeToken(body.customer))) { faults.rateLimited++; return json(res, 429, { error: 'rate limited' }, { 'retry-after': '1' }); }
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const c = await pool.connect();
  try {                                                       // idempotency key, payment and outbox row commit together (parts 2 and 3)
    await c.query('BEGIN');
    const ins = await c.query('INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key', [key, hash]);
    if (!ins.rowCount) {
      const { rows: [k] } = await c.query('SELECT * FROM idempotency_keys WHERE key = $1 FOR UPDATE', [key]);
      await c.query('COMMIT');
      if (k.request_hash !== hash) return json(res, 422, { error: 'key reused with a different request' });
      absorbed.idempotentReplay++; return json(res, 201, k.response);
    }
    const { rows: [p] } = await c.query('INSERT INTO payments (customer, amount) VALUES ($1, $2) RETURNING id', [body.customer, body.amount]);
    await c.query('INSERT INTO outbox (payment_id) VALUES ($1)', [p.id]);
    const response = { payment_id: p.id, status: 'pending' };
    await c.query('UPDATE idempotency_keys SET payment_id = $2, response = $3 WHERE key = $1', [key, p.id, response]);
    await c.query('COMMIT');
    if (rand() < 0.10) { faults.clientResponseLost++; req.socket.destroy(); return; }   // committed, but the client never hears back
    json(res, 201, response);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); json(res, 500, { error: e.message }); } finally { c.release(); }
});

// ---------- Outbox relay: calls the provider with timeouts, retries with jitter, and the payment's own key (parts 3, 7, 14) ----------
let providerUrl, stopping = false;
async function relayLoop() {
  while (!stopping) {
    const c = await pool.connect(); let rows = [];
    try {
      await c.query('BEGIN');
      ({ rows } = await c.query(`SELECT o.id, o.payment_id, o.attempts, p.amount FROM outbox o JOIN payments p ON p.id = o.payment_id
        WHERE NOT o.done AND o.next_at <= now() ORDER BY o.id LIMIT 5 FOR UPDATE OF o SKIP LOCKED`));
      for (const r of rows) {
        let ok = false;
        try {
          const res = await fetch(providerUrl + '/charges', { method: 'POST', signal: AbortSignal.timeout(500),
            headers: { 'idempotency-key': `pay_${r.payment_id}` }, body: JSON.stringify({ amount: Number(r.amount) }) });
          ok = res.ok;
        } catch { /* timeout */ }
        if (ok && rand() < 0.03) { faults.relayCrash++; throw new Error('crash after provider call'); }   // dies before recording success
        if (ok) await c.query('UPDATE outbox SET done = true WHERE id = $1', [r.id]);
        else { absorbed.relayRetries++; await c.query(`UPDATE outbox SET attempts = attempts + 1,
          next_at = now() + ($2 * interval '1 millisecond') WHERE id = $1`, [r.id, Math.random() * Math.min(2000, 100 * 2 ** r.attempts)]); }
      }
      await c.query('COMMIT');
    } catch { await c.query('ROLLBACK').catch(() => {}); } finally { c.release(); }
    if (!rows.length) await sleep(20);
  }
}

// ---------- Webhook receiver: verify, store once, apply once (part 10) ----------
const receiver = http.createServer(async (req, res) => {
  const raw = await read(req);
  const given = Buffer.from(req.headers['x-signature'] ?? '', 'hex'), expected = Buffer.from(sign(raw), 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) { absorbed.signatureRejected++; res.writeHead(400); return res.end(); }
  const event = JSON.parse(raw);
  const { rowCount } = await pool.query('INSERT INTO inbox (event_id, body) VALUES ($1, $2) ON CONFLICT DO NOTHING', [event.id, raw]);
  if (!rowCount) absorbed.inboxDuplicate++;
  res.writeHead(200); res.end();
  if (rowCount) await capture(event.data, 'webhook');
});
async function capture(charge, source) {
  const paymentId = Number(charge.key.replace('pay_', ''));
  const c = await pool.connect();
  try {                                                       // ledger entries and status change in one transaction (part 1)
    await c.query('BEGIN');
    const { rowCount } = await c.query(`UPDATE payments SET status = 'captured', provider_id = $2, captured_by = $3 WHERE id = $1 AND status = 'pending'`, [paymentId, charge.id, source]);
    if (rowCount) {
      await c.query(`INSERT INTO entries (payment_id, account, amount, kind) VALUES ($1, 'provider:receivable', $2, 'capture'), ($1, 'customer:charged', $3, 'capture')`,
        [paymentId, charge.amount, -charge.amount]);
      if (source === 'reconciler') absorbed.reconciled++;
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

// ---------- Reconciler: ask the provider about anything still pending (parts 8 and 11) ----------
async function reconcile() {
  const { rows } = await pool.query(`SELECT p.id FROM payments p JOIN outbox o ON o.payment_id = p.id WHERE p.status = 'pending' AND o.done`);
  for (const r of rows) {
    const res = await fetch(`${providerUrl}/charges?key=pay_${r.id}`);
    if (res.ok) await capture(await res.json(), 'reconciler');
  }
}

// ---------- Customers ----------
async function customer(i, n) {
  const key = crypto.randomUUID(); const body = JSON.stringify({ customer: `cust_${i % 20}`, amount: 500 + n * 7 });
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(apiUrl, { method: 'POST', body, headers: { 'idempotency-key': key }, signal: AbortSignal.timeout(2000) });
      if (res.status === 201) return 'ok';
      if (res.status === 429) { await sleep(1000 * (0.5 + Math.random())); continue; }
    } catch { /* lost response: retry with the same key */ }
    await sleep(Math.random() * 100 * 2 ** attempt);
  }
  return 'gave up';
}

let apiUrl;
async function listen(server) { await new Promise((r) => server.listen(0, r)); return `http://127.0.0.1:${server.address().port}`; }

export async function run({ payments = 600 } = {}) {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  providerUrl = await listen(provider); apiUrl = await listen(api); webhookUrl = await listen(receiver);
  const relays = Array.from({ length: 3 }, relayLoop);

  const t0 = Date.now(); let next = 0; const outcomes = {};
  await Promise.all(Array.from({ length: 40 }, async (_, w) => {
    while (next < payments) { const n = next++; const o = await customer(n, n); outcomes[o] = (outcomes[o] ?? 0) + 1; }
  }));
  // An attacker posts a forged capture for a payment that exists.
  faults.forgedWebhook++;
  await fetch(webhookUrl, { method: 'POST', body: JSON.stringify({ id: 'evt_fake', data: { id: 'ch_fake', key: 'pay_1', amount: 999999 } }), headers: { 'x-signature': 'ab'.repeat(32) } });

  for (let i = 0; i < 600; i++) { const { rows: [o] } = await pool.query('SELECT count(*)::int n FROM outbox WHERE NOT done'); if (!o.n) break; await sleep(100); }
  const { rows: [left] } = await pool.query('SELECT count(*)::int n FROM outbox WHERE NOT done');
  await sleep(500);
  await reconcile();
  stopping = true; await Promise.all(relays);
  const secs = (Date.now() - t0) / 1000;

  // Invariants.
  const q = async (sql) => (await pool.query(sql)).rows[0];
  const inv = {
    'every customer request accepted': outcomes.ok === payments,
    'one payment per customer request': (await q('SELECT count(*)::int n FROM payments')).n === payments,
    'one provider charge per payment': chargeLog.length === payments && new Set(chargeLog.map((c) => c.key)).size === payments,
    'every charge captured in the ledger': (await q(`SELECT count(*)::int n FROM payments WHERE status = 'captured'`)).n === payments,
    'two ledger entries per payment': (await q('SELECT count(*)::int n FROM entries')).n === 2 * payments,
    'ledger balances to zero': (await q('SELECT coalesce(sum(amount), 0)::bigint s FROM entries')).s === '0',
    'ledger total equals provider total': BigInt((await q(`SELECT sum(amount)::bigint s FROM entries WHERE account = 'provider:receivable'`)).s)
      === chargeLog.reduce((s, c) => s + BigInt(c.amount), 0n),
  };
  inv._outboxLeft = left.n; inv._charges = chargeLog.length; inv._capturedBy = (await pool.query('SELECT captured_by, count(*)::int n FROM payments GROUP BY 1')).rows;
  for (const s of [provider, api, receiver]) { s.closeAllConnections?.(); s.close(); }
  await pool.end();
  return { payments, secs, outcomes, faults, absorbed, inv };
}
