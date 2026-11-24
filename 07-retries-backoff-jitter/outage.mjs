// Scenario 2: a dependency is down for 30 s while new requests keep arriving at 200 per second.
// Compare the load the dependency receives with and without a retry budget.
import { policies, rng, retryBudget } from './backoff.mjs';

const RATE = 200, OUTAGE_START = 10_000, OUTAGE_END = 40_000, END = 60_000, MAX_ATTEMPTS = 4;

export function runOutage({ budget = false, seed = 3 } = {}) {
  const rand = rng(seed), policy = policies['Full jitter'], b = retryBudget({ ratio: 0.1, max: 10 });
  let queue = [];
  for (let t = 0; t < END; t += 1000 / RATE) queue.push([Math.round(t), 1, 0]);
  const perSecond = new Array(END / 1000 + 20).fill(0);
  let firstAttempts = 0, retries = 0, ok = 0, failed = 0, blocked = 0;
  queue.sort((a, b2) => a[0] - b2[0]);
  while (queue.length) {
    const [t, attempt, prev] = queue.shift();
    perSecond[Math.floor(t / 1000)]++;
    if (attempt === 1) { firstAttempts++; b.onRequest(); } else retries++;
    const down = t >= OUTAGE_START && t < OUTAGE_END;
    if (!down) { ok++; continue; }
    if (attempt >= MAX_ATTEMPTS) { failed++; continue; }
    if (budget && !b.tryRetry()) { blocked++; failed++; continue; }
    const d = policy(attempt, rand, prev);
    const item = [t + Math.max(1, Math.round(d)), attempt + 1, d];
    // keep the queue ordered
    let i = queue.findIndex((q) => q[0] > item[0]); if (i < 0) i = queue.length; queue.splice(i, 0, item);
  }
  const during = perSecond.slice(OUTAGE_START / 1000 + 2, OUTAGE_END / 1000);
  const avgDuring = during.reduce((a, x) => a + x, 0) / during.length;
  return { firstAttempts, retries, ok, failed, blocked, avgDuring, ratio: avgDuring / RATE };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('2 OUTAGE: dependency down for 30 s, 200 new requests per second, up to 4 attempts, full jitter');
  for (const budget of [false, true]) {
    const r = runOutage({ budget });
    console.log(`  ${(budget ? 'with 10% retry budget' : 'no retry budget').padEnd(22)} load during outage ${r.avgDuring.toFixed(0)} req/s (${r.ratio.toFixed(2)}x)`
      + ` | retries ${r.retries} | retries refused by budget ${r.blocked}`);
  }
}
