// A local stand-in for Safaricom's Daraja M-Pesa Express API.
// Request and callback shapes follow the Daraja documentation. Outcomes and faults are scripted
// per phone number so the experiment is repeatable. This is a mock: it is not Safaricom's service.
import http from 'node:http';
import crypto from 'node:crypto';

export const CREDS = { key: 'test-consumer-key', secret: 'test-consumer-secret', shortcode: '174379', passkey: 'test-passkey' };
const DESC = {
  0: 'The service request is processed successfully.',
  1: 'The balance is insufficient for the transaction.',
  1019: 'Transaction has expired.',
  1032: 'Request cancelled by user.',
  1037: 'DS timeout user cannot be reached.',
  2001: 'The initiator information is invalid.',
};

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

// script(phone) -> { code, lose, duplicate, delayMs }
export function startDarajaMock({ port = 0, script }) {
  const tokens = new Set(), checkouts = new Map(); let seq = 0;
  const stats = { pushes: 0, rejected: 0, callbacksSent: 0, queries: 0 };

  async function deliver(c) {
    const meta = c.code === 0 ? { CallbackMetadata: { Item: [
      { Name: 'Amount', Value: c.amount }, { Name: 'MpesaReceiptNumber', Value: c.receipt },
      { Name: 'TransactionDate', Value: Number(stamp()) }, { Name: 'PhoneNumber', Value: Number(c.phone) }] } } : {};
    const body = { Body: { stkCallback: { MerchantRequestID: c.merchantId, CheckoutRequestID: c.checkoutId,
      ResultCode: c.code, ResultDesc: DESC[c.code], ...meta } } };
    stats.callbacksSent++;
    await fetch(c.callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/oauth/v1/generate') {
      const expected = 'Basic ' + Buffer.from(`${CREDS.key}:${CREDS.secret}`).toString('base64');
      if (req.headers.authorization !== expected) return json(res, 400, { errorCode: '400.008.01', errorMessage: 'Invalid Authentication passed' });
      const t = crypto.randomBytes(12).toString('hex'); tokens.add(t);
      return json(res, 200, { access_token: t, expires_in: '3599' });
    }
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    if (!tokens.has(bearer)) return json(res, 401, { errorCode: '404.001.03', errorMessage: 'Invalid Access Token' });
    const b = await readBody(req);
    const pw = Buffer.from(CREDS.shortcode + CREDS.passkey + b.Timestamp).toString('base64');
    if (b.Password !== pw) return json(res, 400, { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid Password' });

    if (url.pathname === '/mpesa/stkpush/v1/processrequest') {
      stats.pushes++;
      const bad = !/^2547\d{8}$|^2541\d{8}$/.test(String(b.PhoneNumber)) || !(b.Amount >= 1)
        || String(b.AccountReference).length > 12 || String(b.TransactionDesc).length > 13;
      if (bad) { stats.rejected++; return json(res, 400, { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid parameters' }); }
      seq++;
      const c = { merchantId: `29115-${seq}-1`, checkoutId: `ws_CO_${stamp()}${String(seq).padStart(6, '0')}`,
        phone: String(b.PhoneNumber), amount: b.Amount, callbackUrl: b.CallBackURL, done: false,
        receipt: 'T' + crypto.randomBytes(5).toString('hex').toUpperCase(), ...script(String(b.PhoneNumber)) };
      checkouts.set(c.checkoutId, c);
      setTimeout(async () => {
        c.done = true;                       // the customer has answered; the query endpoint now knows
        if (c.lose) return;                  // callback never arrives
        setTimeout(() => deliver(c), c.delayMs ?? 0);
        if (c.duplicate) setTimeout(() => deliver(c), (c.delayMs ?? 0) + 50);
      }, 100 + (seq % 7) * 40);
      return json(res, 200, { MerchantRequestID: c.merchantId, CheckoutRequestID: c.checkoutId, ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing', CustomerMessage: 'Success. Request accepted for processing' });
    }
    if (url.pathname === '/mpesa/stkpushquery/v1/query') {
      stats.queries++;
      const c = checkouts.get(b.CheckoutRequestID);
      if (!c) return json(res, 500, { errorCode: '500.001.1001', errorMessage: 'Unable to find the requested transaction' });
      if (!c.done) return json(res, 500, { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' });
      // Like Daraja, the query returns codes as strings and carries no receipt number.
      return json(res, 200, { ResponseCode: '0', ResponseDescription: 'The service request has been accepted successsfully',
        MerchantRequestID: c.merchantId, CheckoutRequestID: c.checkoutId, ResultCode: String(c.code), ResultDesc: DESC[c.code] });
    }
    json(res, 404, { errorMessage: 'not found' });
  });
  return new Promise((r) => server.listen(port, () => r({ server, stats, url: `http://127.0.0.1:${server.address().port}`, checkouts })));
}
