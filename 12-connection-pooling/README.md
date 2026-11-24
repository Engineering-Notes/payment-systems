# 12 Connection pooling under load

Article: https://codemwangi.substack.com/p/connection-pooling-under-load

| File | Purpose |
|---|---|
| `experiment.mjs` | Four experiments: a new connection per request against a pool; a pool size sweep from 1 to 64; a 200 ms provider call inside and outside a transaction; 8 app instances against `max_connections` |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/pooling` and can be overridden with `DATABASE_URL`. Experiment 4 assumes PostgreSQL's default `max_connections = 100` and that nothing else holds many connections; it deliberately triggers `sorry, too many clients already`.

Results depend heavily on the machine. The article's numbers come from PostgreSQL 16 on a 2-core host with client and database on the same machine. Expect the same shape elsewhere: pooling is an order of magnitude faster than connecting per request, throughput plateaus as the pool grows while p99 rises, holding a connection during a 200 ms call caps throughput at pool size / 0.2 s, and 160 connections against a limit of 100 fail.
