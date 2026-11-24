// Four rate-limiting algorithms with the same interface: allow(now) -> boolean.
// `now` is in milliseconds. Each limiter tracks one client.

// Fixed window: count requests per calendar window.
export function fixedWindow({ limit, windowMs }) {
  let windowStart = 0, count = 0;
  return {
    name: 'Fixed window',
    allow(now) {
      const start = Math.floor(now / windowMs) * windowMs;
      if (start !== windowStart) { windowStart = start; count = 0; }
      if (count < limit) { count++; return true; }
      return false;
    },
    stateSize: () => 2,
  };
}

// Sliding log: keep a timestamp for every accepted request in the last window.
export function slidingLog({ limit, windowMs }) {
  const log = [];
  return {
    name: 'Sliding log',
    allow(now) {
      while (log.length && log[0] <= now - windowMs) log.shift();
      if (log.length < limit) { log.push(now); return true; }
      return false;
    },
    stateSize: () => log.length,
  };
}

// Sliding window counter: current window count plus a weighted share of the previous one.
export function slidingCounter({ limit, windowMs }) {
  let currStart = 0, curr = 0, prev = 0;
  return {
    name: 'Sliding window counter',
    allow(now) {
      const start = Math.floor(now / windowMs) * windowMs;
      if (start !== currStart) {
        prev = start - currStart === windowMs ? curr : 0;
        curr = 0; currStart = start;
      }
      const weight = 1 - (now - currStart) / windowMs;
      if (prev * weight + curr < limit) { curr++; return true; }
      return false;
    },
    stateSize: () => 3,
  };
}

// Token bucket: `capacity` tokens, refilled continuously at `ratePerSec`.
export function tokenBucket({ capacity, ratePerSec }) {
  let tokens = capacity, last = 0;
  return {
    name: 'Token bucket',
    allow(now) {
      tokens = Math.min(capacity, tokens + ((now - last) / 1000) * ratePerSec);
      last = now;
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    },
    stateSize: () => 2,
  };
}
