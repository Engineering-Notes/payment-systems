// Standard Webhooks style signing: HMAC-SHA256 over `${id}.${timestamp}.${body}`,
// sent as `webhook-signature: v1,<base64>`. Secrets look like `whsec_<base64>`.
import crypto from 'node:crypto';

const key = (secret) => Buffer.from(secret.replace(/^whsec_/, ''), 'base64');

export function sign(secret, id, timestamp, body) {
  return 'v1,' + crypto.createHmac('sha256', key(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function newSecret() { return 'whsec_' + crypto.randomBytes(32).toString('base64'); }

// Returns null if valid, or the reason it is not.
export function verify({ secrets, headers, rawBody, toleranceSec = 300, now = Date.now() }) {
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sigHeader = headers['webhook-signature'];
  if (!id || !ts || !sigHeader) return 'missing headers';
  if (!/^\d+$/.test(ts)) return 'bad timestamp';
  if (Math.abs(now / 1000 - Number(ts)) > toleranceSec) return 'timestamp outside tolerance';
  const given = sigHeader.split(' ').filter((s) => s.startsWith('v1,')).map((s) => Buffer.from(s.slice(3), 'base64'));
  for (const secret of secrets) {                       // several secrets allow rotation without downtime
    const expected = Buffer.from(sign(secret, id, ts, rawBody).slice(3), 'base64');
    if (given.some((g) => g.length === expected.length && crypto.timingSafeEqual(g, expected))) return null;
  }
  return 'signature mismatch';
}
