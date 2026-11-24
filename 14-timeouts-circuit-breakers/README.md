# 14 Timeouts and circuit breakers

Article: https://codemwangi.substack.com/p/timeouts-and-circuit-breakers

No database and no dependencies. Node 20 or later.

| File | Purpose |
|---|---|
| `breaker.mjs` | `CircuitBreaker`: rolling window, failure-rate threshold, cool-down, single half-open probe, optional fallback |
| `experiment.mjs` | A checkout service at 100 req/s (max 200 in flight) calling a fraud service that hangs for 5 of 15 seconds, under five policies |

```bash
npm test
```

Takes about 90 seconds (five 15-second runs plus drain time). Expected: no timeout rejects around 780 requests with 200 in flight; a 500 ms timeout rejects none; retries nearly triple calls to the hung service; the breaker cuts those calls to about 60; the breaker with a fallback fails and rejects nothing. The script exits with an error if the last policy rejects or fails any request.
