# 07 Retries, backoff and jitter

Article: https://codemwangi.substack.com/p/retries-backoff-and-jitter

No database and no dependencies. Node 20 or later (uses `AbortSignal.timeout` and the built-in `fetch`).

| File | Purpose |
|---|---|
| `backoff.mjs` | Immediate, exponential, full jitter, equal jitter and decorrelated jitter policies; seeded RNG; retry budget token bucket |
| `herd.mjs` | 1,000 clients at once against a server that handles 100 requests per 100 ms, mean of 50 seeds |
| `outage.mjs` | Dependency down for 30 s at 200 new requests per second, with and without a 10% retry budget |
| `layers.mjs` | Database calls per user request when 1 to 5 layers each make 3 attempts |
| `retry.mjs` | `fetchWithRetry`: retryable statuses only, full jitter, Retry-After, overall deadline, one Idempotency-Key, shared budget |
| `http-test.mjs` | Runs `fetchWithRetry` against a local server scripted to fail, with assertions |

```bash
npm test
```

Expected: no-jitter backoff finishes the herd after about 32.7 s and decorrelated jitter after about 2.0 s; the outage load is 4.00x without a budget and 1.10x with one; 5 retrying layers make 243 database calls. Simulations run in virtual time and are deterministic. The HTTP test prints random wait times but its assertions are stable.
