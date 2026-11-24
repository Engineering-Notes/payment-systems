// Runs fetchWithRetry against a local server that fails on purpose.
import http from 'node:http';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './retry.mjs';
import { retryBudget } from './backoff.mjs';

let script = [], seenKeys = [];
const server = http.createServer((req, res) => {
  seenKeys.push(req.headers['idempotency-key']);
  const step = script.shift() ?? { status: 200 };
  if (step.hang) return; // never respond
  res.writeHead(step.status, step.headers ?? {}); res.end(String(step.status));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/payments`;
const run = async (name, steps, opts = {}) => {
  script = [...steps]; seenKeys = []; const lines = [];
  const t0 = Date.now();
  const res = await fetchWithRetry(url, { method: 'POST' }, { budget: retryBudget({ max: 10 }), log: (l) => lines.push(l), ...opts })
    .catch((e) => ({ status: e.name }));
  console.log(`  ${name}: final ${res.status} after ${seenKeys.length} attempt(s), ${Date.now() - t0} ms, one key: ${new Set(seenKeys).size === 1}`);
  lines.forEach((l) => console.log(`      ${l}`));
  return { res, attempts: seenKeys.length, keys: new Set(seenKeys).size, ms: Date.now() - t0 };
};

console.log('4 HTTP RETRY HELPER against a local failing server');
let r = await run('503 twice, then 201', [{ status: 503 }, { status: 503 }, { status: 201 }]);
assert.equal(r.res.status, 201); assert.equal(r.attempts, 3); assert.equal(r.keys, 1);

r = await run('400 is not retried', [{ status: 400 }]);
assert.equal(r.res.status, 400); assert.equal(r.attempts, 1);

r = await run('429 with Retry-After: 1', [{ status: 429, headers: { 'Retry-After': '1' } }, { status: 201 }]);
assert.equal(r.res.status, 201); assert.ok(r.ms >= 1000, 'waited for Retry-After');

r = await run('always 503, 4 attempts max', [{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }]);
assert.equal(r.res.status, 503); assert.equal(r.attempts, 4);

r = await run('server hangs, 1.5 s deadline', [{ hang: true }, { hang: true }, { hang: true }], { deadlineMs: 1500 });
assert.ok(r.ms < 1700, 'stopped at the deadline');

console.log('  all assertions passed');
server.closeAllConnections(); server.close();
