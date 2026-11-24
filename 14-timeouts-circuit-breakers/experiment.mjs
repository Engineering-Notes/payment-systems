// A checkout service calls a fraud-scoring dependency. For 5 of the 15 seconds, the dependency hangs.
// The checkout service can hold at most 200 requests in flight (think worker threads or memory).
import http from 'node:http';
import { CircuitBreaker } from './breaker.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const RUN_MS = 15000, INCIDENT = [3000, 8000], RATE = 100, MAX_IN_FLIGHT = 200;

async function startDependency() {
  let t0 = 0, calls = 0, callsDuringIncident = 0;
  const server = http.createServer(async (req, res) => {
    calls++;
    const t = Date.now() - t0, bad = t >= INCIDENT[0] && t < INCIDENT[1];
    if (bad) { callsDuringIncident++; await sleep(10000); }       // hangs far longer than anyone should wait
    else await sleep(20);
    if (!res.destroyed) { res.writeHead(200); res.end('{"score":0.1}'); }
  });
  server.keepAliveTimeout = 1;
  await new Promise((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${server.address().port}`, start: () => { t0 = Date.now(); }, stats: () => ({ calls, callsDuringIncident }),
    close: () => { server.closeAllConnections(); server.close(); } };
}

async function scenario(name, { timeoutMs = null, retries = 0, breaker = null, fallback = false }) {
  const dep = await startDependency();
  let inFlight = 0, peak = 0, ok = 0, degraded = 0, failed = 0, rejected = 0; const lat = [];
  const callDep = async () => {
    for (let a = 0; ; a++) {
      try {
        const r = await fetch(dep.url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {});
        return await r.json();
      } catch (e) { if (a >= retries) throw e; await sleep(50 * (a + 1)); }
    }
  };
  const handle = async () => {
    if (inFlight >= MAX_IN_FLIGHT) { rejected++; return; }        // service is saturated
    inFlight++; peak = Math.max(peak, inFlight);
    const s = Date.now();
    try {
      if (breaker) {
        const r = await breaker.call(callDep, () => (fallback ? { score: null, degraded: true } : Promise.reject(new Error('unavailable'))));
        if (r.degraded) degraded++; else ok++;
      } else { await callDep(); ok++; }
    } catch { if (fallback) degraded++; else failed++; }
    finally { inFlight--; lat.push(Date.now() - s); }
  };
  dep.start(); const t0 = Date.now(); const pending = [];
  for (let i = 0; Date.now() - t0 < RUN_MS; i++) { pending.push(handle()); await sleep(1000 / RATE); }
  await Promise.race([Promise.all(pending), sleep(12000)]);
  const d = dep.stats(); dep.close();
  return { name, total: pending.length, ok, degraded, failed, rejected, peak, p99: pct(lat, 99), depIncident: d.callsDuringIncident,
    transitions: breaker?.transitions.length ?? 0 };
}

console.log(`Checkout at ${RATE} req/s for 15 s. Fraud service hangs from 3 s to 8 s. At most ${MAX_IN_FLIGHT} checkouts in flight.\n`);
console.log('  policy                                  ok  degraded  failed  rejected  peak in flight  p99 ms  calls to hung dependency');
const rows = [];
for (const [name, opts] of [
  ['no timeout', {}],
  ['timeout 500 ms', { timeoutMs: 500 }],
  ['timeout 500 ms + 2 retries', { timeoutMs: 500, retries: 2 }],
  ['timeout + circuit breaker', { timeoutMs: 500, breaker: new CircuitBreaker() }],
  ['timeout + breaker + fallback', { timeoutMs: 500, breaker: new CircuitBreaker(), fallback: true }],
]) {
  const r = await scenario(name, opts); rows.push(r);
  console.log(`  ${name.padEnd(36)} ${String(r.ok).padStart(5)} ${String(r.degraded).padStart(9)} ${String(r.failed).padStart(7)} ${String(r.rejected).padStart(9)} ${String(r.peak).padStart(15)} ${String(r.p99).padStart(7)} ${String(r.depIncident).padStart(25)}`);
}
const last = rows.at(-1);
if (last.rejected || last.failed) { console.error('breaker with fallback should neither reject nor fail'); process.exit(1); }
