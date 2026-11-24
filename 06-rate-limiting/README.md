# 06 Rate limiting payment APIs

Article: https://codemwangi.substack.com/p/rate-limiting-payment-apis

| File | Purpose |
|---|---|
| `algorithms.mjs` | Fixed window, sliding log, sliding window counter and token bucket, all with `allow(now)` |
| `simulate.mjs` | Deterministic virtual-time comparison: a burst across a window boundary, and 60 s of Poisson overload at 15 req/s against a 10 req/s limit |
| `schema.sql` | `rate_limits` table and `take_token()`, a token bucket updated atomically in one `UPDATE` |
| `distributed.mjs` | Four simulated instances, 100 requests each in one second: in-memory limiters against the shared PostgreSQL bucket |

```bash
npm install
npm run simulate      # no database needed
npm run distributed   # needs the ratelimit database
npm test              # both
```

The database URL defaults to `postgres://ledger:ledger@localhost/ratelimit` and can be overridden with `DATABASE_URL`. `docker compose up -d` from the repository root creates it.

Expected:

- Boundary burst: the fixed window accepts 20 of 20 requests within 10 ms. The other three accept 10.
- Overload: the busiest one-second period holds 18 accepted requests for the fixed window, 10 for the sliding log, 13 for the sliding window counter and 19 for the token bucket (capacity 10 plus 10 refilled).
- Four instances: in-memory limiters accept 76 requests, the shared bucket accepts 19. Timing on a slow machine can shift the shared result by one or two.
