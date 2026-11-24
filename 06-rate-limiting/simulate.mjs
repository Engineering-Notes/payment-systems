// Deterministic comparison of four rate limiters in virtual time.
// Policy under test: 10 requests per second per client.
import { fixedWindow, slidingLog, slidingCounter, tokenBucket } from './algorithms.mjs';

const LIMIT = 10, WINDOW = 1000;
const make = () => [
  fixedWindow({ limit: LIMIT, windowMs: WINDOW }),
  slidingLog({ limit: LIMIT, windowMs: WINDOW }),
  slidingCounter({ limit: LIMIT, windowMs: WINDOW }),
  tokenBucket({ capacity: LIMIT, ratePerSec: LIMIT }),
];

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Largest number of accepted requests inside any rolling window of `w` ms.
function maxInRollingWindow(times, w) {
  let best = 0, i = 0;
  for (let j = 0; j < times.length; j++) {
    while (times[j] - times[i] >= w) i++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}

const pad = (s, n) => String(s).padEnd(n);

// 1. Boundary burst: 10 requests at 990 ms, then 10 more at 1000 ms.
console.log('1 BOUNDARY BURST: 10 requests at t=990ms, 10 at t=1000ms (limit 10 per second)');
for (const lim of make()) {
  const accepted = [];
  for (const t of [...Array(10).fill(990), ...Array(10).fill(1000)]) if (lim.allow(t)) accepted.push(t);
  console.log(`  ${pad(lim.name, 24)} accepted ${String(accepted.length).padStart(2)} of 20 within 10 ms`);
}

// 2. Sustained overload: random arrivals averaging 15 per second for 60 seconds.
console.log('\n2 SUSTAINED OVERLOAD: Poisson arrivals at 15/s for 60 s (limit 10/s), seed 42');
const r = rng(42);
const arrivals = [];
for (let t = 0; t < 60000;) { t += -Math.log(1 - r()) * (1000 / 15); if (t < 60000) arrivals.push(Math.round(t)); }
for (const lim of make()) {
  const acc = []; let maxState = 0;
  for (const t of arrivals) { if (lim.allow(t)) acc.push(t); maxState = Math.max(maxState, lim.stateSize()); }
  console.log(`  ${pad(lim.name, 24)} accepted ${acc.length} of ${arrivals.length}`
    + ` | max in any 1 s window ${String(maxInRollingWindow(acc, 1000)).padStart(2)}`
    + ` | values stored per client ${maxState}`);
}
