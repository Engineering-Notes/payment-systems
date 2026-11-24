// Scenario 1: thundering herd. 1,000 clients send at once after a reconnect.
// The server handles 100 requests per 100 ms window and rejects the rest with 503.
// Each client retries up to 10 attempts. Virtual time, seeded randomness.
import { policies, rng } from './backoff.mjs';

const CLIENTS = 1000, CAPACITY = 100, WINDOW = 100, MAX_ATTEMPTS = 10;

export function runHerd(policyName, seed = 7) {
  const rand = rng(seed), policy = policies[policyName];
  // events: [time, client, attempt, prevDelay]
  let queue = [];
  for (let c = 0; c < CLIENTS; c++) queue.push([Math.floor(rand() * 10), c, 1, 0]);
  const windows = new Map(); let calls = 0, done = 0, failed = 0, lastSuccess = 0;
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [t, c, attempt, prev] = queue.shift();
    calls++;
    const w = Math.floor(t / WINDOW);
    const used = windows.get(w) ?? 0; windows.set(w, used + 1);
    if (used < CAPACITY) { done++; lastSuccess = Math.max(lastSuccess, t); continue; }
    if (attempt >= MAX_ATTEMPTS) { failed++; continue; }
    const d = policy(attempt, rand, prev);
    queue.push([t + Math.max(1, Math.round(d)), c, attempt + 1, d]);
  }
  const peak = Math.max(...windows.values());
  return { calls, done, failed, lastSuccess, peak };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const SEEDS = 50;
  console.log(`1 THUNDERING HERD: 1,000 clients at once, capacity 100 per 100 ms, up to 10 attempts (mean of ${SEEDS} seeds)`);
  console.log('  policy                     calls  succeeded  last success  peak per 100 ms');
  for (const name of Object.keys(policies)) {
    const sum = { calls: 0, done: 0, lastSuccess: 0, peak: 0 };
    for (let s = 1; s <= SEEDS; s++) { const r = runHerd(name, s); for (const k in sum) sum[k] += r[k]; }
    const m = (k) => Math.round(sum[k] / SEEDS);
    console.log(`  ${name.padEnd(25)} ${String(m('calls')).padStart(6)} ${String(m('done')).padStart(10)} ${String(m('lastSuccess') + ' ms').padStart(13)} ${String(m('peak')).padStart(16)}`);
  }
}
