// A webhook sender: signs each event, times out slow endpoints, retries with exponential backoff and jitter.
// The real-world schedule spans days; here it is scaled to milliseconds.
import { sign } from './signing.mjs';

export async function deliver({ url, secret, event, timeoutMs = 300, schedule = [0, 50, 150, 400, 1000, 2000], stats }) {
  const body = JSON.stringify(event);
  for (let attempt = 0; attempt < schedule.length; attempt++) {
    await new Promise((r) => setTimeout(r, schedule[attempt] * (0.5 + Math.random())));
    const ts = String(Math.floor(Date.now() / 1000));
    stats.attempts++;
    try {
      const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs), headers: {
        'content-type': 'application/json', 'webhook-id': event.id, 'webhook-timestamp': ts,
        'webhook-signature': sign(secret, event.id, ts, body) } });
      if (res.status >= 200 && res.status < 300) { stats.delivered++; return true; }
      stats.non2xx++;
    } catch { stats.timeouts++; }
  }
  stats.gaveUp++;
  return false;
}
