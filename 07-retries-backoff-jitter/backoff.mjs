// Backoff policies. Each returns the delay in ms before retry number `attempt` (1-based).
// `rand` is a function returning [0, 1). `prev` is the previous delay (for decorrelated jitter).
export const BASE = 100, CAP = 10_000;

export const policies = {
  'Immediate retry': () => 0,
  'Exponential, no jitter': (attempt) => Math.min(CAP, BASE * 2 ** (attempt - 1)),
  'Full jitter': (attempt, rand) => rand() * Math.min(CAP, BASE * 2 ** (attempt - 1)),
  'Equal jitter': (attempt, rand) => {
    const t = Math.min(CAP, BASE * 2 ** (attempt - 1));
    return t / 2 + rand() * (t / 2);
  },
  'Decorrelated jitter': (attempt, rand, prev) =>
    Math.min(CAP, BASE + rand() * ((prev || BASE) * 3 - BASE)),
};

export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Retry budget: a token bucket that earns 0.1 tokens per first attempt and spends 1 per retry,
// so retries stay at or below about 10% of first attempts.
export function retryBudget({ ratio = 0.1, max = 10 } = {}) {
  let tokens = max;
  return {
    onRequest() { tokens = Math.min(max, tokens + ratio); },
    tryRetry() { if (tokens >= 1) { tokens -= 1; return true; } return false; },
  };
}
