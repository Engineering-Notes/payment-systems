// Two webhook receivers for the same payment events.
import http from 'node:http';
import { verify } from './signing.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readRaw = (req) => new Promise((r) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => r(Buffer.concat(chunks).toString('utf8'))); });

export async function startReceiver({ pool, mode, secrets, toleranceSec = 300, flaky = () => false, slowWork = () => 0 }) {
  const counters = { rejected: {}, accepted: 0 };
  const reject = (res, code, why) => { counters.rejected[why] = (counters.rejected[why] ?? 0) + 1; res.writeHead(code); res.end(why); };

  const server = http.createServer(async (req, res) => {
    const raw = await readRaw(req);
    if (flaky()) return reject(res, 503, 'flaky');

    if (mode === 'naive') {
      // Trusts the body, does all the work before answering, and applies every delivery it receives.
      const event = JSON.parse(raw);
      await sleep(slowWork());                                     // e.g. send an email, call another API
      await applyNaive(event);
      counters.accepted++; res.writeHead(200); return res.end('ok');
    }

    // Robust: verify the raw bytes, store once, answer fast, process later.
    const why = verify({ secrets, headers: req.headers, rawBody: raw, toleranceSec });
    if (why) return reject(res, 400, why);
    const event = JSON.parse(raw);
    await pool.query('INSERT INTO webhook_inbox (id, type, payload) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [req.headers['webhook-id'], event.type, raw]);
    counters.accepted++; res.writeHead(200); res.end('ok');
  });

  async function applyNaive(e) {
    const p = e.data;
    if (e.type === 'payment.created') {
      await pool.query(`INSERT INTO payments (id, status, amount, version) VALUES ($1, 'pending', $2, $3)
        ON CONFLICT (id) DO UPDATE SET status = 'pending', version = $3`, [p.id, p.amount, p.version]);
    } else if (e.type === 'payment.succeeded') {
      await pool.query(`UPDATE payments SET status = 'succeeded', version = $2 WHERE id = $1`, [p.id, p.version]);
      await pool.query(`INSERT INTO ledger_entries (payment_id, kind, amount, source) VALUES ($1, 'credit', $2, $3)`, [p.id, p.amount, e.id]);
    } else if (e.type === 'payment.refunded') {
      await pool.query(`UPDATE payments SET status = 'refunded', version = $2 WHERE id = $1`, [p.id, p.version]);
      await pool.query(`INSERT INTO ledger_entries (payment_id, kind, amount, source) VALUES ($1, 'debit', $2, $3)`, [p.id, p.amount, e.id]);
    }
  }

  // Worker: claims unprocessed inbox rows, applies each in a transaction, ignores stale versions.
  async function work(batch = 20) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(`SELECT id, payload FROM webhook_inbox WHERE processed_at IS NULL
        ORDER BY received_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch]);
      rows.sort((a, b) => (a.payload.data.id < b.payload.data.id ? -1 : 1));   // lock payments in a fixed order
      for (const r of rows) {
        await applyRobust(c, r.payload);
        await sleep(slowWork() / 10);
        await c.query('UPDATE webhook_inbox SET processed_at = now() WHERE id = $1', [r.id]);
      }
      await c.query('COMMIT');
      return rows.length;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  async function applyRobust(c, e) {
    const p = e.data;                                               // events carry the full object and its version
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [p.id]);   // one worker per payment at a time
    await c.query(`INSERT INTO payments (id, status, amount, version) VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, version = EXCLUDED.version
      WHERE payments.version < EXCLUDED.version`, [p.id, p.status, p.amount, p.version]);
    // Ledger effects follow from the state reached, not from the order events arrived in.
    if (p.status === 'succeeded' || p.status === 'refunded') await ensureEntry(c, p.id, 'credit', p.amount, e.id);
    if (p.status === 'refunded') await ensureEntry(c, p.id, 'debit', p.amount, e.id);
  }
  async function ensureEntry(c, paymentId, kind, amount, source) {
    await c.query(`INSERT INTO ledger_entries (payment_id, kind, amount, source)
      SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE payment_id = $1 AND kind = $2)`,
      [paymentId, kind, amount, source]);
  }

  await new Promise((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${server.address().port}/webhooks`, counters, work, close: () => server.close() };
}
