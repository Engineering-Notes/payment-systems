// A production-shaped retry helper for HTTP calls.
// - retries only on network errors, 408, 429, 500, 502, 503, 504
// - capped exponential backoff with full jitter
// - honours Retry-After when the server sends it
// - stops at an overall deadline, not only an attempt count
// - reuses the same Idempotency-Key on every attempt
// - draws retries from a shared retry budget
import { randomUUID } from 'node:crypto';
import { retryBudget } from './backoff.mjs';

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sharedBudget = retryBudget({ ratio: 0.1, max: 10 });

export async function fetchWithRetry(url, init = {}, opts = {}) {
  const { maxAttempts = 4, base = 100, cap = 2000, deadlineMs = 5000,
          budget = sharedBudget, rand = Math.random, log = () => {} } = opts;
  const started = Date.now();
  const headers = { ...init.headers, 'Idempotency-Key': init.headers?.['Idempotency-Key'] ?? randomUUID() };
  budget.onRequest();
  for (let attempt = 1; ; attempt++) {
    let res, err;
    const remaining = deadlineMs - (Date.now() - started);
    try { res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(Math.max(1, remaining)) }); }
    catch (e) { err = e; }
    if (res && !RETRYABLE.has(res.status)) return res;
    const reason = res ? `HTTP ${res.status}` : err.name;
    if (attempt >= maxAttempts) { log(`attempt ${attempt}: ${reason}, giving up (attempts)`); return res ?? Promise.reject(err); }
    let delay = rand() * Math.min(cap, base * 2 ** (attempt - 1));
    const ra = res?.headers.get('retry-after');
    if (ra) delay = Math.max(delay, /^\d+$/.test(ra) ? Number(ra) * 1000 : new Date(ra) - Date.now());
    if (Date.now() - started + delay >= deadlineMs) { log(`attempt ${attempt}: ${reason}, giving up (deadline)`); return res ?? Promise.reject(err); }
    if (!budget.tryRetry()) { log(`attempt ${attempt}: ${reason}, giving up (retry budget)`); return res ?? Promise.reject(err); }
    log(`attempt ${attempt}: ${reason}, waiting ${Math.round(delay)} ms`);
    await sleep(delay);
  }
}
