// The merchant side: start payments, receive callbacks, reconcile.
// mode 'naive' is the integration most tutorials show. mode 'robust' is the one this article recommends.
import http from 'node:http';
import crypto from 'node:crypto';
import { darajaClient, normalisePhone } from './daraja-client.mjs';

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

export async function startApp({ pool, mode, darajaUrl, creds }) {
  const secret = crypto.randomBytes(16).toString('hex');            // unguessable callback path
  const daraja = darajaClient({ baseUrl: darajaUrl, ...creds });
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    const ok = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ResultCode":0,"ResultDesc":"Accepted"}'); };
    if (mode === 'naive' && req.url === '/mpesa/callback') { await naiveCallback(JSON.parse(raw)).catch((e) => console.error('  naive handler error:', e.message)); return ok(); }
    if (mode === 'robust' && req.url === `/mpesa/callback/${secret}`) { await robustCallback(JSON.parse(raw)); return ok(); }
    if (req.url.startsWith('/mpesa/callback')) {
      await pool.query('INSERT INTO mpesa_callbacks (body, outcome) VALUES ($1, $2)', [raw || '{}', 'wrong_path']);
      res.writeHead(404); return res.end();
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const callbackUrl = mode === 'naive' ? `${base}/mpesa/callback` : `${base}/mpesa/callback/${secret}`;

  async function checkout({ orderRef, phone, amount }) {
    const msisdn = normalisePhone(phone);
    const { rows: [p] } = await pool.query(
      'INSERT INTO payments (order_ref, phone, amount) VALUES ($1, $2, $3) RETURNING id', [orderRef, msisdn, amount]);
    const r = await daraja.stkPush({ phone: msisdn, amount, accountRef: orderRef.slice(0, 12), desc: 'Order payment', callbackUrl });
    if (r.body.ResponseCode !== '0') {
      await pool.query(`UPDATE payments SET status='failed', result_desc=$2 WHERE id=$1`, [p.id, r.body.errorMessage]);
      return { id: p.id, accepted: false };
    }
    await pool.query(`UPDATE payments SET status='pending', checkout_request_id=$2, updated_at=now() WHERE id=$1`,
      [p.id, r.body.CheckoutRequestID]);
    return { id: p.id, accepted: true, checkoutRequestId: r.body.CheckoutRequestID };
  }

  // NAIVE: trust the body, mark paid on code 0, fulfil every time a success arrives.
  async function naiveCallback(body) {
    const cb = body.Body.stkCallback;
    if (cb.ResultCode === 0) {
      const receipt = cb.CallbackMetadata.Item.find((i) => i.Name === 'MpesaReceiptNumber').Value;
      const { rows } = await pool.query(`UPDATE payments SET status='paid', result_code=0, mpesa_receipt=$2, resolved_by='callback'
        WHERE checkout_request_id=$1 RETURNING id`, [cb.CheckoutRequestID, receipt]);
      for (const r of rows) await pool.query('INSERT INTO fulfilments (payment_id) VALUES ($1)', [r.id]);
    } else {
      await pool.query(`UPDATE payments SET status='failed', result_code=$2 WHERE checkout_request_id=$1`, [cb.CheckoutRequestID, cb.ResultCode]);
    }
  }

  // ROBUST: store every body, resolve each payment once, check the amount, confirm successes with the query API.
  async function robustCallback(body) {
    const cb = body?.Body?.stkCallback;
    const log = (outcome) => pool.query('INSERT INTO mpesa_callbacks (checkout_request_id, body, outcome) VALUES ($1, $2, $3)',
      [cb?.CheckoutRequestID ?? null, JSON.stringify(body), outcome]);
    if (!cb?.CheckoutRequestID) return log('malformed');
    const { rows: [p] } = await pool.query('SELECT * FROM payments WHERE checkout_request_id = $1', [cb.CheckoutRequestID]);
    if (!p) return log('unknown_checkout');
    if (p.status !== 'pending') return log('duplicate');
    if (cb.ResultCode === 0) {
      const item = (n) => cb.CallbackMetadata?.Item?.find((i) => i.Name === n)?.Value;
      if (Number(item('Amount')) !== p.amount) return log('amount_mismatch');
      const q = await daraja.stkQuery(cb.CheckoutRequestID);           // the callback is unsigned: confirm it
      if (q.body.ResultCode !== '0') return log('not_confirmed_by_query');
      await resolve(p.id, 0, cb.ResultDesc, String(item('MpesaReceiptNumber')), 'callback');
      return log('accepted');
    }
    await resolve(p.id, cb.ResultCode, cb.ResultDesc, null, 'callback');
    return log('accepted');
  }

  async function resolve(id, code, desc, receipt, by) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `UPDATE payments SET status=$2, result_code=$3, result_desc=$4, mpesa_receipt=$5, resolved_by=$6, updated_at=now()
          WHERE id=$1 AND status='pending'`, [id, code === 0 ? 'paid' : 'failed', code, desc, receipt, by]);
      if (rowCount === 1 && code === 0) await client.query('INSERT INTO fulfilments (payment_id) VALUES ($1)', [id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }

  // Reconciler: ask Daraja about anything still pending after `olderThanMs`.
  async function reconcile(olderThanMs) {
    const { rows } = await pool.query(
      `SELECT id, checkout_request_id FROM payments WHERE status='pending' AND created_at < now() - $1 * interval '1 millisecond'`, [olderThanMs]);
    let resolved = 0;
    for (const p of rows) {
      const q = await daraja.stkQuery(p.checkout_request_id);
      if (q.status !== 200) continue;                                   // still processing: try again later
      await resolve(p.id, Number(q.body.ResultCode), q.body.ResultDesc, null, 'query'); resolved++;
    }
    return resolved;
  }

  return { checkout, reconcile, callbackUrl, close: () => server.close() };
}
