// Minimal payments API with and without idempotency keys.
// POST /naive/payments      : no protection
// POST /v1/payments         : Idempotency-Key required
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/idem', max: 40 });
const LOCK_TIMEOUT = '30 seconds';   // a crashed worker's lock can be taken over after this
const PROCESSING_DELAY_MS = Number(process.env.DELAY_MS ?? 300); // simulates a slow processor call

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Canonical JSON: sorted keys, so {"a":1,"b":2} and {"b":2,"a":1} hash the same.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const fingerprint = (body) => crypto.createHash('sha256').update(canonical(body)).digest('hex');

function validate(body) {
  if (!Number.isInteger(body.amount) || body.amount <= 0) return 'amount must be a positive integer';
  if (!/^[A-Z]{3}$/.test(body.currency ?? '')) return 'currency must be an ISO 4217 code';
  if (!body.customer_id) return 'customer_id is required';
  return null;
}

async function createPayment(client, body) {
  await sleep(PROCESSING_DELAY_MS);
  const { rows } = await client.query(
    'INSERT INTO payments (customer_id, amount, currency) VALUES ($1, $2, $3) RETURNING id',
    [body.customer_id, body.amount, body.currency]);
  return { status: 201, body: { id: rows[0].id, ...body } };
}

async function naive(body) {
  const err = validate(body);
  if (err) return { status: 400, body: { error: err } };
  const c = await pool.connect();
  try { return await createPayment(c, body); } finally { c.release(); }
}

async function idempotent(ownerId, key, method, path, body) {
  if (!key) return { status: 400, body: { error: 'Idempotency-Key header is required' } };
  if (key.length > 255) return { status: 400, body: { error: 'Idempotency-Key too long' } };

  // Validation errors happen before execution starts, so they are not stored.
  const err = validate(body);
  if (err) return { status: 400, body: { error: err } };

  const hash = fingerprint(body);
  const c = await pool.connect();
  try {
    // Phase 1: claim the key, or find out who already has it.
    const claimed = await c.query(
      `INSERT INTO idempotency_keys (owner_id, key, request_method, request_path, request_hash, locked_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (owner_id, key) DO NOTHING
       RETURNING id`, [ownerId, key, method, path, hash]);

    if (claimed.rowCount === 0) {
      // Someone used this key before. Take over only if their lock went stale.
      const takeover = await c.query(
        `UPDATE idempotency_keys
            SET locked_at = now()
          WHERE owner_id = $1 AND key = $2
            AND status = 'in_progress'
            AND (locked_at IS NULL OR locked_at < now() - $3::interval)
            AND request_hash = $4
        RETURNING id`, [ownerId, key, LOCK_TIMEOUT, hash]);

      if (takeover.rowCount === 0) {
        const { rows: [k] } = await c.query(
          'SELECT * FROM idempotency_keys WHERE owner_id = $1 AND key = $2', [ownerId, key]);
        if (k.request_hash !== hash || k.request_path !== path || k.request_method !== method)
          return { status: 422, body: { error: 'Idempotency-Key reused with a different request' } };
        if (k.status === 'in_progress')
          return { status: 409, headers: { 'Retry-After': '1' },
                   body: { error: 'A request with this Idempotency-Key is still in progress' } };
        return { status: k.response_code, headers: { 'Idempotent-Replayed': 'true' }, body: k.response_body };
      }
    }

    // Phase 2: do the work and record the response in ONE transaction.
    await c.query('BEGIN');
    try {
      const result = await createPayment(c, body);
      await c.query(
        `UPDATE idempotency_keys
            SET status = 'completed', locked_at = NULL, response_code = $3, response_body = $4
          WHERE owner_id = $1 AND key = $2`,
        [ownerId, key, result.status, result.body]);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      // Release the lock so a retry can run the request again from scratch.
      await c.query('UPDATE idempotency_keys SET locked_at = NULL WHERE owner_id = $1 AND key = $2',
                    [ownerId, key]);
      throw e;
    }
  } finally {
    c.release();
  }
}

export function start(port) {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { body = null; }
    const send = ({ status, headers = {}, body }) => {
      if (res.destroyed) return;   // client already gave up: the response is lost
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      if (!body) return send({ status: 400, body: { error: 'invalid JSON' } });
      const owner = req.headers['x-api-client'] ?? 'anonymous';
      if (req.method === 'POST' && req.url === '/naive/payments') return send(await naive(body));
      if (req.method === 'POST' && req.url === '/v1/payments')
        return send(await idempotent(owner, req.headers['idempotency-key'], req.method, req.url, body));
      send({ status: 404, body: { error: 'not found' } });
    } catch (e) {
      send({ status: 500, body: { error: 'internal error' } });
    }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

export { pool };
