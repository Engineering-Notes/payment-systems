// Minimal Daraja client: cached OAuth token, STK push, STK query.
export function darajaClient({ baseUrl, key, secret, shortcode, passkey }) {
  let token = null, expiresAt = 0;
  const timestamp = () => {
    const d = new Date(Date.now() + 3 * 3600_000); // Daraja timestamps are East Africa Time
    return d.toISOString().replace(/\D/g, '').slice(0, 14);
  };
  const password = (ts) => Buffer.from(shortcode + passkey + ts).toString('base64');

  async function auth() {
    if (token && Date.now() < expiresAt - 60_000) return token;          // refresh a minute early
    const r = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') } });
    const j = await r.json();
    if (!r.ok) throw new Error(`oauth failed: ${j.errorMessage}`);
    token = j.access_token; expiresAt = Date.now() + Number(j.expires_in) * 1000;
    return token;
  }
  async function post(path, body) {
    const r = await fetch(baseUrl + path, { method: 'POST',
      headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }
  return {
    stkPush({ phone, amount, accountRef, desc, callbackUrl }) {
      const ts = timestamp();
      return post('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: shortcode, Password: password(ts), Timestamp: ts,
        TransactionType: 'CustomerPayBillOnline', Amount: amount, PartyA: phone, PartyB: shortcode,
        PhoneNumber: phone, CallBackURL: callbackUrl, AccountReference: accountRef, TransactionDesc: desc });
    },
    stkQuery(checkoutRequestId) {
      const ts = timestamp();
      return post('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: shortcode, Password: password(ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId });
    },
  };
}

// Normalise 07XXXXXXXX, +2547XXXXXXXX and 7XXXXXXXX to 2547XXXXXXXX.
export function normalisePhone(input) {
  const digits = String(input).replace(/\D/g, '');
  const m = digits.match(/^(?:254|0)?([17]\d{8})$/);
  if (!m) throw new Error(`not a Kenyan mobile number: ${input}`);
  return '254' + m[1];
}
